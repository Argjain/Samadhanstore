const crypto = require('crypto');
const db = require('../config/db');
const config = require('../config/app');
const pricing = require('./pricing');
const Order = require('../models/Order');
const { equal } = require('./orderAccess');
let gateway;
function client() {
  if (!gateway) {
    gateway = new (require('razorpay'))({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
    // SDK 2.9.6 does not accept a constructor timeout; configure its Axios client.
    gateway.api.rq.defaults.timeout = 15000;
  }
  return gateway;
}
const parse = row => row ? { ...row, snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot } : null;
function owner(req) {
  if (!req.session.checkoutOwner) req.session.checkoutOwner = crypto.randomBytes(32).toString('hex');
  return req.session.checkoutOwner;
}
function signature(id, ownerKey, mode) {
  return crypto.createHmac('sha256', config.session.secret).update('checkout:' + id + ':' + ownerKey + ':' + mode).digest('hex');
}
function issue(req, mode) {
  const id = crypto.randomUUID();
  return id + '.' + signature(id, owner(req), mode);
}
function verifyToken(req, mode) {
  const value = req.body.checkoutToken;
  if (typeof value !== 'string') throw pricing.fail('Please reload checkout before placing your order.');
  const [id, sig] = value.split('.');
  if (!/^[a-f0-9-]{36}$/.test(id) || !equal(sig, signature(id, owner(req), mode))) throw pricing.fail('Checkout has expired. Please reload the page.');
  return id;
}
async function transaction(fn) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      if (e.code === 'ER_LOCK_DEADLOCK' && attempt < 2) continue;
      throw e;
    } finally { conn.release(); }
  }
}
async function get(id, conn = db, lock = false) {
  const [rows] = await conn.query('SELECT * FROM secure_checkouts WHERE id=?' + (lock ? ' FOR UPDATE' : ''), [id]);
  return parse(rows[0]);
}
async function byGateway(id) {
  const [rows] = await db.query('SELECT * FROM secure_checkouts WHERE gateway_order_id=?', [id]);
  return parse(rows[0]);
}
async function reserve(conn, snapshot) {
  // Lock products in a stable order. Every decrement is conditional on actual stock.
  for (const i of [...snapshot.items].sort((a,b) => a.id-b.id)) {
    const [r] = await conn.query('UPDATE products SET stock=stock-? WHERE id=? AND is_active=1 AND stock>=?', [i.qty, i.id, i.qty]);
    if (r.affectedRows !== 1) throw pricing.fail('A product has sold out. Please update your cart.');
  }
  if (snapshot.couponCode) {
    const [r] = await conn.query('UPDATE coupons SET used_count=used_count+1 WHERE code=? AND is_active=1 AND used_count<max_uses AND (expires_at IS NULL OR expires_at>=CURDATE())', [snapshot.couponCode]);
    if (r.affectedRows !== 1) throw pricing.fail('This coupon is no longer available.');
  }
}
async function release(conn, row) {
  if (!row.stock_reserved) return;
  for (const i of [...row.snapshot.items].sort((a,b) => a.id-b.id)) await conn.query('UPDATE products SET stock=stock+? WHERE id=?', [i.qty, i.id]);
  if (row.snapshot.couponCode) await conn.query('UPDATE coupons SET used_count=GREATEST(0,used_count-1) WHERE code=?', [row.snapshot.couponCode]);
  await conn.query("UPDATE secure_checkouts SET stock_reserved=0,status='expired' WHERE id=?", [row.id]);
}
async function prepare({ id, ownerKey, mode, method, cart, code, delivery, userId, expectedTotal }) {
  return transaction(async conn => {
    // Unique key serializes retries, including simultaneous double clicks.
    await conn.query("INSERT INTO secure_checkouts (id,owner_key,mode,method,snapshot,expires_at) VALUES (?,?,?,?,'{}',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE)) ON DUPLICATE KEY UPDATE id=id", [id,ownerKey,mode,method]);
    const existing = await get(id, conn, true);
    if (!equal(existing.owner_key, ownerKey) || existing.mode !== mode || existing.method !== method) throw pricing.fail('This checkout is already being used. Reload checkout to change payment method.');
    if (existing.order_id || existing.gateway_order_id) {
      if (existing.status === 'expired' || existing.status === 'review') throw pricing.fail('This checkout needs to be refreshed. If you paid, contact support with your payment ID.');
      if (Number(expectedTotal) !== existing.snapshot.total || Object.keys(delivery).some(key=>delivery[key] !== existing.snapshot[key])) throw pricing.fail('This payment already has saved delivery details and a total. Reload checkout to start a different order.');
      return existing;
    }
    const quote = await pricing.quote(cart, code, conn, true);
    const total = method === 'online' ? quote.onlineTotal : quote.total;
    // The supplied total is only a change detector, never the source of the charge.
    if (!Number.isFinite(Number(expectedTotal)) || pricing.money(expectedTotal) !== total) throw pricing.fail('Prices or offers changed. Please reload checkout to review the updated total.');
    const snapshot = { ...delivery, userId: userId || null, items: Object.values(quote.cart),
      subtotal: quote.subtotal, discount: quote.discount + (method === 'online' ? quote.onlineDiscount : 0),
      couponCode: quote.couponCode, shipping: quote.shipping, gst: quote.gst, total,
      cart: quote.cart, couponDiscount: quote.discount, onlineDiscount: method === 'online' ? quote.onlineDiscount : 0 };
    await reserve(conn, snapshot);
    if (method === 'cod') {
      const result = await Order.create({ ...snapshot, paymentMethod: 'cod', paymentStatus: 'pending' }, conn);
      await conn.query("UPDATE secure_checkouts SET snapshot=?,stock_reserved=1,status='complete',order_id=? WHERE id=?", [JSON.stringify(snapshot),result.orderId,id]);
    } else {
      if (!config.razorpay.keyId || !config.razorpay.keySecret) throw pricing.fail('Online payments are temporarily unavailable.');
      const amount = Math.round(total * 100);
      if (!Number.isSafeInteger(amount) || amount < 100) throw pricing.fail('Online payment requires an order total of at least ₹1.');
      const remote = await client().orders.create({ amount, currency: 'INR', receipt: id, notes: { checkout_id: id } });
      if (!remote.id || Number(remote.amount) !== amount || remote.currency !== 'INR') throw new Error('Invalid gateway order response');
      await conn.query('UPDATE secure_checkouts SET snapshot=?,stock_reserved=1,gateway_order_id=? WHERE id=?', [JSON.stringify(snapshot),remote.id,id]);
    }
    return get(id, conn);
  });
}
function verifyPayment(row, payment) {
  if (!payment || payment.order_id !== row.gateway_order_id || payment.currency !== 'INR' ||
      Number(payment.amount) !== Math.round(row.snapshot.total * 100) || payment.status !== 'captured' ||
      Number(payment.amount_refunded || 0) !== 0 || typeof payment.id !== 'string') {
    throw pricing.fail('Payment is not confirmed yet. Do not pay again. Please contact support if money was deducted.');
  }
}
async function complete(id, payment) {
  return transaction(async conn => {
    const row = await get(id, conn, true);
    if (!row || !row.gateway_order_id) throw pricing.fail('Checkout not found.');
    verifyPayment(row, payment);
    if (row.status === 'complete') {
      if (row.payment_id !== payment.id) throw pricing.fail('Payment is already assigned.');
      return { ...row, newlyCompleted: false };
    }
    const [used] = await conn.query('SELECT order_id FROM orders WHERE payment_id=? LIMIT 1', [payment.id]);
    if (used.length) throw pricing.fail('This payment is already assigned to an order.');
    await conn.query('SAVEPOINT reserve_retry');
    if (!row.stock_reserved) {
      try { await reserve(conn, row.snapshot); }
      catch (e) {
        await conn.query('ROLLBACK TO SAVEPOINT reserve_retry');
        if (!e.publicMessage) throw e;
        // A late payment can arrive after a reservation expires. Record it for support;
        // never silently oversell, lose the payment, or mark an unfulfillable order shipped.
        await conn.query("UPDATE secure_checkouts SET payment_id=?,status='review',last_error='late_payment_inventory' WHERE id=?", [payment.id,id]);
        return { ...row, payment_id: payment.id, status: 'review', newlyCompleted: false };
      }
    }
    const result = await Order.create({ ...row.snapshot, paymentId: payment.id, paymentMethod: 'online', paymentStatus: 'paid' }, conn);
    await conn.query("UPDATE secure_checkouts SET stock_reserved=1,payment_id=?,order_id=?,status='complete',last_error=NULL WHERE id=?", [payment.id,result.orderId,id]);
    return { ...row, order_id: result.orderId, payment_id: payment.id, status: 'complete', newlyCompleted: true };
  });
}
async function confirm(row, paymentId) {
  return complete(row.id, await client().payments.fetch(paymentId));
}
async function reconcileRow(row) {
  if (!row.gateway_order_id || row.status === 'complete') return row;
  const response = await client().orders.fetchPayments(row.gateway_order_id);
  const captured = (response.items || []).find(p => p.status === 'captured');
  if (captured) return complete(row.id, captured);
  // Authorized payments may still be captured; keep the reservation and retry later.
  if ((response.items || []).some(p => p.status === 'authorized')) return row;
  return transaction(async conn => {
    const current = await get(row.id, conn, true);
    const [[time]] = await conn.query('SELECT expires_at < UTC_TIMESTAMP() AS expired FROM secure_checkouts WHERE id=?', [row.id]);
    if (current.status === 'pending' && time.expired) await release(conn, current);
    return get(row.id, conn);
  });
}
let running = false;
async function reconcile() {
  if (running) return;
  running = true;
  try {
    // Expired orders are also checked for late captures; webhooks cover older payments.
    const [rows] = await db.query("SELECT * FROM secure_checkouts WHERE method='online' AND (status='pending' OR (status='expired' AND created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY))) ORDER BY updated_at LIMIT 50");
    for (const r of rows) {
      try {
        const result = await reconcileRow(parse(r));
        if (result?.newlyCompleted) void notify(result.order_id);
      } catch (e) { console.error('Checkout reconciliation failed:', r.id, e.code || e.publicMessage || 'gateway/database unavailable'); }
      finally { await db.query('UPDATE secure_checkouts SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [r.id]); }
    }
    const [notifications] = await db.query("SELECT order_id FROM secure_checkouts WHERE status='complete' AND (email_notified=0 OR sms_notified=0) AND (notification_after IS NULL OR notification_after<UTC_TIMESTAMP()) LIMIT 30");
    for (const row of notifications) await notify(row.order_id);
  } finally { running = false; }
}
async function notify(orderId) {
  try {
    // A short lease prevents callback, worker and webhook deliveries racing.
    const [claim] = await db.query("UPDATE secure_checkouts SET notification_after=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 10 MINUTE) WHERE order_id=? AND status='complete' AND (notification_after IS NULL OR notification_after<UTC_TIMESTAMP())",[orderId]);
    if (!claim.affectedRows) return;
    const [[delivery]] = await db.query('SELECT email_notified,sms_notified FROM secure_checkouts WHERE order_id=?',[orderId]);
    const order = await Order.getById(orderId);
    const { Email, SMS } = require('./notify');
    const results = await Promise.allSettled([delivery.email_notified ? true : Email.sendOrderConfirm(order), delivery.sms_notified ? true : SMS.sendOrderConfirm(order)]);
    const sent = result => result.status==='fulfilled' && result.value===true ? 1 : 0;
    await db.query('UPDATE secure_checkouts SET email_notified=GREATEST(email_notified,?),sms_notified=GREATEST(sms_notified,?) WHERE order_id=?',[sent(results[0]),sent(results[1]),orderId]);
  } catch { console.error('Order notification failed:', orderId); }
}
module.exports = { issue, verifyToken, owner, prepare, get, byGateway, confirm, complete, reconcile, reconcileRow, notify, client, verifyPayment };
