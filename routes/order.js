const router = require('../middlewares/asyncRouter')();
const crypto = require('crypto');
const config = require('../config/app');
const Order = require('../models/Order');
const Checkout = require('../services/checkout');
const pricing = require('../services/pricing');
const access = require('../services/orderAccess');
const { validators } = require('../middlewares/validate');
const { isCODAvailable } = require('../middlewares/codCheck');
const STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Chandigarh'];
const modeOf = req => req.body.isBuyNow === 'true' || req.body.isBuyNow === true ? 'buyNow' : 'cart';
function selection(req, mode) {
  return { cart: req.session[mode === 'buyNow' ? 'buyNowCart' : 'cart'] || {}, code: req.session[mode === 'buyNow' ? 'buyNowCoupon' : 'coupon'] || null };
}
function delivery(req) {
  const result = {};
  for (const key of ['name','email','phone','address','city','state','pincode']) {
    if (typeof req.body[key] !== 'string') throw pricing.fail('Please complete your delivery details.');
    let value = req.body[key].trim();
    const error = validators[key](value);
    if (error) throw pricing.fail(error);
    if (key === 'phone') {
      value = value.replace(/\D/g,'');
      if (value.length === 12) value = value.slice(2);
    }
    result[key] = value;
  }
  return result;
}
function clearPurchased(req, row) {
  const key = row.mode === 'buyNow' ? 'buyNowCart' : 'cart';
  const cart = req.session[key] || {};
  for (const bought of row.snapshot.items) {
    if (!cart[bought.id]) continue;
    cart[bought.id].qty -= bought.qty;
    if (cart[bought.id].qty <= 0) delete cart[bought.id];
  }
  req.session[key] = cart;
  req.session[row.mode === 'buyNow' ? 'buyNowCoupon' : 'coupon'] = null;
  req.session[row.mode === 'buyNow' ? 'buyNowDiscount' : 'discount'] = 0;
}
function finish(req, res, row) {
  if (row.status === 'review') return res.status(409).render('pages/error', { pageTitle: 'Payment received — help needed',
    message: 'Your payment was received, but stock needs to be checked. Please contact support with payment ID ' + row.payment_id + '. Do not pay again.' });
  if (!req.session.orderAccess?.includes(row.order_id)) clearPurchased(req, row);
  access.grant(req, row.order_id);
  return res.redirect('/orders/success/' + row.order_id);
}
router.use((req,res,next) => { res.set('Cache-Control','private, no-store'); res.set('Referrer-Policy','no-referrer'); next(); });
router.get('/', (req,res) => res.redirect(req.session.user ? '/account' : '/auth/login'));
router.get('/checkout', async (req,res) => {
  const mode = req.query.buyNow === 'true' ? 'buyNow' : 'cart';
  const { cart, code } = selection(req, mode);
  if (!Object.keys(cart).length) return res.redirect('/cart');
  try {
    const q = await pricing.quote(cart, code);
    res.render('pages/checkout', { pageTitle: 'Checkout – Samadhan', ...q, coupon: q.couponCode,
      user: req.session.user || null, states: STATES, onlineDiscountPct: q.rules.onlinePaymentDiscount,
      isBuyNow: mode === 'buyNow', checkoutToken: Checkout.issue(req,mode) });
  } catch (e) {
    if (!e.publicMessage) throw e;
    req.flash('error',e.publicMessage);
    res.redirect(mode === 'buyNow' ? '/cart/buy-now-summary' : '/cart');
  }
});
router.post('/razorpay-initiate', async (req,res) => {
  const mode = modeOf(req);
  const row = await Checkout.prepare({ id: Checkout.verifyToken(req,mode), ownerKey: Checkout.owner(req), mode, method: 'online',
    ...selection(req,mode), delivery: delivery(req), userId: req.session.user?.id, expectedTotal: req.body.expectedTotal });
  if (row.status === 'complete') { access.grant(req,row.order_id); return res.json({ success:true, redirect:'/orders/success/' + row.order_id }); }
  res.json({ success:true, order: { id: row.gateway_order_id, amount: Math.round(row.snapshot.total * 100), currency:'INR' } });
});
router.post('/place-online', async (req,res) => {
  const mode = modeOf(req);
  const row = await Checkout.get(Checkout.verifyToken(req,mode));
  if (!row || !access.equal(row.owner_key,Checkout.owner(req)) || row.method !== 'online') throw pricing.fail('Checkout not found.');
  const { razorpay_payment_id: paymentId, razorpay_order_id: remoteId, razorpay_signature: sig } = req.body;
  if (typeof paymentId !== 'string' || !/^pay_[a-zA-Z0-9]+$/.test(paymentId) || remoteId !== row.gateway_order_id) throw pricing.fail('Invalid payment details.');
  const expected = crypto.createHmac('sha256',config.razorpay.keySecret).update(row.gateway_order_id + '|' + paymentId).digest('hex');
  if (!access.equal(expected,sig)) throw pricing.fail('Payment verification failed.');
  const result = await Checkout.confirm(row,paymentId);
  if (result.newlyCompleted) void Checkout.notify(result.order_id);
  finish(req,res,result);
});
router.post('/place-cod', async (req,res) => {
  const mode = modeOf(req), details = delivery(req);
  if (!isCODAvailable(details.city,details.pincode)) throw pricing.fail('COD is only available at eligible Delhi NCR addresses.');
  const id = Checkout.verifyToken(req,mode);
  const row = await Checkout.prepare({ id, ownerKey: Checkout.owner(req), mode, method:'cod',
    ...selection(req,mode), delivery: details, userId: req.session.user?.id, expectedTotal: req.body.expectedTotal });
  if (!req.session.orderAccess?.includes(row.order_id)) void Checkout.notify(row.order_id);
  finish(req,res,row);
});
async function privateOrder(req,res,next) {
  const order = await Order.getById(req.params.orderId);
  if (!order) return res.status(404).send('Order unavailable.');
  if (typeof req.query.token === 'string' && access.equal(req.query.token,access.token(order))) {
    access.grant(req,order.order_id);
    return res.redirect(req.baseUrl + req.path);
  }
  if (!access.canView(req,order)) return res.status(404).send('Order unavailable. Please sign in to the account used for this order, open your secure tracking link, or contact support.');
  req.order = order;
  next();
}
router.get('/success/:orderId', privateOrder, (req,res) => res.render('pages/order-success',{pageTitle:'Order Confirmed! – Samadhan',order:req.order}));
router.get('/track/:orderId', privateOrder, (req,res) => {
  const steps = ['placed','confirmed','processing','shipped','out_for_delivery','delivered'];
  res.render('pages/track-order',{pageTitle:'Track Order ' + req.order.order_id,order:req.order,steps,currentStep:steps.indexOf(req.order.order_status)});
});
router.use((err,req,res,next) => {
  if (!err.publicMessage) return next(err);
  if (req.is('application/json')) return res.status(err.status || 400).json({success:false,message:err.publicMessage});
  res.status(err.status || 400).render('pages/error',{pageTitle:'Please check your order',message:err.publicMessage});
});
module.exports = router;
