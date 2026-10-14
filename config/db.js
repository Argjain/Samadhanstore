// config/db.js
const mysql  = require('mysql2/promise');
const config = require('./app');

const pool = mysql.createPool(config.db);

(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected');
    conn.release();
  } catch(err) {
    console.error('❌ MySQL error:', err.message);
    // Let the request/startup boundary report the failure without an unhandled exit.
  }
})();

module.exports = pool;
