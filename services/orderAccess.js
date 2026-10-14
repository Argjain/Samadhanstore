const crypto = require('crypto');
const config = require('../config/app');
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function token(order) {
  return crypto.createHmac('sha256', config.session.secret)
    .update('guest-order:v1:' + order.order_id + ':' + order.email).digest('hex');
}
function trackingUrl(order) {
  return '/orders/track/' + encodeURIComponent(order.order_id) + '?token=' + token(order);
}
function canView(req, order) {
  return Boolean(req.session.isAdmin ||
    (order.user_id && String(req.session.user?.id) === String(order.user_id)) ||
    req.session.orderAccess?.includes(order.order_id));
}
function grant(req, orderId) {
  req.session.orderAccess = [...new Set([...(req.session.orderAccess || []), orderId])].slice(-30);
}
module.exports = { equal, token, trackingUrl, canView, grant };
