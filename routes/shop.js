// routes/shop.js
const express  = require('express');
const router   = require('../middlewares/asyncRouter')();
const Product  = require('../models/Product');
const Category = require('../models/Category');
const ComboDeals = require('../models/ComboDeals');
const { Email } = require('../services/notify');
const { validateFields } = require('../middlewares/validate');
const config   = require('../config/app');
const db       = require('../config/db');

// Safe JSON parse helper
function safeParseImages(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch(e) { return []; }
  }
  return [];
}

// ==========================================
// 1. HOME PAGE - (Best Sellers -> Categories -> All Products)
// ==========================================
router.get('/', async (req, res, next) => {
  try {
    // Teeno data ek saath fetch ho rahe hain Promise.all se
    const [bestsellers, categories, allProducts, comboDeals] = await Promise.all([
      Product.getFeatured(8),
      Promise.resolve(res.locals.categories || []),
      Product.getAll({ limit: 12 }), // Sirf 12 products homepage pe (pagination)
      ComboDeals.getActiveDeals(),
    ]);

    // Images ko render karne se pehle parse karna zaroori hai[cite: 10]
    bestsellers.forEach(p => { p.images = safeParseImages(p.images); });
    allProducts.forEach(p => { p.images = safeParseImages(p.images); });

    res.render('pages/home', {
      pageTitle: (res.locals.S && res.locals.S.seo_title) || (config.site.name + ' – ' + config.site.tagline),
      pageDesc:  (res.locals.S && res.locals.S.seo_desc) || '',
      bestsellers,
      categories,
      allProducts, // Ab ye variable home.ejs mein access ho jayega[cite: 10]
      comboDeals,
    });
  } catch(e) { 
    console.error('Home error:', e.message); 
    next(e); 
  }
});

// ==========================================
// 2. SHOP PAGE (Filters aur Search ke saath)
// ==========================================
router.get('/shop', async (req, res, next) => {
  try {
    const fields=['category','purpose','material','search','sort','min','max','inStock','planet','mulank','zodiac'];
    const query=Object.fromEntries(fields.map(key=>[key,typeof req.query[key]==='string'?req.query[key].slice(0,100):undefined]));
    const { category, purpose, material, search, sort, min, max, inStock, planet, mulank, zodiac } = query;
    const page=Math.min(4000,Math.max(1,parseInt(req.query.page,10)||1)), pageSize=24;
    const options={categorySlug:category,purpose,material,search,sort,minPrice:min,maxPrice:max,inStock:inStock==='1',planet,mulank,zodiac};
    const pageUrl=n=>{const params=new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined && v!==''));params.set('page',n);return '/shop?'+params.toString();};
    const [products, filters, totalCount] = await Promise.all([
      Product.getAll({...options,limit:pageSize,offset:(page-1)*pageSize}),
      Product.getFilters(),
      Product.getAll({...options,countOnly:true}),
    ]);
    products.forEach(p => { p.images = safeParseImages(p.images); });
    res.render('pages/shop', {
      pageTitle: 'Shop All Products – Samadhan',
      products, filters,
      activeFilters: { category, purpose, material, search, sort, min, max, inStock, planet, mulank, zodiac },
      totalCount, page, pageCount:Math.max(1,Math.ceil(totalCount/pageSize)), pageUrl,
    });
  } catch(e) { console.error('Shop error:', e.message); next(e); }
});

// ==========================================
// 3. PRODUCT DETAIL PAGE
// ==========================================
router.get('/product/:slug', async (req, res, next) => {
  try {
    const product = await Product.getBySlug(req.params.slug);
    if (!product) return res.redirect('/shop');
    product.images = safeParseImages(product.images);

    const { Review, Wishlist } = require('../models/User');
    const [related, reviews, productCombos] = await Promise.all([
      Product.getRelated(product.category_id, product.id, 4),
      Review.getByProduct(product.id, true),
      ComboDeals.getDealsForProduct(product.id),
    ]);
    related.forEach(p => { p.images = safeParseImages(p.images); });

    let isWishlisted = false;
    if (req.session.user) {
      isWishlisted = await Wishlist.isWishlisted(req.session.user.id, product.id);
    }

    const benefits = product.stone_benefits
      ? product.stone_benefits.split('|').map(b => b.trim()).filter(Boolean)
      : [];

    const avgRating = reviews.length
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : 0;

    res.render('pages/product', {
      pageTitle: product.name + ' – Samadhan',
      pageDesc:  String(product.seo_desc || product.description || '').slice(0,160),
      product, related, reviews, benefits, isWishlisted, avgRating,
      productCombos,
      discount: product.original_price
        ? Math.round((1 - product.price / product.original_price) * 100) : 0,
    });
  } catch(e) { console.error('Product error:', e.message); next(e); }
});

// ==========================================
// 4. STATIC PAGES (Quiz, About, Contact)
// ==========================================
router.get('/quiz', async (req, res) => {
  const products = await Product.getAll({limit:20});
  const quizProducts = products.slice(0, 20).map(p => ({ name: p.name, slug: p.slug, category: p.category_name || '' }));
  res.render('pages/quiz', { pageTitle: 'Find Your Perfect Bracelet – Samadhan', quizProducts });
});
router.get('/about',   (req, res) => res.render('pages/about',   { pageTitle: 'About Us – Samadhan' }));
router.get('/contact', (req, res) => res.render('pages/contact', { pageTitle: 'Contact – Samadhan' }));

router.post('/contact', validateFields(['name', 'email'], '/contact'), async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  // Persist the submission so it shows up on the admin Customer Queries page.
  // Wrapped in its own try/catch: a DB failure is logged but still lets us attempt
  // the email notification and return a graceful success redirect (no stack trace leaked).
  try {
    await db.query(
      "INSERT INTO contacts (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)",
      [name, email, phone || null, subject || null, message || null]
    );
  } catch(e) { console.error('Contact persist error:', e.message); }
  try { await Email.sendContactForm({ name, email, phone, subject, message }); } catch(e) {}
  req.flash('success', 'Message sent! We\'ll reply within 24 hours. 🙏');
  res.redirect('/contact');
});

// ==========================================
// 5. SEO (Sitemap & Robots)
// ==========================================
router.get('/sitemap.xml', async (req, res) => {
  try {
    const [products, categories] = await Promise.all([Product.getAll({}), Category.getAll()]);
    const base = config.site.url;
    let xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    ['', 'shop', 'about', 'contact', 'quiz'].forEach(p => {
      xml += '<url><loc>' + base + '/' + p + '</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>';
    });
    categories.forEach(c => {
      xml += '<url><loc>' + base + '/shop?category=' + c.slug + '</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>';
    });
    products.forEach(p => {
      xml += '<url><loc>' + base + '/product/' + p.slug + '</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>';
    });
    xml += '</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch(e) { res.status(500).send('Error'); }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nSitemap: ' + config.site.url + '/sitemap.xml');
});

module.exports = router;
