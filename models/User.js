// models/User.js
const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const tokenHash = token => 'sha256:' + crypto.createHash('sha256').update(String(token)).digest('hex');

const User = {
  async create(data) {
    const hashed = await bcrypt.hash(data.password, 10);
    const [r] = await db.query(
      'INSERT INTO users (name,email,phone,password) VALUES (?,?,?,?)',
      [data.name, data.email, data.phone||null, hashed]
    );
    return r.insertId;
  },
  async findByEmail(email) {
    const [rows] = await db.query('SELECT u.*, COALESCE(s.session_version,0) AS session_version FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.email = ?', [email]);
    return rows[0] || null;
  },
  async findById(id) {
    const [rows] = await db.query('SELECT u.id,u.name,u.email,u.phone,u.role,u.created_at,COALESCE(s.session_version,0) AS session_version FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.id = ?', [id]);
    return rows[0] || null;
  },
  async verifyPassword(plain, hashed) { return bcrypt.compare(plain, hashed); },
  async getAll() {
    const [rows] = await db.query('SELECT id,name,email,phone,role,created_at FROM users ORDER BY created_at DESC');
    return rows;
  },
  async getStats() {
    const [[s]] = await db.query('SELECT COUNT(*) as total FROM users WHERE role="user"');
    return s;
  },

  // ─── NAYE FUNCTIONS: FORGOT PASSWORD KE LIYE ───
  async saveResetToken(email, token, expires) {
    await db.query(
      'UPDATE users SET resetPasswordToken = ?, resetPasswordExpires = ? WHERE email = ?',
      [token ? tokenHash(token) : null, expires, email]
    );
  },
  async findByToken(token) {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE resetPasswordToken = ? AND resetPasswordExpires > UTC_TIMESTAMP()',
      [tokenHash(token)]
    );
    return rows[0] || null;
  },
  async updatePassword(id, newPassword, token) {
    const hashed = await bcrypt.hash(newPassword, 10);
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        'UPDATE users SET password=?,resetPasswordToken=NULL,resetPasswordExpires=NULL WHERE id=? AND resetPasswordToken=? AND resetPasswordExpires>UTC_TIMESTAMP()',
        [hashed,id,tokenHash(token)]);
      if (result.affectedRows !== 1) {await conn.rollback();return false;}
      await conn.query('INSERT INTO user_security (user_id,session_version) VALUES (?,1) ON DUPLICATE KEY UPDATE session_version=session_version+1',[id]);
      await conn.commit();return true;
    } catch(err) {await conn.rollback();throw err;} finally {conn.release();}
  },
  async clearResetToken(email, token) {
    await db.query('UPDATE users SET resetPasswordToken=NULL,resetPasswordExpires=NULL WHERE email=? AND resetPasswordToken=?',[email,tokenHash(token)]);
  }

};

// ─── Review Model ───────────────────────────────
const Review = {
  async getByProduct(productId, approvedOnly = true) {
    const where = approvedOnly ? 'AND is_approved = 1 AND rating BETWEEN 1 AND 5' : '';
    const [rows] = await db.query(
      `SELECT * FROM reviews WHERE product_id = ? ${where} ORDER BY created_at DESC`,
      [productId]
    );
    return rows;
  },
  async create(data) {
    if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5) throw new Error('Choose a rating from 1 to 5.');
    const [r] = await db.query(
      'INSERT INTO reviews (product_id,user_id,name,email,rating,title,review) VALUES (?,?,?,?,?,?,?)',
      [data.productId, data.userId||null, data.name, data.email||null, data.rating, data.title||null, data.review]
    );
    return r.insertId;
  },
  async getAll({ approved } = {}) {
    let where = '1=1';
    if (approved !== undefined) where = `is_approved = ${approved ? 1 : 0}`;
    const [rows] = await db.query(
      `SELECT r.*, p.name as product_name FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       WHERE ${where} ORDER BY r.created_at DESC`
    );
    return rows;
  },
  async approve(id) { await db.query('UPDATE reviews SET is_approved = 1 WHERE id = ?', [id]); },
  async delete(id)  { await db.query('DELETE FROM reviews WHERE id = ?', [id]); },
};

// ─── Banner Model ────────────────────────────────
const Banner = {
  async getActive() {
    const [rows] = await db.query('SELECT * FROM banners WHERE is_active = 1 ORDER BY sort_order ASC');
    return rows;
  },
  async getAll() {
    const [rows] = await db.query('SELECT * FROM banners ORDER BY sort_order ASC');
    return rows;
  },
  async create(data) {
    await db.query(
      'INSERT INTO banners (text,link,image,bg_color,text_color,is_active,sort_order) VALUES (?,?,?,?,?,?,?)',
      [data.text||'', data.link||null, data.image||null, data.bg_color||'#2d1b69', data.text_color||'#ffffff', 1, data.sort_order||0]
    );
  },
  async update(id, data) {
    let q = 'UPDATE banners SET text=?,link=?,bg_color=?,text_color=?,is_active=?';
    let params = [data.text||'', data.link||null, data.bg_color, data.text_color, data.is_active?1:0];
    if(data.image) { q += ',image=?'; params.push(data.image); }
    q += ' WHERE id=?'; params.push(id);
    await db.query(q, params);
  },
  async delete(id) { await db.query('DELETE FROM banners WHERE id = ?', [id]); },
};

// ─── Wishlist Model ───────────────────────────────
const Wishlist = {
  async get(userId) {
    const [rows] = await db.query(
      `SELECT w.*, p.name, p.slug, p.price, p.original_price, p.images, p.badge
       FROM wishlist w JOIN products p ON w.product_id = p.id
       WHERE w.user_id = ? ORDER BY w.created_at DESC`,
      [userId]
    );
    return rows.map(r => ({ ...r, images: Array.isArray(r.images) ? r.images : JSON.parse(r.images || '[]') }));
  },
  async toggle(userId, productId) {
    const [exists] = await db.query('SELECT id FROM wishlist WHERE user_id=? AND product_id=?', [userId, productId]);
    if (exists.length > 0) {
      await db.query('DELETE FROM wishlist WHERE user_id=? AND product_id=?', [userId, productId]);
      return false; // removed
    } else {
      await db.query('INSERT INTO wishlist (user_id, product_id) VALUES (?,?)', [userId, productId]);
      return true; // added
    }
  },
  async isWishlisted(userId, productId) {
    const [rows] = await db.query('SELECT id FROM wishlist WHERE user_id=? AND product_id=?', [userId, productId]);
    return rows.length > 0;
  },
  async getUserWishlistIds(userId) {
    const [rows] = await db.query('SELECT product_id FROM wishlist WHERE user_id=?', [userId]);
    return rows.map(r => r.product_id);
  },
};

// ─── Coupon Model ────────────────────────────────
const Coupon = {
  async validate(code, orderAmount) {
    const [rows] = await db.query(
      `SELECT * FROM coupons WHERE code=? AND is_active=1
       AND (expires_at IS NULL OR expires_at >= CURDATE())
       AND used_count < max_uses`,
      [code.toUpperCase().trim()]
    );
    const coupon = rows[0];
    if (!coupon) return { valid: false, message: 'Invalid or expired coupon code.' };
    if (orderAmount < coupon.min_order) return { valid: false, message: `Minimum order of ₹${coupon.min_order} is required.` };
    let discount = coupon.type === 'percent'
      ? Math.round(orderAmount * coupon.value / 100)
      : coupon.value;
    discount = Math.min(discount, orderAmount);
    return {
      valid: true, coupon, discount,
      message: coupon.type === 'percent'
        ? `${coupon.value}% discount! You saved ₹${discount}.`
        : `₹${discount} discount applied!`
    };
  },
  async incrementUse(code) {
    await db.query('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?', [code.toUpperCase()]);
  },
  async getAll() {
    const [rows] = await db.query('SELECT * FROM coupons ORDER BY created_at DESC');
    return rows;
  },
  async create(data) {
    await db.query(
      'INSERT INTO coupons (code,type,value,min_order,max_uses,expires_at) VALUES (?,?,?,?,?,?)',
      [data.code.toUpperCase(), data.type, data.value, data.min_order||0, data.max_uses||100, data.expires_at||null]
    );
  },
  async update(id, data) {
    await db.query(
      'UPDATE coupons SET code=?,type=?,value=?,min_order=?,max_uses=?,expires_at=?,is_active=? WHERE id=?',
      [data.code.toUpperCase(), data.type, data.value, data.min_order||0, data.max_uses||100, data.expires_at||null, data.is_active?1:0, id]
    );
  },
  async toggleActive(id) { await db.query('UPDATE coupons SET is_active = NOT is_active WHERE id = ?', [id]); },
  async delete(id)        { await db.query('DELETE FROM coupons WHERE id = ?', [id]); },
};

// ─── Festival Offer Model ─────────────────────────
const FestivalOffer = {
  async getActive() {
    const [rows] = await db.query(
      `SELECT * FROM festival_offers WHERE is_active=1
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY created_at DESC LIMIT 1`
    );
    return rows[0] || null;
  },
  async getAll() {
    const [rows] = await db.query('SELECT * FROM festival_offers ORDER BY created_at DESC');
    return rows;
  },
  async create(data) {
    await db.query(
      'INSERT INTO festival_offers (title,description,discount,coupon_code,starts_at,ends_at,is_active) VALUES (?,?,?,?,?,?,?)',
      [data.title, data.description||null, data.discount||0, data.coupon_code||null, data.starts_at||null, data.ends_at||null, 1]
    );
  },
  async update(id, data) {
    await db.query(
      'UPDATE festival_offers SET title=?,description=?,discount=?,coupon_code=?,starts_at=?,ends_at=?,is_active=? WHERE id=?',
      [data.title, data.description||null, data.discount||0, data.coupon_code||null, data.starts_at||null, data.ends_at||null, data.is_active?1:0, id]
    );
  },
  async delete(id) { await db.query('DELETE FROM festival_offers WHERE id = ?', [id]); },
};

module.exports = { User, Review, Banner, Wishlist, Coupon, FestivalOffer };
