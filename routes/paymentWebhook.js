const crypto = require('crypto');
const config = require('../config/app');
const Checkout = require('../services/checkout');
const { equal } = require('../services/orderAccess');
module.exports = async function paymentWebhook(req,res,next) {
  try {
    if (!config.razorpay.webhookSecret) return res.status(503).send('Webhook is not configured');
    if (!Buffer.isBuffer(req.body)) return res.status(400).end();
    const expected = crypto.createHmac('sha256',config.razorpay.webhookSecret).update(req.body).digest('hex');
    if (!equal(expected,req.get('x-razorpay-signature'))) return res.status(400).end();
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).end(); }
    if (!['payment.captured','order.paid'].includes(event.event)) return res.sendStatus(200);
    const payment = event.payload?.payment?.entity;
    if (!payment?.order_id || !payment.id) return res.status(400).end();
    const row = await Checkout.byGateway(payment.order_id);
    if (!row) return res.sendStatus(200);
    const result = await Checkout.confirm(row,payment.id);
    if (result.newlyCompleted) void Checkout.notify(result.order_id);
    res.sendStatus(200);
  } catch (e) { next(e); }
};
