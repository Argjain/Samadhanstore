require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./app');
async function migrate() {
  const db = await mysql.createConnection(config.db);
  try {
    const [engines] = await db.query("SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('orders','products','coupons','users')");
    if (engines.length !== 4 || engines.some(r => r.ENGINE !== 'InnoDB')) {
      throw new Error('orders, products, coupons and users must exist and use InnoDB. No existing tables were changed.');
    }
    await db.query(fs.readFileSync(path.join(__dirname, 'migrations/001_secure_checkout.sql'), 'utf8'));
    await db.query('SELECT id,owner_key,mode,method,status,gateway_order_id,payment_id,order_id,snapshot,stock_reserved,expires_at,last_error,email_notified,sms_notified,notification_after FROM secure_checkouts LIMIT 0');
    await db.query(fs.readFileSync(path.join(__dirname, 'migrations/002_user_security.sql'), 'utf8'));
    console.log('Secure checkout table ready. Existing store data and uploaded files were preserved.');
  } finally { await db.end(); }
}
if (require.main === module) migrate().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = migrate;
