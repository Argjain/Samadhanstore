const db = require('../config/db');
const config = require('../config/app');
const businessRules = require('./businessRules');
const fail = message => Object.assign(new Error(message), { status: 400, publicMessage: message });
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
function integer(value, min = 1, max = 10) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))) throw fail('Please enter a valid quantity.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw fail(`Quantity must be between ${min} and ${max}.`);
  return n;
}
function image(images) {
  if (typeof images === 'string') { try { images = JSON.parse(images); } catch { images = [images]; } }
  return Array.isArray(images) ? images[0] || '' : '';
}
function item(product, qty) {
  if (!product || !Number(product.is_active) || Number(product.stock) < qty) throw fail('A product is unavailable or does not have enough stock. Please update your cart.');
  const price = Number(product.price);
  if (!Number.isFinite(price) || price < 0) throw fail('This product price needs to be checked.');
  if (Number(product.combo_qty)>0 && (product.combo_price==null || !Number.isFinite(Number(product.combo_price)) || Number(product.combo_price)<0)) throw fail('This product offer needs to be checked.');
  return { id: product.id, name: product.name, slug: product.slug, price, qty,
    image: image(product.images), combo_qty: Number(product.combo_qty) || 0,
    combo_price: Number(product.combo_price) || 0 };
}
async function freshCart(cart, connection = db, lock = false) {
  if (!cart || typeof cart !== 'object' || Array.isArray(cart)) throw fail('Your cart is empty.');
  const entries = Object.values(cart);
  if (!entries.length || entries.length > 100) throw fail('Please update your cart.');
  const ids = entries.map(i => integer(i.id, 1, 2147483647)).sort((a,b) => a-b);
  if (new Set(ids).size !== ids.length) throw fail('Please update your cart.');
  const [products] = await connection.query('SELECT * FROM products WHERE id IN (?) ORDER BY id' + (lock ? ' FOR UPDATE' : ''), [ids]);
  const result = {};
  for (const entry of entries) {
    const qty = integer(entry.qty);
    const product = products.find(p => Number(p.id) === Number(entry.id));
    result[entry.id] = item(product, qty);
  }
  return result;
}
async function totals(cart, discount = 0, onlineDiscount = 0, connection = db, rules = null) {
  rules = rules || await businessRules.read(connection);
  let subtotal = 0;
  for (const i of Object.values(cart)) {
    integer(i.qty);
    i.unit_price = i.combo_qty > 0 && i.qty >= i.combo_qty ? i.combo_price : i.price;
    i.line_total = money(i.unit_price * i.qty);
    subtotal += i.line_total;
  }
  const ids = Object.values(cart).map(i => Number(i.id));
  let comboDiscount = 0;
  if (ids.length) {
    const [deals] = await connection.query('SELECT cd.id, cd.combo_price, GROUP_CONCAT(ci.product_id) AS product_ids FROM combo_deals cd JOIN combo_deal_items ci ON ci.combo_deal_id=cd.id WHERE cd.is_active=1 GROUP BY cd.id ORDER BY cd.id');
    // Preserve the existing one-bundle-per-order policy; choose the greatest saving.
    for (const deal of deals) {
      const products = String(deal.product_ids).split(',').map(Number);
      if (products.length && products.every(id => ids.includes(id))) {
        const regular = products.reduce((sum,id) => sum + cart[id].unit_price, 0);
        comboDiscount = Math.max(comboDiscount, regular - Number(deal.combo_price));
      }
    }
  }
  subtotal = money(subtotal - comboDiscount);
  discount = money(Math.max(0, Math.min(Number(discount) || 0, subtotal)));
  const shipping = !ids.length || subtotal >= rules.freeShippingAbove ? 0 : rules.shippingCharge;
  const gst = Math.round(subtotal * rules.gstPercent / 100);
  const total = money(Math.max(0, subtotal + shipping + gst - discount - onlineDiscount));
  return { subtotal, shipping, gst, discount, onlineDiscount, comboDiscount: money(comboDiscount), total, rules };
}
async function coupon(code, subtotal, connection = db, lock = false) {
  if (!code) return { discount: 0, code: null };
  if (typeof code !== 'string' || code.length > 50) throw fail('Invalid coupon.');
  const [rows] = await connection.query('SELECT * FROM coupons WHERE code=? AND is_active=1 AND (expires_at IS NULL OR expires_at >= CURDATE()) AND used_count < max_uses' + (lock ? ' FOR UPDATE' : ''), [code.trim().toUpperCase()]);
  const c = rows[0];
  if (!c || subtotal < Number(c.min_order)) throw fail('This coupon is expired, used up, or does not meet the minimum order. Please remove it or update your cart.');
  const value = c.type === 'percent' ? Math.round(subtotal * Number(c.value) / 100) : Number(c.value);
  return { code: c.code, discount: money(Math.max(0, Math.min(value, subtotal))) };
}
async function quote(cart, code, connection = db, lock = false) {
  const current = await freshCart(cart, connection, lock);
  const rules = await businessRules.read(connection);
  const base = await totals(current, 0, 0, connection, rules);
  const applied = await coupon(code, base.subtotal, connection, lock);
  const result = await totals(current, applied.discount, 0, connection, rules);
  const onlineDiscount = money(Math.min(Math.round(result.subtotal * rules.onlinePaymentDiscount / 100), Math.max(0, result.subtotal - result.discount)));
  return { cart: current, couponCode: applied.code, ...result, onlineDiscount, onlineTotal: money(Math.max(0, result.total - onlineDiscount)) };
}
module.exports = { integer, item, freshCart, totals, coupon, quote, fail, money };
