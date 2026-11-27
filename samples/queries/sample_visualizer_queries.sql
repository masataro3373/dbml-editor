-- =============================================================================
-- SQLビジュアライザー (Query Visualizer) 体験用サンプルクエリ集
-- 使い方:
--   1. 「ツール → SQLビジュアライザー」を開きます。
--   2. 左上の「デフォルトスキーマ」で対応するスキーマを選択します。
--   3. 下記のいずれかの SELECT 文をコピー＆ペーストして「▶ クエリ解析」をクリックします。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 【サンプル1】販売・受注・在庫管理 (対象スキーマ: sales_order)
--  WITH句(CTE)と5テーブル結合による「得意先・部門別の未出荷受注と現在庫の引当照会」
-- -----------------------------------------------------------------------------
WITH open_order_lines AS (
  SELECT
    o.ORDER_NO,
    o.ORDER_DATE,
    o.PARTNER_CODE,
    o.SALES_DEPT_CODE,
    d.LINE_NO,
    d.ITEM_CODE,
    d.WAREHOUSE_CODE,
    d.ORDER_QTY - d.SHIPPED_QTY AS REMAINING_QTY,
    d.LINE_AMOUNT
  FROM TRN_ORDERS o
  INNER JOIN TRN_ORDER_DETAILS d
    ON o.ORDER_NO = d.ORDER_NO
  WHERE o.ORDER_STATUS IN ('NEW', 'ALLOCATED')
    AND d.LINE_STATUS = 'OPEN'
)
SELECT
  dept.DEPT_NAME,
  p.PARTNER_NAME,
  ool.ORDER_NO,
  ool.ORDER_DATE,
  i.ITEM_NAME,
  w.WAREHOUSE_NAME,
  ool.REMAINING_QTY,
  inv.AVAILABLE_QTY
FROM open_order_lines ool
INNER JOIN MST_PARTNERS p
  ON ool.PARTNER_CODE = p.PARTNER_CODE
INNER JOIN MST_DEPARTMENTS dept
  ON ool.SALES_DEPT_CODE = dept.DEPT_CODE
INNER JOIN MST_ITEMS i
  ON ool.ITEM_CODE = i.ITEM_CODE
LEFT JOIN MST_WAREHOUSES w
  ON ool.WAREHOUSE_CODE = w.WAREHOUSE_CODE
LEFT JOIN TRN_INVENTORIES inv
  ON ool.WAREHOUSE_CODE = inv.WAREHOUSE_CODE
 AND ool.ITEM_CODE = inv.ITEM_CODE
WHERE p.STATUS_CODE = 'ACTIVE'
ORDER BY ool.ORDER_DATE DESC, ool.ORDER_NO ASC;


-- -----------------------------------------------------------------------------
-- 【サンプル2】生産・製造・BOM管理 (対象スキーマ: manufacturing_bom)
--  製造指示に対する「構成部品(BOM)・主仕入先・工程別製造実績の横断トレース」
-- -----------------------------------------------------------------------------
SELECT
  wo.WORK_ORDER_NO,
  wo.LOT_NO,
  parent_p.PRODUCT_NAME AS FINISHED_PRODUCT_NAME,
  bom.CHILD_PRODUCT_CODE,
  child_p.PRODUCT_NAME AS COMPONENT_NAME,
  sup.SUPPLIER_NAME,
  proc.PROCESS_NAME,
  wr.GOOD_QTY,
  wr.REJECT_QTY
FROM TRN_WORK_ORDERS wo
INNER JOIN MST_PRODUCTS parent_p
  ON wo.PRODUCT_CODE = parent_p.PRODUCT_CODE
INNER JOIN MST_BOM_STRUCTURES bom
  ON parent_p.PRODUCT_CODE = bom.PARENT_PRODUCT_CODE
INNER JOIN MST_PRODUCTS child_p
  ON bom.CHILD_PRODUCT_CODE = child_p.PRODUCT_CODE
LEFT JOIN MST_SUPPLIERS sup
  ON child_p.PRIMARY_SUPPLIER_CODE = sup.SUPPLIER_CODE
LEFT JOIN TRN_WORK_RESULTS wr
  ON wo.WORK_ORDER_NO = wr.WORK_ORDER_NO
LEFT JOIN MST_PROCESSES proc
  ON wr.PROCESS_CODE = proc.PROCESS_CODE
WHERE wo.WORK_STATUS = 'IN_PROGRESS';


-- -----------------------------------------------------------------------------
-- 【サンプル3】人事・給与・勤怠管理 (対象スキーマ: hr_attendance)
--  組織・等級・日次勤怠集計と給与明細の結合クエリ
-- -----------------------------------------------------------------------------
WITH monthly_overtime AS (
  SELECT
    da.employee_id,
    SUM(da.actual_work_hours) AS total_work_hours,
    SUM(da.overtime_hours) AS total_overtime_hours
  FROM trn_daily_attendance da
  WHERE da.approval_status = 'APPROVED'
  GROUP BY da.employee_id
)
SELECT
  org.org_name,
  grd.grade_name,
  emp.employee_id,
  emp.full_name,
  mo.total_work_hours,
  mo.total_overtime_hours,
  ps.target_year_month,
  ps.gross_pay_amt,
  ps.net_pay_amt
FROM mst_employees emp
INNER JOIN mst_organizations org
  ON emp.org_code = org.org_code
INNER JOIN mst_grades grd
  ON emp.grade_code = grd.grade_code
LEFT JOIN monthly_overtime mo
  ON emp.employee_id = mo.employee_id
LEFT JOIN trn_payroll_slips ps
  ON emp.employee_id = ps.employee_id
WHERE emp.retire_date IS NULL;


-- -----------------------------------------------------------------------------
-- 【サンプル4】病院・電子カルテ・予約診療 (対象スキーマ: medical_emr)
--  患者の診察カルテ・処方薬明細・診療科・担当医・会計状況の一覧照会
-- -----------------------------------------------------------------------------
SELECT
  pt.patient_id,
  pt.patient_name,
  dept.dept_name,
  doc.doctor_name,
  rec.examined_at,
  rec.diagnosis_name,
  med.medicine_name,
  presc.daily_dose_qty,
  presc.prescribed_days,
  bill.patient_copay_amt,
  bill.payment_status
FROM trn_medical_records rec
INNER JOIN mst_patients pt
  ON rec.patient_id = pt.patient_id
INNER JOIN mst_doctors doc
  ON rec.doctor_id = doc.doctor_id
INNER JOIN mst_clinical_depts dept
  ON doc.dept_id = dept.dept_id
LEFT JOIN trn_prescriptions presc
  ON rec.record_id = presc.record_id
LEFT JOIN mst_medicines med
  ON presc.medicine_code = med.medicine_code
LEFT JOIN trn_medical_bills bill
  ON rec.record_id = bill.record_id
WHERE bill.payment_status = 'UNPAID';


-- -----------------------------------------------------------------------------
-- 【サンプル5】金融・ウォレット決済・複式仕訳 (対象スキーマ: fintech_wallet)
--  決済トランザクションから複式仕訳ヘッダ・明細・勘定科目・顧客口座への監査証跡クエリ
-- -----------------------------------------------------------------------------
SELECT
  tx.tx_id,
  tx.tx_type,
  tx.tx_amount,
  jh.journal_id,
  jh.accounting_date,
  je.entry_line_no,
  je.dr_cr_side,
  at.title_name,
  acc.account_id,
  cust.customer_name,
  je.entry_amount
FROM trn_transactions tx
INNER JOIN trn_journal_headers jh
  ON tx.tx_id = jh.tx_id
INNER JOIN trn_journal_entries je
  ON jh.journal_id = je.journal_id
INNER JOIN mst_account_titles at
  ON je.title_code = at.title_code
INNER JOIN mst_accounts acc
  ON je.account_id = acc.account_id
INNER JOIN mst_customers cust
  ON acc.customer_id = cust.customer_id
WHERE tx.tx_status = 'SETTLED'
ORDER BY jh.accounting_date DESC, jh.journal_id ASC, je.entry_line_no ASC;
