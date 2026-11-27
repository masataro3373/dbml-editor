-- =============================================================================
-- サンプルDDL 03: 人事・給与・勤怠管理システム (HR, Attendance & Payroll Management)
-- 対象DBMS方言 : PostgreSQL
-- 推奨スキーマ名: hr_attendance
-- テーブル数   : 7テーブル (マスタ4 / トランザクション3)
-- =============================================================================

-- 1. 組織・部署マスタ (mst_organizations)
CREATE TABLE mst_organizations (
  org_code        VARCHAR(16)  NOT NULL,
  org_name        VARCHAR(100) NOT NULL,
  parent_org_code VARCHAR(16),
  org_level       INTEGER      DEFAULT 1 NOT NULL,
  cost_center_no  VARCHAR(20),
  effective_from  DATE         NOT NULL,
  effective_to    DATE,
  CONSTRAINT pk_mst_organizations PRIMARY KEY (org_code)
);

COMMENT ON TABLE  mst_organizations IS '組織・部署マスタ';
COMMENT ON COLUMN mst_organizations.org_code        IS '組織コード';
COMMENT ON COLUMN mst_organizations.org_name        IS '組織名称';
COMMENT ON COLUMN mst_organizations.parent_org_code IS '上位組織コード';
COMMENT ON COLUMN mst_organizations.org_level       IS '組織階層レベル (1:本部 / 2:部 / 3:課)';
COMMENT ON COLUMN mst_organizations.cost_center_no  IS '原価部門コード';
COMMENT ON COLUMN mst_organizations.effective_from  IS '適用開始日';
COMMENT ON COLUMN mst_organizations.effective_to    IS '適用終了日';

-- 2. 役職・等級マスタ (mst_grades)
CREATE TABLE mst_grades (
  grade_code          VARCHAR(10)   NOT NULL,
  grade_name          VARCHAR(60)   NOT NULL,
  base_salary_min     NUMERIC(12,2) DEFAULT 0 NOT NULL,
  base_salary_max     NUMERIC(12,2) DEFAULT 0 NOT NULL,
  position_allowance  NUMERIC(12,2) DEFAULT 0 NOT NULL,
  is_management_role  BOOLEAN       DEFAULT FALSE NOT NULL,
  CONSTRAINT pk_mst_grades PRIMARY KEY (grade_code)
);

COMMENT ON TABLE  mst_grades IS '役職・等級マスタ';
COMMENT ON COLUMN mst_grades.grade_code         IS '等級コード';
COMMENT ON COLUMN mst_grades.grade_name         IS '等級・役職名';
COMMENT ON COLUMN mst_grades.base_salary_min    IS '基本給下限額';
COMMENT ON COLUMN mst_grades.base_salary_max    IS '基本給上限額';
COMMENT ON COLUMN mst_grades.position_allowance IS '役職手当月額';
COMMENT ON COLUMN mst_grades.is_management_role IS '管理職フラグ';

-- 3. 社員マスタ (mst_employees)
CREATE TABLE mst_employees (
  employee_id      VARCHAR(16)   NOT NULL,
  full_name        VARCHAR(80)   NOT NULL,
  full_name_kana   VARCHAR(80),
  email            VARCHAR(150)  NOT NULL,
  org_code         VARCHAR(16)   NOT NULL,
  grade_code       VARCHAR(10)   NOT NULL,
  employment_type  VARCHAR(20)   DEFAULT 'REGULAR' NOT NULL,
  hire_date        DATE          NOT NULL,
  retire_date      DATE,
  base_salary_amt  NUMERIC(12,2) DEFAULT 0 NOT NULL,
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_mst_employees PRIMARY KEY (employee_id)
);

CREATE UNIQUE INDEX uq_mst_employees_email ON mst_employees (email);
CREATE INDEX idx_mst_employees_org ON mst_employees (org_code);

COMMENT ON TABLE  mst_employees IS '社員マスタ';
COMMENT ON COLUMN mst_employees.employee_id     IS '社員番号';
COMMENT ON COLUMN mst_employees.full_name       IS '氏名';
COMMENT ON COLUMN mst_employees.full_name_kana  IS '氏名カナ';
COMMENT ON COLUMN mst_employees.email           IS '社内メールアドレス';
COMMENT ON COLUMN mst_employees.org_code        IS '所属組織コード';
COMMENT ON COLUMN mst_employees.grade_code      IS '現在の等級コード';
COMMENT ON COLUMN mst_employees.employment_type IS '雇用形態 (REGULAR:正社員 / CONTRACT:契約社員 / PART:パート)';
COMMENT ON COLUMN mst_employees.hire_date       IS '入社日';
COMMENT ON COLUMN mst_employees.retire_date     IS '退職日';
COMMENT ON COLUMN mst_employees.base_salary_amt IS '契約基本給';
COMMENT ON COLUMN mst_employees.created_at      IS '登録日時';

-- 4. 手当項目マスタ (mst_allowances)
CREATE TABLE mst_allowances (
  allowance_code VARCHAR(12)   NOT NULL,
  allowance_name VARCHAR(80)   NOT NULL,
  calc_type      VARCHAR(15)   DEFAULT 'FIXED' NOT NULL,
  default_amount NUMERIC(10,2) DEFAULT 0 NOT NULL,
  taxable_flag   BOOLEAN       DEFAULT TRUE NOT NULL,
  CONSTRAINT pk_mst_allowances PRIMARY KEY (allowance_code)
);

COMMENT ON TABLE  mst_allowances IS '手当項目マスタ';
COMMENT ON COLUMN mst_allowances.allowance_code IS '手当コード';
COMMENT ON COLUMN mst_allowances.allowance_name IS '手当名称 (通勤手当/住宅手当/残業手当等)';
COMMENT ON COLUMN mst_allowances.calc_type      IS '計算区分 (FIXED:定額 / HOURLY:時間比例)';
COMMENT ON COLUMN mst_allowances.default_amount IS '標準支給額';
COMMENT ON COLUMN mst_allowances.taxable_flag   IS '課税対象フラグ';

-- 5. 日次勤怠実績 (trn_daily_attendance) [社員番号×勤務日の複合主キー]
CREATE TABLE trn_daily_attendance (
  employee_id        VARCHAR(16)  NOT NULL,
  work_date          DATE         NOT NULL,
  work_category      VARCHAR(15)  DEFAULT 'NORMAL' NOT NULL,
  clock_in_time      TIMESTAMP,
  clock_out_time     TIMESTAMP,
  break_minutes      INTEGER      DEFAULT 60 NOT NULL,
  actual_work_hours  NUMERIC(5,2) DEFAULT 0 NOT NULL,
  overtime_hours     NUMERIC(5,2) DEFAULT 0 NOT NULL,
  late_night_hours   NUMERIC(5,2) DEFAULT 0 NOT NULL,
  approval_status    VARCHAR(15)  DEFAULT 'PENDING' NOT NULL,
  CONSTRAINT pk_trn_daily_attendance PRIMARY KEY (employee_id, work_date)
);

CREATE INDEX idx_trn_attendance_date ON trn_daily_attendance (work_date);

COMMENT ON TABLE  trn_daily_attendance IS '日次勤怠実績';
COMMENT ON COLUMN trn_daily_attendance.employee_id       IS '社員番号';
COMMENT ON COLUMN trn_daily_attendance.work_date         IS '勤務年月日';
COMMENT ON COLUMN trn_daily_attendance.work_category     IS '勤務区分 (NORMAL:通常出勤 / REMOTE:在宅 / HOLIDAY:休日出勤 / PAID_LEAVE:有休)';
COMMENT ON COLUMN trn_daily_attendance.clock_in_time     IS '出勤打刻日時';
COMMENT ON COLUMN trn_daily_attendance.clock_out_time    IS '退勤打刻日時';
COMMENT ON COLUMN trn_daily_attendance.break_minutes     IS '休憩時間(分)';
COMMENT ON COLUMN trn_daily_attendance.actual_work_hours IS '実労働時間(h)';
COMMENT ON COLUMN trn_daily_attendance.overtime_hours    IS '時間外労働時間(h)';
COMMENT ON COLUMN trn_daily_attendance.late_night_hours  IS '深夜労働時間(h)';
COMMENT ON COLUMN trn_daily_attendance.approval_status   IS '承認状態 (PENDING:未承認 / APPROVED:承認済 / REJECTED:差戻)';

-- 6. 休暇・勤怠申請 (trn_leave_requests)
CREATE TABLE trn_leave_requests (
  request_id         VARCHAR(24)  NOT NULL,
  employee_id        VARCHAR(16)  NOT NULL,
  leave_type         VARCHAR(20)  NOT NULL,
  start_date         DATE         NOT NULL,
  end_date           DATE         NOT NULL,
  leave_days         NUMERIC(4,1) DEFAULT 1.0 NOT NULL,
  reason_note        VARCHAR(300),
  approver_emp_id    VARCHAR(16),
  request_status     VARCHAR(15)  DEFAULT 'SUBMITTED' NOT NULL,
  requested_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_trn_leave_requests PRIMARY KEY (request_id)
);

CREATE INDEX idx_trn_leave_emp ON trn_leave_requests (employee_id, start_date);

COMMENT ON TABLE  trn_leave_requests IS '休暇・勤怠申請';
COMMENT ON COLUMN trn_leave_requests.request_id      IS '申請ID';
COMMENT ON COLUMN trn_leave_requests.employee_id     IS '申請社員番号';
COMMENT ON COLUMN trn_leave_requests.leave_type      IS '休暇種別 (ANNUAL:年次有休 / SICK:傷病休暇 / SPECIAL:特別休暇)';
COMMENT ON COLUMN trn_leave_requests.start_date      IS '取得開始日';
COMMENT ON COLUMN trn_leave_requests.end_date        IS '取得終了日';
COMMENT ON COLUMN trn_leave_requests.leave_days      IS '取得日数 (0.5:半休対応)';
COMMENT ON COLUMN trn_leave_requests.reason_note     IS '申請事由';
COMMENT ON COLUMN trn_leave_requests.approver_emp_id IS '承認者社員番号';
COMMENT ON COLUMN trn_leave_requests.request_status  IS '申請状態 (SUBMITTED:申請中 / APPROVED:承認済 / CANCELLED:取消)';
COMMENT ON COLUMN trn_leave_requests.requested_at    IS '申請日時';

-- 7. 給与支給明細 (trn_payroll_slips)
CREATE TABLE trn_payroll_slips (
  slip_id             VARCHAR(24)   NOT NULL,
  employee_id         VARCHAR(16)   NOT NULL,
  target_year_month   CHAR(6)       NOT NULL,
  payment_date        DATE          NOT NULL,
  base_pay_amt        NUMERIC(12,2) DEFAULT 0 NOT NULL,
  overtime_pay_amt    NUMERIC(12,2) DEFAULT 0 NOT NULL,
  allowance_total_amt NUMERIC(12,2) DEFAULT 0 NOT NULL,
  gross_pay_amt       NUMERIC(12,2) DEFAULT 0 NOT NULL,
  social_ins_amt      NUMERIC(12,2) DEFAULT 0 NOT NULL,
  income_tax_amt      NUMERIC(12,2) DEFAULT 0 NOT NULL,
  net_pay_amt         NUMERIC(12,2) DEFAULT 0 NOT NULL,
  created_at          TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_trn_payroll_slips PRIMARY KEY (slip_id)
);

CREATE UNIQUE INDEX uq_trn_payroll_emp_ym ON trn_payroll_slips (employee_id, target_year_month);

COMMENT ON TABLE  trn_payroll_slips IS '給与支給明細';
COMMENT ON COLUMN trn_payroll_slips.slip_id             IS '給与明細ID';
COMMENT ON COLUMN trn_payroll_slips.employee_id         IS '社員番号';
COMMENT ON COLUMN trn_payroll_slips.target_year_month   IS '支給対象年月 (YYYYMM)';
COMMENT ON COLUMN trn_payroll_slips.payment_date        IS '支給日';
COMMENT ON COLUMN trn_payroll_slips.base_pay_amt        IS '基本給支給額';
COMMENT ON COLUMN trn_payroll_slips.overtime_pay_amt    IS '残業手当支給額';
COMMENT ON COLUMN trn_payroll_slips.allowance_total_amt IS '諸手当合計額';
COMMENT ON COLUMN trn_payroll_slips.gross_pay_amt       IS '総支給額';
COMMENT ON COLUMN trn_payroll_slips.social_ins_amt      IS '社会保険料控除額';
COMMENT ON COLUMN trn_payroll_slips.income_tax_amt      IS '所得税・住民税控除額';
COMMENT ON COLUMN trn_payroll_slips.net_pay_amt         IS '差引支給額(手取額)';
COMMENT ON COLUMN trn_payroll_slips.created_at          IS '明細確定日時';

-- =============================================================================
-- 外部キー制約定義 (Foreign Keys)
-- =============================================================================
ALTER TABLE mst_organizations
  ADD CONSTRAINT fk_org_parent FOREIGN KEY (parent_org_code)
  REFERENCES mst_organizations (org_code);

ALTER TABLE mst_employees
  ADD CONSTRAINT fk_emp_org FOREIGN KEY (org_code)
  REFERENCES mst_organizations (org_code);

ALTER TABLE mst_employees
  ADD CONSTRAINT fk_emp_grade FOREIGN KEY (grade_code)
  REFERENCES mst_grades (grade_code);

ALTER TABLE trn_daily_attendance
  ADD CONSTRAINT fk_att_emp FOREIGN KEY (employee_id)
  REFERENCES mst_employees (employee_id);

ALTER TABLE trn_leave_requests
  ADD CONSTRAINT fk_leave_emp FOREIGN KEY (employee_id)
  REFERENCES mst_employees (employee_id);

ALTER TABLE trn_leave_requests
  ADD CONSTRAINT fk_leave_approver FOREIGN KEY (approver_emp_id)
  REFERENCES mst_employees (employee_id);

ALTER TABLE trn_payroll_slips
  ADD CONSTRAINT fk_payroll_emp FOREIGN KEY (employee_id)
  REFERENCES mst_employees (employee_id);
