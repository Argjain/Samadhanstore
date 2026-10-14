// server.js — Samadhan V3 Updated with MySQL Session Store & Razorpay Fix
require('dotenv').config();
const express        = require('express');
const session        = require('express-session');
const flash          = require('connect-flash');
const methodOverride = require('method-override');
const morgan         = require('morgan');
const helmet         = require('helmet');
const compression    = require('compression');
const rateLimit      = require('express-rate-limit');
const path           = require('path');
const config         = require('./config/app');
const Settings       = require('./models/Settings');
const Category       = require('./models/Category');
const { Banner, FestivalOffer } = require('./models/User');

// DATABASE CONNECTION IMPORT
const pool           = require('./config/db'); 

// SESSION STORE IMPORT (New Addition for MySQL)
const MySQLStore     = require('express-mysql-session')(session);
const sessionStore   = new MySQLStore({}, pool);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// 👉 GZIP COMPRESSION (HTML/CSS/JS ko compress karke transfer size ghatata hai)
app.use(compression({ level: 6, threshold: 1024 }));

// 👉 SECURITY (Updated with Razorpay CSP Fix)[cite: 4]
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://cdn.razorpay.com", "fonts.googleapis.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc:    ["'self'", "fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack-cx.razorpay.com", "https://lumberjack.razorpay.com"],
      frameSrc:   ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
      formAction: ["'self'", "https://checkout.razorpay.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Signed webhooks need the exact raw body and do not use browser sessions.
app.post('/orders/razorpay-webhook', express.raw({type:'application/json',limit:'256kb'}),
  require('./routes/paymentWebhook'), (err,req,res,next) => {
    console.error('Payment webhook failed:',err.code || 'verification/reconciliation');
    res.status(500).json({success:false});
  });

// Middleware
const safePath = req => req.path.replace(/(\/auth\/reset-password\/)[^/]+/g,'$1[redacted]');
morgan.token('safe-url',safePath);
app.use(morgan(':method :safe-url :status :response-time ms'));
app.use((req,res,next)=>{
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const origin=req.get('origin');
    if(req.get('sec-fetch-site')==='cross-site' || (origin && origin!==new URL(config.site.url).origin)) return res.status(403).send('Please submit from this website.');
  }
  next();
});
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(methodOverride(require('./middlewares/formMethod')));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: config.isDev ? 0 : '30d',
  etag: true,
  lastModified: true,
}));

// Serve uploaded images from persistent folder (outside deploy zone)
// URLs: /uploads/products/filename.jpg, /uploads/banners/filename.jpg
const fs = require('fs');
const uploadsDir = config.upload.baseDir;
try {
  fs.mkdirSync(path.join(uploadsDir, 'products'), { recursive: true });
  fs.mkdirSync(path.join(uploadsDir, 'banners'), { recursive: true });
  fs.mkdirSync(path.join(uploadsDir, 'combos'), { recursive: true });
  console.log('📁 Uploads dir:', uploadsDir);
} catch(e) {
  console.error('⚠️ Could not create uploads dir:', e.code || 'unavailable');
  // Keep the configured persistent path. Uploads fail visibly if it is unavailable;
  // never save customer images inside a replaceable deployment folder.

}
app.get('/media/:width/:group/:filename', rateLimit({windowMs:60000,max:240}), require('./services/images').serve);
app.use('/uploads', (req,res,next)=>{if(!/^\/(products|banners|combos|blogs)\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp)$/i.test(req.path)) return res.sendStatus(404);res.set('X-Content-Type-Options','nosniff');next();});
app.use('/uploads', express.static(uploadsDir, {
  maxAge: config.isDev ? 0 : '30d',
  etag: true,
  lastModified: true,
}));

// Rate Limiting (Increased for development and extensive testing)
const limitMax = config.isDev ? 5000 : 500;
app.use(rateLimit({ windowMs: 15*60*1000, max: limitMax, standardHeaders: true, legacyHeaders: false }));
app.use('/auth', rateLimit({ windowMs: 15*60*1000, max: config.isDev ? 200 : 20 }));
app.use('/api',  rateLimit({ windowMs: 60*1000, max: config.isDev ? 600 : 60 }));

// Session (Updated to use MySQL sessionStore)[cite: 1, 4]
app.use(session({
  ...config.session,
  store: sessionStore, // 🔥 Ab sessions DB mein safe rahenge
  name: 'samadhan_sid',
  cookie: {
    ...config.session.cookie,
    secure:   config.env === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
}));
app.use(flash());

app.use(require('./middlewares/sessionSecurity'));

app.locals.imageUrl = require('./services/images').imageUrl;
Object.assign(app.locals, require('./services/contentSafety'));
// Give API endpoints inexpensive defaults; they do not render navigation.
app.use((req,res,next)=>{
  Object.assign(res.locals,{S:{},config,site:config.site,business:config.business,categories:[],banners:[],festivalOffer:null,
    currentUser:req.session.user||null,isAdmin:!!req.session.isAdmin,cartCount:0,wishlistIds:[],success:[],error:[],path:req.path});next();
});
// Global Locals[cite: 4]
app.use(async (req, res, next) => {
  if(req.path.startsWith('/api/')) return next();
  try {
    const [settings, categories, banners, festivalOffer] = await require('./services/layoutCache').get(()=>Promise.all([
      Settings.getAll(),
      Category.getAll(),
      Banner.getActive(),
      FestivalOffer.getActive(),
    ]));

    res.locals.S             = settings;
    res.locals.config        = config;
    res.locals.site          = config.site;
    res.locals.business      = require('./services/businessRules').resolve(settings);
    res.locals.categories    = categories;
    res.locals.banners       = banners;
    res.locals.festivalOffer = festivalOffer;
    res.locals.currentUser   = req.session.user || null;
    res.locals.isAdmin       = req.session.isAdmin || false;
    res.locals.cartCount     = Object.values(req.session.cart || {}).reduce((s, i) => s + i.qty, 0);
    res.locals.wishlistIds   = req.session.wishlistIds || [];
    res.locals.success       = req.session.flash?.success ? req.flash('success') : [];
    res.locals.error         = req.session.flash?.error ? req.flash('error') : [];
    res.locals.path          = req.path;
    next();
  } catch(e) {
    console.error('Global locals error:', e.message);
    res.locals.S             = {};
    res.locals.config        = config;
    res.locals.site          = config.site;
    res.locals.business      = config.business;
    res.locals.categories    = [];
    res.locals.banners       = [];
    res.locals.festivalOffer = null;
    res.locals.currentUser   = req.session.user || null;
    res.locals.isAdmin       = req.session.isAdmin || false;
    res.locals.cartCount     = 0;
    res.locals.wishlistIds   = [];
    res.locals.success       = req.session.flash?.success ? req.flash('success') : [];
    res.locals.error         = req.session.flash?.error ? req.flash('error') : [];
    res.locals.path          = req.path;
    next();
  }
});

// Routes[cite: 4]
app.use('/',         require('./routes/shop'));
app.use('/auth',     require('./routes/auth'));
app.use('/cart',     require('./routes/cart'));
app.use('/orders',   require('./routes/order'));
app.use('/account',  require('./routes/account'));
app.use('/wishlist', require('./routes/wishlist'));
app.use('/reviews',  require('./routes/reviews'));
app.use('/blog',     require('./routes/blog'));
app.use('/admin',    require('./routes/admin'));
app.use('/api',      require('./routes/api'));

// Legal Pages
app.get('/privacy', (req, res) => res.render('pages/privacy', { pageTitle: 'Privacy Policy', pageDesc: 'Learn about data handling.' }));
app.get('/returns', (req, res) => res.render('pages/returns', { pageTitle: 'Return Policy', pageDesc: 'Return and exchange rules.' }));
app.get('/terms', (req, res) => res.render('pages/terms', { pageTitle: 'Terms & Conditions', pageDesc: 'Legal terms of service.' }));
app.get('/shipping', (req, res) => res.render('pages/shipping', { pageTitle: 'Shipping Info', pageDesc: 'Shipping and cancellations.' }));

// ADMIN QUERIES[cite: 4]
app.get('/admin/queries', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/');
    try {
        const [queries] = await pool.query("SELECT * FROM contacts ORDER BY created_at DESC");
        res.render('pages/admin/queries', { pageTitle: 'Customer Queries', pageDesc: 'View customer messages.', queries });
    } catch (error) {
        res.status(500).send("Internal Server Error");
    }
});

// 404 Handler
app.use((req, res) => res.status(404).render('pages/404', { pageTitle: '404 – Not Found', pageDesc: 'Page does not exist.' }));

// Error Handler
app.use((err, req, res, next) => {
  console.error('Request failed:', req.method, safePath(req), err.code || err.name);
  if (req.is('application/json')) return res.status(err.status || 500).json({success:false,message:'Could not complete the request. Please try again.'});
  res.status(err.status || 500).render('pages/error', {
    pageTitle: 'Error',
    pageDesc: 'An unexpected error occurred.',
    message: config.isDev ? err.message : 'Please try again.',
  });
});

async function start() {
  await require('./config/migrate')();
  const checkout = require('./services/checkout');
  app.listen(config.port, () => console.log('Samadhan listening on port',config.port));
  const tick=()=>checkout.reconcile().catch(e=>console.error('Payment recovery unavailable:',e.code || 'database error'));
  const timer=setInterval(tick,60000); timer.unref();
  void tick();
}
start().catch(e=>{console.error('Startup check failed:',e.message);process.exitCode=1;pool.end();});
