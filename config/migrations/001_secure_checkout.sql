-- Additive migration. Does not change or remove existing orders, products or uploads.
CREATE TABLE IF NOT EXISTS secure_checkouts (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mode VARCHAR(10) NOT NULL,
  method VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  gateway_order_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
  payment_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
  order_id VARCHAR(50) UNIQUE,
  snapshot JSON NOT NULL,
  stock_reserved TINYINT(1) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL,
  last_error VARCHAR(100),
  email_notified TINYINT(1) NOT NULL DEFAULT 0,
  sms_notified TINYINT(1) NOT NULL DEFAULT 0,
  notification_after DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX checkout_reconcile (status, expires_at)
) ENGINE=InnoDB;
