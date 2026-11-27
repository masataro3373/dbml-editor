-- =============================================================================
-- サンプルDDL 04: 病院・電子カルテ・予約診療システム (Hospital, EMR & Appointment System)
-- 対象DBMS方言 : MySQL / MariaDB
-- 推奨スキーマ名: medical_emr
-- テーブル数   : 8テーブル (マスタ4 / トランザクション4)
-- =============================================================================

-- 1. 診療科マスタ (mst_clinical_depts)
CREATE TABLE `mst_clinical_depts` (
  `dept_id`      VARCHAR(10)  NOT NULL COMMENT '診療科コード',
  `dept_name`    VARCHAR(80)  NOT NULL COMMENT '診療科名 (内科/外科/小児科等)',
  `floor_no`     INT          DEFAULT 1 NOT NULL COMMENT '外来フロア階数',
  `phone_ext`    VARCHAR(10)  COMMENT '内線番号',
  `is_active`    TINYINT(1)   DEFAULT 1 NOT NULL COMMENT '診療受付有効フラグ',
  PRIMARY KEY (`dept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='診療科マスタ';

-- 2. 医師・医療スタッフマスタ (mst_doctors)
CREATE TABLE `mst_doctors` (
  `doctor_id`       VARCHAR(16)  NOT NULL COMMENT '医師ID',
  `doctor_name`     VARCHAR(80)  NOT NULL COMMENT '医師氏名',
  `dept_id`         VARCHAR(10)  NOT NULL COMMENT '主担当診療科コード',
  `license_no`      VARCHAR(30)  NOT NULL COMMENT '医籍登録番号',
  `specialty_title` VARCHAR(100) COMMENT '専門医資格・専門分野',
  `active_flag`     TINYINT(1)   DEFAULT 1 NOT NULL COMMENT '在籍フラグ',
  PRIMARY KEY (`doctor_id`),
  KEY `idx_mst_doctors_dept` (`dept_id`),
  CONSTRAINT `fk_doctors_dept` FOREIGN KEY (`dept_id`) REFERENCES `mst_clinical_depts` (`dept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='医師マスタ';

-- 3. 患者マスタ (mst_patients)
CREATE TABLE `mst_patients` (
  `patient_id`       VARCHAR(16)  NOT NULL COMMENT '患者ID (診察券番号)',
  `patient_name`     VARCHAR(80)  NOT NULL COMMENT '患者氏名',
  `patient_kana`     VARCHAR(80)  NOT NULL COMMENT '患者氏名カナ',
  `birth_date`       DATE         NOT NULL COMMENT '生年月日',
  `gender_code`      CHAR(1)      NOT NULL COMMENT '性別 (M/F/O)',
  `blood_type`       VARCHAR(5)   COMMENT '血液型 (A+/B+/O+/AB+等)',
  `insurance_no`     VARCHAR(30)  COMMENT '健康保険証記号番号',
  `copay_rate_pct`   INT          DEFAULT 30 NOT NULL COMMENT '自己負担割合(10/20/30%)',
  `allergy_notes`    VARCHAR(400) COMMENT '薬物・食物アレルギー特記事項',
  `emergency_phone`  VARCHAR(20)  COMMENT '緊急連絡先電話番号',
  `created_at`       DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '初診登録日時',
  PRIMARY KEY (`patient_id`),
  KEY `idx_mst_patients_kana` (`patient_kana`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='患者マスタ';

-- 4. 医薬品・処置マスタ (mst_medicines)
CREATE TABLE `mst_medicines` (
  `medicine_code`   VARCHAR(16)   NOT NULL COMMENT '医薬品・処置コード(YJコード等)',
  `medicine_name`   VARCHAR(150)  NOT NULL COMMENT '医薬品・処置名称',
  `category_type`   VARCHAR(20)   DEFAULT 'ORAL' NOT NULL COMMENT '剤形区分 (ORAL:内服 / EXT:外用 / INJ:注射)',
  `unit_name`       VARCHAR(20)   DEFAULT '錠' NOT NULL COMMENT '処方単位 (錠/カプセル/ml/回)',
  `nhi_price`       DECIMAL(10,2) DEFAULT 0.00 NOT NULL COMMENT '薬価・診療報酬点数単価',
  `is_generic`      TINYINT(1)    DEFAULT 0 NOT NULL COMMENT 'ジェネリック医薬品フラグ',
  PRIMARY KEY (`medicine_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='医薬品・処置マスタ';

-- 5. 診療予約 (trn_appointments)
CREATE TABLE `trn_appointments` (
  `appointment_id`   VARCHAR(20)  NOT NULL COMMENT '予約番号',
  `patient_id`       VARCHAR(16)  NOT NULL COMMENT '患者ID',
  `dept_id`          VARCHAR(10)  NOT NULL COMMENT '予約診療科コード',
  `doctor_id`        VARCHAR(16)  NOT NULL COMMENT '担当医師ID',
  `reserved_date`    DATE         NOT NULL COMMENT '予約日',
  `reserved_slot`    VARCHAR(15)  NOT NULL COMMENT '予約時間帯枠 (09:00-09:30等)',
  `visit_type`       VARCHAR(15)  DEFAULT 'FOLLOW_UP' NOT NULL COMMENT '初再診区分 (FIRST:初診 / FOLLOW_UP:再診)',
  `appoint_status`   VARCHAR(15)  DEFAULT 'BOOKED' NOT NULL COMMENT '予約状態 (BOOKED:予約済 / CHECKED_IN:受付済 / DONE:診察完了 / CANCELLED:取消)',
  `created_at`       DATETIME     DEFAULT CURRENT_TIMESTAMP NOT NULL COMMENT '予約登録日時',
  PRIMARY KEY (`appointment_id`),
  KEY `idx_trn_appoint_patient` (`patient_id`, `reserved_date`),
  KEY `idx_trn_appoint_doctor` (`doctor_id`, `reserved_date`),
  CONSTRAINT `fk_appoint_patient` FOREIGN KEY (`patient_id`) REFERENCES `mst_patients` (`patient_id`),
  CONSTRAINT `fk_appoint_dept`    FOREIGN KEY (`dept_id`)    REFERENCES `mst_clinical_depts` (`dept_id`),
  CONSTRAINT `fk_appoint_doctor`  FOREIGN KEY (`doctor_id`)  REFERENCES `mst_doctors` (`doctor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='診療予約';

-- 6. カルテ・診察記録 (trn_medical_records)
CREATE TABLE `trn_medical_records` (
  `record_id`        VARCHAR(20)  NOT NULL COMMENT 'カルテ記録ID',
  `appointment_id`   VARCHAR(20)  COMMENT '予約番号',
  `patient_id`       VARCHAR(16)  NOT NULL COMMENT '患者ID',
  `doctor_id`        VARCHAR(16)  NOT NULL COMMENT '診察医師ID',
  `examined_at`      DATETIME     NOT NULL COMMENT '診察日時',
  `chief_complaint`  VARCHAR(300) NOT NULL COMMENT '主訴・自覚症状 (Subjective)',
  `clinical_finding` VARCHAR(500) COMMENT '診察所見・バイタル (Objective)',
  `diagnosis_code`   VARCHAR(20)  NOT NULL COMMENT '傷病名コード (ICD-10)',
  `diagnosis_name`   VARCHAR(150) NOT NULL COMMENT '診断傷病名 (Assessment)',
  `treatment_plan`   VARCHAR(500) COMMENT '治療方針・指導内容 (Plan)',
  PRIMARY KEY (`record_id`),
  KEY `idx_trn_medrec_patient` (`patient_id`, `examined_at`),
  CONSTRAINT `fk_medrec_appoint` FOREIGN KEY (`appointment_id`) REFERENCES `trn_appointments` (`appointment_id`),
  CONSTRAINT `fk_medrec_patient` FOREIGN KEY (`patient_id`)     REFERENCES `mst_patients` (`patient_id`),
  CONSTRAINT `fk_medrec_doctor`  FOREIGN KEY (`doctor_id`)      REFERENCES `mst_doctors` (`doctor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='カルテ・診察記録';

-- 7. 処方オーダー明細 (trn_prescriptions) [カルテ記録ID×処方行番号の複合主キー]
CREATE TABLE `trn_prescriptions` (
  `record_id`      VARCHAR(20)   NOT NULL COMMENT 'カルテ記録ID',
  `line_no`        INT           NOT NULL COMMENT '処方明細番号',
  `medicine_code`  VARCHAR(16)   NOT NULL COMMENT '医薬品コード',
  `daily_dose_qty` DECIMAL(8,2)  NOT NULL COMMENT '1日量',
  `dosage_timing`  VARCHAR(100)  NOT NULL COMMENT '用法 (毎食後3回/就寝前等)',
  `prescribed_days` INT          DEFAULT 1 NOT NULL COMMENT '投与日数・回数',
  `dispense_note`  VARCHAR(200)  COMMENT '調剤薬局向け指示コメント',
  PRIMARY KEY (`record_id`, `line_no`),
  KEY `idx_trn_presc_medicine` (`medicine_code`),
  CONSTRAINT `fk_presc_record`   FOREIGN KEY (`record_id`)     REFERENCES `trn_medical_records` (`record_id`),
  CONSTRAINT `fk_presc_medicine` FOREIGN KEY (`medicine_code`) REFERENCES `mst_medicines` (`medicine_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='処方オーダー明細';

-- 8. 診療会計・請求 (trn_medical_bills)
CREATE TABLE `trn_medical_bills` (
  `bill_id`           VARCHAR(20)   NOT NULL COMMENT '会計伝票番号',
  `record_id`         VARCHAR(20)   NOT NULL COMMENT 'カルテ記録ID',
  `patient_id`        VARCHAR(16)   NOT NULL COMMENT '患者ID',
  `billing_date`      DATE          NOT NULL COMMENT '診療会計日',
  `total_medical_pts` INT           DEFAULT 0 NOT NULL COMMENT '総診療報酬点数',
  `insurance_claim_amt` DECIMAL(12,2) DEFAULT 0.00 NOT NULL COMMENT '保険者請求額',
  `patient_copay_amt` DECIMAL(12,2) DEFAULT 0.00 NOT NULL COMMENT '患者窓口自己負担額',
  `payment_status`    VARCHAR(15)   DEFAULT 'UNPAID' NOT NULL COMMENT '精算状態 (UNPAID:未精算 / PAID:精算済)',
  `paid_at`           DATETIME      COMMENT '精算完了日時',
  PRIMARY KEY (`bill_id`),
  KEY `idx_trn_bills_patient` (`patient_id`, `billing_date`),
  CONSTRAINT `fk_bills_record`  FOREIGN KEY (`record_id`)  REFERENCES `trn_medical_records` (`record_id`),
  CONSTRAINT `fk_bills_patient` FOREIGN KEY (`patient_id`) REFERENCES `mst_patients` (`patient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='診療会計・請求';
