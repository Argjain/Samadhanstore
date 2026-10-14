// config/app.js — Central Config (auto reads .env)
require('dotenv').config();
const path = require('path');

// Project root = parent of this /config directory. Used to anchor upload
// folders to an absolute location independent of the process CWD.
const rootDir = path.join(__dirname, '..');

function numberEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid numeric configuration: ' + key);
  return value;
}
const config = {
  port:  process.env.PORT  || 3000,
  env:   process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV !== 'production',

  db: {
    host:     process.env.DB_HOST || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT || '3306', 10),
    user:     process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'samadhan_v3',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_POOL_LIMIT || '10', 10),
  },

  session: {
    secret: process.env.SESSION_SECRET || 'samadhan_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  },

  site: {
    name:       process.env.SITE_NAME      || 'Samadhan',
    tagline:    process.env.SITE_TAGLINE   || 'Wear The Universe',
    url:        process.env.SITE_URL       || 'http://localhost:3000',
    email:      process.env.SITE_EMAIL     || 'support@samadhanstore.com',
    phone:      process.env.SITE_PHONE     || '+91 98765 43210',
    whatsapp:   process.env.SITE_WHATSAPP  || '919876543210',
    address:    process.env.SITE_ADDRESS   || 'Delhi, India',
    instagram:  process.env.SITE_INSTAGRAM || '#',
    facebook:   process.env.SITE_FACEBOOK  || '#',
  },

  payu: {
    key:  process.env.PAYU_KEY  || '',
    salt: process.env.PAYU_SALT || '',
    mode: process.env.PAYU_MODE || 'test',
    url:  process.env.PAYU_MODE === 'live'
      ? 'https://secure.payu.in/_payment'
      : 'https://test.payu.in/_payment',
  },

  sms: {
    key: process.env.FAST2SMS_KEY || '',
  },

  mail: {
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT) || 587,
    user: process.env.MAIL_USER || '',
    pass: process.env.MAIL_PASS || '',
    from: process.env.MAIL_FROM || 'Samadhan <support@samadhanstore.com>',
  },

  business: {
    freeShippingAbove:    numberEnv('FREE_SHIPPING_ABOVE',999),
    shippingCharge:       numberEnv('SHIPPING_CHARGE',79),
    currency:             process.env.CURRENCY        || 'INR',
    currencySymbol:       process.env.CURRENCY_SYMBOL || '₹',
    gstPercent:           numberEnv('GST_PERCENT',0),
    onlinePaymentDiscount:numberEnv('ONLINE_PAYMENT_DISCOUNT',5),
  },

  cod: {
    cities:       (process.env.COD_CITIES || 'Delhi,Noida,Gurgaon,Faridabad,Ghaziabad,Greater Noida')
                    .split(',').map(c => c.trim().toLowerCase()),
    pincodeStart: parseInt(process.env.COD_PINCODE_START) || 110001,
    pincodeEnd:   parseInt(process.env.COD_PINCODE_END)   || 201310,
  },

  seo: {
    title:    process.env.SEO_TITLE    || 'Samadhan – Wear The Universe',
    desc:     process.env.SEO_DESC     || 'Authentic spiritual bracelets India',
    keywords: process.env.SEO_KEYWORDS || 'spiritual bracelets,crystal bracelets',
    gaId:     process.env.GA_ID        || '',
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@samadhan.com',
    pass:  process.env.ADMIN_PASS  || 'Samadhan@2026',
  },

  razorpay: {
    keyId:     process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  upload: {
    // Uploads go OUTSIDE the deploy folder so they survive redeployments.
    // On Hostinger: /home/user/domains/site/uploads/ (sibling of nodejs/)
    // On local: ./uploads/ (project root ke andar ek folder)
    baseDir: process.env.UPLOAD_DIR || path.join(rootDir, '..', 'uploads'),
    productImages: path.join(process.env.UPLOAD_DIR || path.join(rootDir, '..', 'uploads'), 'products'),
    bannerImages:  path.join(process.env.UPLOAD_DIR || path.join(rootDir, '..', 'uploads'), 'banners'),
    comboImages:   path.join(process.env.UPLOAD_DIR || path.join(rootDir, '..', 'uploads'), 'combos'),
    logoPath:      path.join(rootDir, 'public/images/logo/'),
    maxSize:       15 * 1024 * 1024, // 15MB
    formats:       ['image/jpeg','image/png','image/webp'],
  },
};

if (config.env === 'production') {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'samadhan_secret') throw new Error('A private SESSION_SECRET is required in production. Keep your existing value.');
  if (!process.env.UPLOAD_DIR || !path.isAbsolute(process.env.UPLOAD_DIR)) throw new Error('UPLOAD_DIR must point to your existing external upload folder.');
}
module.exports = config;
