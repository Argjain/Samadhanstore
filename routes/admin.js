const express  = require('express');
const router   = require('../middlewares/asyncRouter')();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const config   = require('../config/app');
const Product  = require('../models/Product');
const Category = require('../models/Category');
const Settings = require('../models/Settings');
const Order = require('../models/Order');
const ComboDeals = require('../models/ComboDeals');
const { User, Review, Banner, Coupon, FestivalOffer } = require('../models/User');
const { requireAdmin } = require('../middlewares/auth');
const { Email, SMS } = require('../services/notify');

function cleanImageList(list) {
  return (Array.isArray(list) ? list : [])
    .map(v => (typeof v === 'string' ? v.trim() : v))
    .filter(v => typeof v === 'string' && v.length > 0)
    .filter(v => v !== 'null' && v !== 'undefined');
}

function toPublicImageUrl(destinationDir, filename) {
  const subfolder = path.basename(String(destinationDir).replace(/\/+$/, '').replace(/\\+$/, ''));
  return '/uploads/' + subfolder + '/' + filename;
}

const {uploader} = require('../services/images');
const upload=uploader('products'), uploadBanner=uploader('banners'), uploadCombo=uploader('combos');

// Multer error handler — prevents 503 crash on upload failures
function handleUpload(mw) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (err) {
        console.error('Upload error:', err.message || err);
        req.flash('error', 'Upload failed. Use a still JPG, PNG or WebP within 15 MB and try again.');
        return res.redirect('back');
      }
      next();
    });
  };
}

router.use(requireAdmin);
router.use((req,res,next)=>{if(req.method!=='GET') res.on('finish',()=>require('../services/layoutCache').clear());next();});
router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');res.set('Referrer-Policy','no-referrer');next();});

// DASHBOARD
router.get('/', async (req,res) => {
  const [orderStats,productStats,userStats,recentOrders] = await Promise.all([Order.getStats(),Product.getStats(),User.getStats(),Order.getAll({limit:15})]);
  res.render('pages/admin/dashboard',{pageTitle:'Admin Dashboard',orderStats,productStats,userStats,recentOrders});
});

// ORDERS
router.get('/orders', async (req,res) => { const {status,search}=req.query; const orders=await Order.getAll({status,search,limit:100});
  for (const order of orders) order.customerTrackingUrl=config.site.url+require('../services/orderAccess').trackingUrl(order);
  res.render('pages/admin/orders',{pageTitle:'Orders',orders,filterStatus:status||'',search:search||''}); });
router.post('/orders/:id/status', async (req,res) => {
  const {status,tracking_id}=req.body; await Order.updateStatus(req.params.id,status,tracking_id||null);
  const order=await Order.getById(req.params.id);
  if(order&&status==='shipped'){try{await Promise.all([Email.sendOrderShipped(order),SMS.sendOrderShipped(order)]);}catch(e){}}
  req.flash('success','Order updated!'); res.redirect('/admin/orders');
});

// PRODUCTS
router.get('/products', async (req,res) => { const [products,cats]=await Promise.all([Product.getAll({}),Category.getAll(false)]); res.render('pages/admin/products',{pageTitle:'Products',products,categories:cats}); });
router.get('/products/new', async (req,res) => { const cats=await Category.getAll(false); res.render('pages/admin/product-form',{pageTitle:'Add Product',product:null,categories:cats}); });
router.get('/products/:id/edit', async (req,res) => { const [product,cats]=await Promise.all([Product.getById(parseInt(req.params.id)),Category.getAll(false)]); res.render('pages/admin/product-form',{pageTitle:'Edit Product',product,categories:cats}); });

router.post('/products', handleUpload(upload.array('images',5)), async (req,res) => {
  try {
    const data={...req.body,is_featured:req.body.is_featured==='on'};
    const existingImages=data.existing_images?(Array.isArray(data.existing_images)?data.existing_images:[data.existing_images]):[];
    const newImages=(req.files||[]).map(f=>toPublicImageUrl(config.upload.productImages,f.filename));
    data.images=cleanImageList([...existingImages,...newImages]);
    await Product.create(data);
    req.flash('success','Product added successfully! ✅'); res.redirect('/admin/products');
  } catch(e){ console.error('Product create error:',e); req.flash('error','Error: '+e.message); res.redirect('/admin/products/new'); }
});

router.put('/products/:id', handleUpload(upload.array('images',5)), async (req,res) => {
  try {
    const data={...req.body,is_featured:req.body.is_featured==='on'};
    const existingImages=data.existing_images?(Array.isArray(data.existing_images)?data.existing_images:[data.existing_images]):[];
    const newImages=(req.files||[]).map(f=>toPublicImageUrl(config.upload.productImages,f.filename));
    data.images=JSON.stringify(cleanImageList([...existingImages,...newImages]));
    await Product.update(parseInt(req.params.id),data);
    req.flash('success','Product updated successfully! ✅'); res.redirect('/admin/products');
  } catch(e){ console.error('Product update error:',e); req.flash('error','Error: '+e.message); res.redirect('/admin/products'); }
});

router.delete('/products/:id', async (req,res) => { await Product.delete(parseInt(req.params.id)); req.flash('success','Product deleted.'); res.redirect('/admin/products'); });

// CATEGORIES
router.get('/categories', async (req,res) => { const cats=await Category.getAll(false); res.render('pages/admin/categories',{pageTitle:'Categories',categories:cats}); });
function categoryAction(action, success) {
  return async (req,res) => {
    try {
      if (req.params.id && !/^[1-9]\d*$/.test(req.params.id)) throw new Error('Invalid category.');
      await action(req);
      req.flash('success',success);
    } catch (e) {
      console.error('Category save failed:', e.code || 'validation');
      const message = e.code === 'ER_DUP_ENTRY' ? 'A category with this URL already exists. Please use a different name.' :
        e.code === 'ER_ROW_IS_REFERENCED_2' ? 'This category has products. Deactivate it instead of deleting it.' :
        e.code ? 'Could not save the category. Please try again or check the database configuration.' : e.message;
      req.flash('error',message);
    }
    res.redirect('/admin/categories');
  };
}
router.post('/categories', categoryAction(req => Category.create(req.body),'Category added!'));
router.put('/categories/:id', categoryAction(req => Category.update(Number(req.params.id),req.body),'Category updated!'));
router.delete('/categories/:id', categoryAction(req => Category.delete(Number(req.params.id)),'Category deleted.'));

router.get('/payment-checkouts', async (req,res) => {
  const [checkouts] = await require('../config/db').query("SELECT id,status,gateway_order_id,payment_id,order_id,created_at,last_error,email_notified,sms_notified FROM secure_checkouts WHERE method='online' ORDER BY created_at DESC LIMIT 100");
  res.set('Cache-Control','private, no-store');
  res.render('pages/admin/payment-checkouts',{pageTitle:'Payment Checkouts',checkouts});
});
router.post('/payment-checkouts/:id/recheck', async (req,res) => {
  const checkout = require('../services/checkout');
  const row = await checkout.get(req.params.id);
  if (row) {
    try { const result = await checkout.reconcileRow(row); if (result?.newlyCompleted) void checkout.notify(result.order_id); req.flash('success','Payment checked.'); }
    catch { req.flash('error','Could not verify this payment. Please check Razorpay before taking any action.'); }
  }
  res.redirect('/admin/payment-checkouts');
});

// COUPONS
router.get('/coupons', async (req,res) => { const coupons=await Coupon.getAll(); res.render('pages/admin/coupons',{pageTitle:'Coupons',coupons}); });
router.post('/coupons', async (req,res) => { try{await Coupon.create(req.body);req.flash('success','Coupon created!');}catch(e){req.flash('error','Code exists.');} res.redirect('/admin/coupons'); });
router.put('/coupons/:id', async (req,res) => { await Coupon.update(parseInt(req.params.id),{...req.body,is_active:req.body.is_active==='on'}); req.flash('success','Coupon updated!'); res.redirect('/admin/coupons'); });
router.post('/coupons/:id/toggle', async (req,res) => { await Coupon.toggleActive(parseInt(req.params.id)); res.redirect('/admin/coupons'); });
router.delete('/coupons/:id', async (req,res) => { await Coupon.delete(parseInt(req.params.id)); req.flash('success','Coupon deleted.'); res.redirect('/admin/coupons'); });

// BANNERS
router.get('/banners', async (req,res) => { const banners=await Banner.getAll(); res.render('pages/admin/banners',{pageTitle:'Promo Banners',banners}); });
router.post('/banners', handleUpload(uploadBanner.single('image')), async (req,res) => {
  const data={...req.body}; if(req.file) data.image=toPublicImageUrl(config.upload.bannerImages,req.file.filename);
  await Banner.create(data); req.flash('success','Banner added!'); res.redirect('/admin/banners');
});
router.put('/banners/:id', handleUpload(uploadBanner.single('image')), async (req,res) => {
  const data={...req.body,is_active:req.body.is_active==='on'}; if(req.file) data.image=toPublicImageUrl(config.upload.bannerImages,req.file.filename);
  await Banner.update(parseInt(req.params.id),data); req.flash('success','Banner updated!'); res.redirect('/admin/banners');
});
router.delete('/banners/:id', async (req,res) => { await Banner.delete(parseInt(req.params.id)); req.flash('success','Banner deleted.'); res.redirect('/admin/banners'); });

// FESTIVAL OFFERS
router.get('/offers', async (req,res) => { const offers=await FestivalOffer.getAll(); res.render('pages/admin/offers',{pageTitle:'Festival Offers',offers}); });
router.post('/offers', async (req,res) => { await FestivalOffer.create(req.body); req.flash('success','Offer created!'); res.redirect('/admin/offers'); });
router.put('/offers/:id', async (req,res) => { await FestivalOffer.update(parseInt(req.params.id),{...req.body,is_active:req.body.is_active==='on'}); req.flash('success','Offer updated!'); res.redirect('/admin/offers'); });
router.delete('/offers/:id', async (req,res) => { await FestivalOffer.delete(parseInt(req.params.id)); req.flash('success','Offer deleted.'); res.redirect('/admin/offers'); });

// REVIEWS
router.get('/reviews', async (req,res) => { const reviews=await Review.getAll(); res.render('pages/admin/reviews',{pageTitle:'Customer Reviews',reviews}); });
router.post('/reviews/:id/approve', async (req,res) => { await Review.approve(parseInt(req.params.id)); req.flash('success','Review approved!'); res.redirect('/admin/reviews'); });
router.delete('/reviews/:id', async (req,res) => { await Review.delete(parseInt(req.params.id)); req.flash('success','Review deleted.'); res.redirect('/admin/reviews'); });

// USERS
router.get('/users', async (req,res) => { const users=await User.getAll(); res.render('pages/admin/users',{pageTitle:'All Users',users}); });

// SETTINGS
router.get('/settings', async (req,res) => { const grouped=await Settings.getGrouped(); res.render('pages/admin/settings',{pageTitle:'Site Settings',grouped}); });
router.post('/settings', async (req,res) => {
  try { const {_method,...data}=req.body; await Settings.bulkUpdate(data); req.flash('success','Settings saved! ✅'); }
  catch(e) { req.flash('error',e.code?'Could not save settings. Please try again.':e.message); }
  res.redirect('/admin/settings');
});

// COMBO DEALS
router.get('/combos', async (req,res) => { const [deals,products]=await Promise.all([ComboDeals.getAll(),Product.getAll({})]); res.render('pages/admin/combo-deals',{pageTitle:'Combo Deals',deals,products}); });
router.post('/combos', handleUpload(uploadCombo.single('image')), async (req,res) => {
  const data={...req.body}; if(req.file) data.image=toPublicImageUrl(config.upload.comboImages,req.file.filename);
  await ComboDeals.create(data); req.flash('success','Combo created!'); res.redirect('/admin/combos');
});
router.put('/combos/:id', handleUpload(uploadCombo.single('image')), async (req,res) => {
  const data={...req.body,is_active:req.body.is_active==='on'}; if(req.file) data.image=toPublicImageUrl(config.upload.comboImages,req.file.filename);
  await ComboDeals.update(parseInt(req.params.id),data); req.flash('success','Combo updated!'); res.redirect('/admin/combos');
});
router.delete('/combos/:id', async (req,res) => { await ComboDeals.delete(parseInt(req.params.id)); req.flash('success','Combo deleted.'); res.redirect('/admin/combos'); });

// BLOG
const Blog = require('../models/Blog');
const uploadBlog=uploader('blogs');

router.get('/blogs', async (req,res) => { const posts=await Blog.getAll(false); res.render('pages/admin/blogs',{pageTitle:'Blog Posts',posts}); });
router.get('/blogs/:id/edit', async (req,res) => { const post=await Blog.getById(parseInt(req.params.id)); if(!post) return res.redirect('/admin/blogs'); res.render('pages/admin/blog-edit',{pageTitle:'Edit Post',post}); });
router.post('/blogs', handleUpload(uploadBlog.single('image')), async (req,res) => {
  const data={...req.body, is_published: req.body.is_published==='on'};
  if(req.file) data.image='/uploads/blogs/'+req.file.filename;
  await Blog.create(data); req.flash('success','Blog post published! 📝'); res.redirect('/admin/blogs');
});
router.put('/blogs/:id', handleUpload(uploadBlog.single('image')), async (req,res) => {
  const data={...req.body, is_published: req.body.is_published==='on'};
  if(req.file) data.image='/uploads/blogs/'+req.file.filename;
  await Blog.update(parseInt(req.params.id), data); req.flash('success','Post updated!'); res.redirect('/admin/blogs');
});
router.delete('/blogs/:id', async (req,res) => { await Blog.delete(parseInt(req.params.id)); req.flash('success','Post deleted.'); res.redirect('/admin/blogs'); });

module.exports = router;
