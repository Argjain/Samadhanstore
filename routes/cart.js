const router = require('../middlewares/asyncRouter')();
const Product = require('../models/Product');
const ComboDeals = require('../models/ComboDeals');
const config = require('../config/app');
const pricing = require('../services/pricing');
const count = cart => Object.values(cart || {}).reduce((sum,i) => sum + Number(i.qty),0);
function keys(buyNow) { return buyNow ? ['buyNowCart','buyNowCoupon','buyNowDiscount'] : ['cart','coupon','discount']; }
async function render(req,res,buyNow) {
  const [key,couponKey,discountKey] = keys(buyNow);
  let cart = req.session[key] || {}, coupon = req.session[couponKey] || null;
  // Refresh display prices and prune unavailable entries so checkout errors are recoverable.
  const current = {};
  let adjusted = false;
  for (const i of Object.values(cart)) {
    try {
      const product = await Product.getById(pricing.integer(i.id,1,2147483647));
      if (!product || !Number(product.is_active) || product.stock < 1) { adjusted = true; continue; }
      const qty = Math.min(pricing.integer(i.qty),Number(product.stock));
      current[i.id] = pricing.item(product,qty);
      if (qty !== i.qty || current[i.id].price !== i.price) adjusted = true;
    } catch (e) { if (!e.publicMessage) throw e; adjusted = true; }
  }
  cart = req.session[key] = current;
  const base = await pricing.totals(cart);
  let discount = 0;
  if (coupon) {
    try { discount = (await pricing.coupon(coupon,base.subtotal)).discount; }
    catch(e) { if (!e.publicMessage) throw e; coupon = null; adjusted = true; }
  }
  req.session[couponKey] = coupon;
  req.session[discountKey] = discount;
  const totals = await pricing.totals(cart,discount);
  if (adjusted) res.locals.error = ['Your cart was updated to match current prices, stock and coupon availability. Please review it.'];
  res.render('pages/cart',{pageTitle:buyNow?'Order Summary – Samadhan':'Your Cart – Samadhan',cart,coupon,...totals,
    freeShippingAbove:totals.rules.freeShippingAbove,isBuyNow:buyNow});
}
router.get('/', (req,res) => render(req,res,false));
router.get('/buy-now-summary', (req,res) => render(req,res,true));
router.post('/add', async (req,res) => {
  const id = pricing.integer(req.body.productId,1,2147483647), qty = pricing.integer(req.body.qty === undefined ? 1 : req.body.qty);
  const product = await Product.getById(id);
  const cart = req.session.cart || {};
  const nextQty = pricing.integer(Number(cart[id]?.qty || 0) + qty);
  cart[id] = pricing.item(product,nextQty);
  req.session.cart = cart;
  res.json({success:true,cartCount:count(cart),message:product.name + ' added!'});
});
router.post('/buy-now', async (req,res) => {
  const id = pricing.integer(req.body.productId,1,2147483647), qty = pricing.integer(req.body.qty === undefined ? 1 : req.body.qty);
  req.session.buyNowCart = { [id]:pricing.item(await Product.getById(id),qty) };
  req.session.buyNowCoupon = null; req.session.buyNowDiscount = 0;
  res.json({success:true,message:'Proceeding to checkout'});
});
router.post('/add-combo', async (req,res) => {
  const deal = await ComboDeals.getById(pricing.integer(req.body.comboId,1,2147483647));
  if (!deal || !Number(deal.is_active) || !deal.product_ids.length) throw pricing.fail('Combo unavailable.');
  const cart = { ...(req.session.cart || {}) };
  for (const id of deal.product_ids) cart[id] = pricing.item(await Product.getById(id),pricing.integer(Number(cart[id]?.qty || 0)+1));
  req.session.cart = cart;
  res.json({success:true,cartCount:count(cart),message:deal.title + ' added to cart!'});
});
for (const buyNow of [false,true]) {
  const [key,couponKey,discountKey] = keys(buyNow), prefix = buyNow ? '/buy-now-' : '/';
  router.post(prefix+'update', async (req,res) => {
    const id = pricing.integer(req.body.productId,1,2147483647), qty = pricing.integer(req.body.qty,0,10);
    const cart = req.session[key] || {};
    if (!cart[id]) throw pricing.fail('This item is no longer in your cart.');
    if (!qty) delete cart[id];
    else cart[id] = pricing.item(await Product.getById(id),qty);
    req.session[key] = cart;
    res.json({success:true,cartCount:count(cart)});
  });
  router.post(prefix+'remove', (req,res) => {
    const id = pricing.integer(req.body.productId,1,2147483647);
    if (req.session[key]) delete req.session[key][id];
    res.json({success:true,cartCount:count(req.session[key])});
  });
  router.post(prefix+'clear', (req,res) => {
    req.session[key]={}; req.session[couponKey]=null; req.session[discountKey]=0;
    res.json({success:true});
  });
  router.post(prefix+'apply-coupon', async (req,res) => {
    if (typeof req.body.code !== 'string' || !req.body.code.trim()) throw pricing.fail('Please enter a coupon code.');
    const q = await pricing.quote(req.session[key] || {},req.body.code);
    req.session[key] = q.cart; req.session[couponKey]=q.couponCode; req.session[discountKey]=q.discount;
    res.json({success:true,message:'Coupon applied.',discount:q.discount,total:q.total});
  });
  router.post(prefix+'remove-coupon', (req,res) => {
    req.session[couponKey]=null; req.session[discountKey]=0; res.json({success:true});
  });
}
router.use((err,req,res,next) => {
  if (!err.publicMessage) return next(err);
  res.status(err.status || 400).json({success:false,message:err.publicMessage});
});
module.exports = router;
module.exports.calcTotals = pricing.totals;
