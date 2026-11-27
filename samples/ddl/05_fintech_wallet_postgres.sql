-- =============================================================================
-- サンプルDDL 05: 金融・ウォレット決済・複式仕訳システム (FinTech Wallet & Double-Entry Ledger)
-- 対象DBMS方言 : PostgreSQL
-- 推奨スキーマ名: fintech_wallet
-- テーブル数   : 7テーブル (マスタ3 / トランザクション4)
-- =============================================================================

-- 1. 顧客・KYCマスタ (mst_customers)
CREATE TABLE mst_customers (
  customer_id     VARCHAR(20)  NOT NULL,
  customer_name   VARCHAR(100) NOT NULL,
  customer_type   VARCHAR(15)  DEFAULT 'INDIVIDUAL' NOT NULL,
  kyc_level       VARCHAR(15)  DEFAULT 'VERIFIED' NOT NULL,
  risk_rating     VARCHAR(10)  DEFAULT 'LOW' NOT NULL,
  email           VARCHAR(150) NOT NULL,
  registered_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_mst_customers PRIMARY KEY (customer_id)
);

CREATE UNIQUE INDEX uq_mst_customers_email ON mst_customers (email);

COMMENT ON TABLE  mst_customers IS '顧客・KYCマスタ';
COMMENT ON COLUMN mst_customers.customer_id   IS '顧客ID';
COMMENT ON COLUMN mst_customers.customer_name IS '顧客名・法人名';
COMMENT ON COLUMN mst_customers.customer_type IS '顧客種別 (INDIVIDUAL:個人 / MERCHANT:加盟店 / CORPORATE:法人)';
COMMENT ON COLUMN mst_customers.kyc_level     IS '本人確認状態 (UNVERIFIED:未確認 / VERIFIED:確認済 / FROZEN:凍結)';
COMMENT ON COLUMN mst_customers.risk_rating   IS 'AMLリスク評価 (LOW / MEDIUM / HIGH)';
COMMENT ON COLUMN mst_customers.email         IS '連絡先メールアドレス';
COMMENT ON COLUMN mst_customers.registered_at IS '登録日時';

-- 2. ウォレット口座マスタ (mst_accounts)
CREATE TABLE mst_accounts (
  account_id        VARCHAR(20)   NOT NULL,
  customer_id       VARCHAR(20)   NOT NULL,
  account_type      VARCHAR(20)   DEFAULT 'WALLET' NOT NULL,
  currency_code     CHAR(3)       DEFAULT 'JPY' NOT NULL,
  current_balance   NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  available_balance NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  account_status    VARCHAR(15)   DEFAULT 'ACTIVE' NOT NULL,
  opened_at         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_mst_accounts PRIMARY KEY (account_id)
);

CREATE INDEX idx_mst_accounts_customer ON mst_accounts (customer_id);

COMMENT ON TABLE  mst_accounts IS 'ウォレット口座マスタ';
COMMENT ON COLUMN mst_accounts.account_id        IS '口座番号';
COMMENT ON COLUMN mst_accounts.customer_id       IS '口座保有顧客ID';
COMMENT ON COLUMN mst_accounts.account_type      IS '口座種別 (WALLET:一般ウォレット / SETTLEMENT:加盟店精算 / ESCROW:預り金)';
COMMENT ON COLUMN mst_accounts.currency_code     IS '通貨コード (JPY/USD/EUR)';
COMMENT ON COLUMN mst_accounts.current_balance   IS '帳簿残高';
COMMENT ON COLUMN mst_accounts.available_balance IS '出金・決済可能残高';
COMMENT ON COLUMN mst_accounts.account_status    IS '口座状態 (ACTIVE:有効 / SUSPENDED:一時停止 / CLOSED:解約)';
COMMENT ON COLUMN mst_accounts.opened_at         IS '口座開設日時';
COMMENT ON COLUMN mst_accounts.updated_at        IS '最終残高更新日時';

-- 3. 勘定科目マスタ (mst_account_titles)
CREATE TABLE mst_account_titles (
  title_code      VARCHAR(12)  NOT NULL,
  title_name      VARCHAR(100) NOT NULL,
  bs_pl_category  VARCHAR(15)  NOT NULL,
  normal_side     CHAR(2)      NOT NULL,
  active_flag     BOOLEAN      DEFAULT TRUE NOT NULL,
  CONSTRAINT pk_mst_account_titles PRIMARY KEY (title_code)
);

COMMENT ON TABLE  mst_account_titles IS '勘定科目マスタ';
COMMENT ON COLUMN mst_account_titles.title_code     IS '勘定科目コード';
COMMENT ON COLUMN mst_account_titles.title_name     IS '勘定科目名称';
COMMENT ON COLUMN mst_account_titles.bs_pl_category IS '財務諸表区分 (ASSET:資産 / LIABILITY:負債 / EQUITY:純資産 / REVENUE:収益 / EXPENSE:費用)';
COMMENT ON COLUMN mst_account_titles.normal_side    IS '正常残高貸借区分 (DR:借方 / CR:貸方)';
COMMENT ON COLUMN mst_account_titles.active_flag    IS '使用可否フラグ';

-- 4. 決済・送金トランザクション (trn_transactions)
CREATE TABLE trn_transactions (
  tx_id             VARCHAR(28)   NOT NULL,
  idempotency_key   VARCHAR(64)   NOT NULL,
  tx_type           VARCHAR(20)   NOT NULL,
  from_account_id   VARCHAR(20)   NOT NULL,
  to_account_id     VARCHAR(20)   NOT NULL,
  currency_code     CHAR(3)       DEFAULT 'JPY' NOT NULL,
  tx_amount         NUMERIC(18,2) NOT NULL,
  fee_amount        NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  tx_status         VARCHAR(15)   DEFAULT 'AUTHORIZED' NOT NULL,
  settled_at        TIMESTAMP,
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_trn_transactions PRIMARY KEY (tx_id)
);

CREATE UNIQUE INDEX uq_trn_tx_idempotency ON trn_transactions (idempotency_key);
CREATE INDEX idx_trn_tx_from_acc ON trn_transactions (from_account_id, created_at);
CREATE INDEX idx_trn_tx_to_acc   ON trn_transactions (to_account_id, created_at);

COMMENT ON TABLE  trn_transactions IS '決済・送金トランザクション';
COMMENT ON COLUMN trn_transactions.tx_id           IS 'トランザクションID';
COMMENT ON COLUMN trn_transactions.idempotency_key IS '冪等性保証キー';
COMMENT ON COLUMN trn_transactions.tx_type         IS '取引種別 (CHARGE:チャージ / PAYMENT:決済 / TRANSFER:送金 / REFUND:返金)';
COMMENT ON COLUMN trn_transactions.from_account_id IS '出金元口座番号';
COMMENT ON COLUMN trn_transactions.to_account_id   IS '入金先口座番号';
COMMENT ON COLUMN trn_transactions.currency_code   IS '取引通貨コード';
COMMENT ON COLUMN trn_transactions.tx_amount       IS '取引金額';
COMMENT ON COLUMN trn_transactions.fee_amount      IS '決済手数料額';
COMMENT ON COLUMN trn_transactions.tx_status       IS '決済状態 (AUTHORIZED:承認済 / SETTLED:確定済 / REVERSED:取消済)';
COMMENT ON COLUMN trn_transactions.settled_at      IS '決済確定日時';
COMMENT ON COLUMN trn_transactions.created_at      IS '取引発生日時';

-- 5. 複式仕訳ヘッダ (trn_journal_headers)
CREATE TABLE trn_journal_headers (
  journal_id      VARCHAR(28)   NOT NULL,
  tx_id           VARCHAR(28)   NOT NULL,
  accounting_date DATE          NOT NULL,
  total_debit_amt NUMERIC(18,2) NOT NULL,
  total_credit_amt NUMERIC(18,2) NOT NULL,
  journal_summary VARCHAR(200)  NOT NULL,
  posted_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT pk_trn_journal_headers PRIMARY KEY (journal_id)
);

CREATE INDEX idx_trn_journal_tx ON trn_journal_headers (tx_id);

COMMENT ON TABLE  trn_journal_headers IS '複式仕訳ヘッダ';
COMMENT ON COLUMN trn_journal_headers.journal_id       IS '仕訳伝票番号';
COMMENT ON COLUMN trn_journal_headers.tx_id            IS '元取引トランザクションID';
COMMENT ON COLUMN trn_journal_headers.accounting_date  IS '会計計上日';
COMMENT ON COLUMN trn_journal_headers.total_debit_amt  IS '借方合計金額';
COMMENT ON COLUMN trn_journal_headers.total_credit_amt IS '貸方合計金額';
COMMENT ON COLUMN trn_journal_headers.journal_summary  IS '仕訳摘要';
COMMENT ON COLUMN trn_journal_headers.posted_at        IS '仕訳起票日時';

-- 6. 複式仕訳明細 (trn_journal_entries) [仕訳伝票番号×明細行番号の複合主キー]
CREATE TABLE trn_journal_entries (
  journal_id      VARCHAR(28)   NOT NULL,
  entry_line_no   INTEGER       NOT NULL,
  dr_cr_side      CHAR(2)       NOT NULL,
  title_code      VARCHAR(12)   NOT NULL,
  account_id      VARCHAR(20)   NOT NULL,
  entry_amount    NUMERIC(18,2) NOT NULL,
  line_note       VARCHAR(150),
  CONSTRAINT pk_trn_journal_entries PRIMARY KEY (journal_id, entry_line_no)
);

CREATE INDEX idx_trn_jnl_entries_acc ON trn_journal_entries (account_id);
CREATE INDEX idx_trn_jnl_entries_title ON trn_journal_entries (title_code);

COMMENT ON TABLE  trn_journal_entries IS '複式仕訳明細';
COMMENT ON COLUMN trn_journal_entries.journal_id    IS '仕訳伝票番号';
COMMENT ON COLUMN trn_journal_entries.entry_line_no IS '仕訳行番号';
COMMENT ON COLUMN trn_journal_entries.dr_cr_side    IS '貸借区分 (DR:借方 / CR:貸方)';
COMMENT ON COLUMN trn_journal_entries.title_code    IS '勘定科目コード';
COMMENT ON COLUMN trn_journal_entries.account_id    IS '補助元帳対象口座番号';
COMMENT ON COLUMN trn_journal_entries.entry_amount  IS '仕訳金額';
COMMENT ON COLUMN trn_journal_entries.line_note     IS '明細摘要';

-- 7. 口座別日次残高スナップショット (trn_daily_balances) [口座番号×基準日の複合主キー]
CREATE TABLE trn_daily_balances (
  account_id        VARCHAR(20)   NOT NULL,
  snapshot_date     DATE          NOT NULL,
  opening_balance   NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  total_inflow_amt  NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  total_outflow_amt NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  closing_balance   NUMERIC(18,2) DEFAULT 0.00 NOT NULL,
  tx_count          INTEGER       DEFAULT 0 NOT NULL,
  CONSTRAINT pk_trn_daily_balances PRIMARY KEY (account_id, snapshot_date)
);

COMMENT ON TABLE  trn_daily_balances IS '口座別日次残高スナップショット';
COMMENT ON COLUMN trn_daily_balances.account_id        IS '口座番号';
COMMENT ON COLUMN trn_daily_balances.snapshot_date     IS '残高基準日';
COMMENT ON COLUMN trn_daily_balances.opening_balance   IS '当日開始残高';
COMMENT ON COLUMN trn_daily_balances.total_inflow_amt  IS '当日入金合計額';
COMMENT ON COLUMN trn_daily_balances.total_outflow_amt IS '当日出金合計額';
COMMENT ON COLUMN trn_daily_balances.closing_balance   IS '当日終了残高';
COMMENT ON COLUMN trn_daily_balances.tx_count          IS '当日取引件数';

-- =============================================================================
-- 外部キー制約定義 (Foreign Keys)
-- =============================================================================
ALTER TABLE mst_accounts
  ADD CONSTRAINT fk_accounts_customer FOREIGN KEY (customer_id)
  REFERENCES mst_customers (customer_id);

ALTER TABLE trn_transactions
  ADD CONSTRAINT fk_tx_from_account FOREIGN KEY (from_account_id)
  REFERENCES mst_accounts (account_id);

ALTER TABLE trn_transactions
  ADD CONSTRAINT fk_tx_to_account FOREIGN KEY (to_account_id)
  REFERENCES mst_accounts (account_id);

ALTER TABLE trn_journal_headers
  ADD CONSTRAINT fk_jnl_tx FOREIGN KEY (tx_id)
  REFERENCES trn_transactions (tx_id);

ALTER TABLE trn_journal_entries
  ADD CONSTRAINT fk_jnl_entry_header FOREIGN KEY (journal_id)
  REFERENCES trn_journal_headers (journal_id);

ALTER TABLE trn_journal_entries
  ADD CONSTRAINT fk_jnl_entry_title FOREIGN KEY (title_code)
  REFERENCES mst_account_titles (title_code);

ALTER TABLE trn_journal_entries
  ADD CONSTRAINT fk_jnl_entry_account FOREIGN KEY (account_id)
  REFERENCES mst_accounts (account_id);

ALTER TABLE trn_daily_balances
  ADD CONSTRAINT fk_daily_bal_account FOREIGN KEY (account_id)
  REFERENCES mst_accounts (account_id);
