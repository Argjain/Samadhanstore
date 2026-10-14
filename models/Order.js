// models/Order.js
const db = require('../config/db');
const crypto = require('crypto');

const Order = {
  async create(data, connection = db) {
    const orderId = 'SAM' + crypto.randomBytes(12).toString('hex').toUpperCase();
    const [r] = await connection.query(
      `INSERT INTO orders (order_id,user_id,name,email,phone,address,city,state,pincode,items,subtotal,discount,coupon_code,shipping,gst,total,payment_method,payment_id,payment_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId,data.userId||null,data.name,data.email,data.phone,data.address,data.city,data.state,data.pincode,
       JSON.stringify(data.items),data.subtotal,data.discount||0,data.couponCode||null,data.shipping,data.gst||0,data.total,
       data.paymentMethod||'cod',data.paymentId||null,data.paymentStatus||'pending']
    );
    return { id: r.insertId, orderId };
  },

  async getById(orderId) {
    const [rows] = await db.query('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    // FIX: Yahan check lagaya hai ki typeof string hai ya nahi
    if (rows[0]) {
        rows[0].items = typeof rows[0].items === 'string' ? JSON.parse(rows[0].items) : rows[0].items;
    }
    return rows[0] || null;
  },

  async getByUser(userId) {
    const [rows] = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    // FIX: Yahan bhi check update kiya
    return rows.map(r => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items }));
  },

  async getAll({ status, limit = 50, offset = 0, search } = {}) {
    let where = '1=1'; const params = [];
    if (status) { where += ' AND order_status = ?'; params.push(status); }
    if (search) { where += ' AND (order_id LIKE ? OR name LIKE ? OR phone LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    params.push(limit, offset);
    const [rows] = await db.query(`SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params);
    // FIX: Yahan bhi check update kiya
    return rows.map(r => ({ ...r, items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items }));
  },

  async updateStatus(orderId, status, trackingId = null) {
    await db.query('UPDATE orders SET order_status=?, tracking_id=COALESCE(?,tracking_id) WHERE order_id=?', [status, trackingId, orderId]);
  },
  
  async updatePayment(orderId, paymentId, status) {
    await db.query('UPDATE orders SET payment_id=?,payment_status=? WHERE order_id=?', [paymentId, status, orderId]);
  },
  
  async getStats() {
    const [[s]] = await db.query(`SELECT COUNT(*) as total, SUM(CASE WHEN payment_status='paid' THEN total ELSE 0 END) as revenue, SUM(CASE WHEN order_status='placed' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN DATE(created_at)=CURDATE() THEN 1 ELSE 0 END) as today, SUM(CASE WHEN order_status='shipped' THEN 1 ELSE 0 END) as shipped FROM orders`);
    return s;
  },
};

module.exports = Order;
