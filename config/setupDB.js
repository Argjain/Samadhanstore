// config/setupDB.js — Run: npm run setup-db
require('dotenv').config();
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./app');

async function setup() {
  console.log('\n🪬 Setting up Samadhan V3 database...\n');

  const raw = await mysql.createConnection({
    host: config.db.host, user: config.db.user, password: config.db.password,
  });

  await raw.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await raw.query(`USE \`${config.db.database}\``);
  console.log(`✅ Database "${config.db.database}" ready`);

  // ── TABLES ──
  const tables = [
    // Site settings
    `CREATE TABLE IF NOT EXISTS site_settings (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      key_name  VARCHAR(100) NOT NULL UNIQUE,
      value     TEXT,
      label     VARCHAR(200),
      type      ENUM('text','number','boolean','color','textarea','image') DEFAULT 'text',
      group_name VARCHAR(100) DEFAULT 'general',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,

    // Categories
    `CREATE TABLE IF NOT EXISTS categories (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(100) NOT NULL,
      slug       VARCHAR(100) NOT NULL UNIQUE,
      icon       VARCHAR(10)  DEFAULT '💎',
      description TEXT,
      image      VARCHAR(300),
      sort_order INT DEFAULT 0,
      is_active  TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Products
    `CREATE TABLE IF NOT EXISTS products (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      name           VARCHAR(200) NOT NULL,
      slug           VARCHAR(200) NOT NULL UNIQUE,
      category_id    INT,
      purpose        VARCHAR(100),
      material       VARCHAR(100),
      price          DECIMAL(10,2) NOT NULL,
      original_price DECIMAL(10,2),
      description    TEXT,
      stone_benefits TEXT,
      images         JSON,
      badge          VARCHAR(50),
      stock          INT DEFAULT 100,
      is_featured    TINYINT(1) DEFAULT 0,
      is_active      TINYINT(1) DEFAULT 1,
      seo_title      VARCHAR(200),
      seo_desc       VARCHAR(300),
      sort_order     INT DEFAULT 0,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    )`,

    // Users (Updated with Reset Token Columns)
    `CREATE TABLE IF NOT EXISTS users (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      name                 VARCHAR(150) NOT NULL,
      email                VARCHAR(200) NOT NULL UNIQUE,
      phone                VARCHAR(15),
      password             VARCHAR(255) NOT NULL,
      role                 ENUM('user','admin') DEFAULT 'user',
      resetPasswordToken   VARCHAR(255) NULL,
      resetPasswordExpires DATETIME NULL,
      created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Wishlist
    `CREATE TABLE IF NOT EXISTS wishlist (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      product_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_wishlist (user_id, product_id),
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,

    // Orders
    `CREATE TABLE IF NOT EXISTS orders (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      order_id       VARCHAR(50) NOT NULL UNIQUE,
      user_id        INT,
      name           VARCHAR(150) NOT NULL,
      email          VARCHAR(200) NOT NULL,
      phone          VARCHAR(15)  NOT NULL,
      address        TEXT NOT NULL,
      city           VARCHAR(100) NOT NULL,
      state          VARCHAR(100) NOT NULL,
      pincode        VARCHAR(10)  NOT NULL,
      items          JSON NOT NULL,
      subtotal       DECIMAL(10,2) NOT NULL,
      discount       DECIMAL(10,2) DEFAULT 0,
      coupon_code    VARCHAR(50),
      shipping       DECIMAL(10,2) DEFAULT 0,
      gst            DECIMAL(10,2) DEFAULT 0,
      total          DECIMAL(10,2) NOT NULL,
      payment_method VARCHAR(50)   DEFAULT 'cod',
      payment_id     VARCHAR(100),
      payment_status ENUM('pending','paid','failed') DEFAULT 'pending',
      order_status   ENUM('placed','confirmed','processing','shipped','out_for_delivery','delivered','cancelled') DEFAULT 'placed',
      tracking_id    VARCHAR(100),
      notes          TEXT,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,

    // Coupons
    `CREATE TABLE IF NOT EXISTS coupons (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      code        VARCHAR(50) NOT NULL UNIQUE,
      type        ENUM('percent','fixed') NOT NULL,
      value       DECIMAL(10,2) NOT NULL,
      min_order   DECIMAL(10,2) DEFAULT 0,
      max_uses    INT DEFAULT 100,
      used_count  INT DEFAULT 0,
      is_active   TINYINT(1) DEFAULT 1,
      expires_at  DATE DEFAULT NULL,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Reviews
    `CREATE TABLE IF NOT EXISTS reviews (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      user_id    INT,
      name       VARCHAR(100) NOT NULL,
      email      VARCHAR(200),
      rating     TINYINT(1) DEFAULT 5,
      title      VARCHAR(200),
      review     TEXT,
      is_approved TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    )`,

    // Banners
    `CREATE TABLE IF NOT EXISTS banners (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      text       VARCHAR(500) NOT NULL,
      link       VARCHAR(300),
      bg_color   VARCHAR(20) DEFAULT '#2d1b69',
      text_color VARCHAR(20) DEFAULT '#ffffff',
      is_active  TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0
    )`,

    // Festival offers
    `CREATE TABLE IF NOT EXISTS festival_offers (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      title       VARCHAR(200) NOT NULL,
      description TEXT,
      discount    DECIMAL(5,2) DEFAULT 0,
      coupon_code VARCHAR(50),
      starts_at   DATETIME,
      ends_at     DATETIME,
      is_active   TINYINT(1) DEFAULT 1,
      image       VARCHAR(300),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Quiz results
    `CREATE TABLE IF NOT EXISTS quiz_results (
      id                     INT AUTO_INCREMENT PRIMARY KEY,
      answers                JSON,
      recommended_product_id INT,
      created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // Contacts Table (Queries)
    `CREATE TABLE IF NOT EXISTS contacts (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      email      VARCHAR(255) NOT NULL,
      phone      VARCHAR(20),
      subject    VARCHAR(255),
      message    TEXT NOT NULL,
      status     ENUM('new', 'read', 'replied') DEFAULT 'new',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];
  for (const sql of tables) {
    await raw.query(sql);
  }
  console.log('✅ All tables created');

  // ── SITE SETTINGS ──
  const settings = [
    ['site_name',        'Samadhan',                           'Site Name',              'text',     'general'],
    ['site_tagline',     'Wear The Universe',                  'Tagline',                'text',     'general'],
    ['site_email',       'support@samadhanstore.com',               'Support Email',          'text',     'general'],
    ['site_phone',       '+91 98765 43210',                    'Phone Number',           'text',     'general'],
    ['site_whatsapp',    '919876543210',                       'WhatsApp Number',        'text',     'general'],
    ['site_address',     'Delhi, India',                       'Address',                'text',     'general'],
    ['site_instagram',   '#',                                  'Instagram URL',          'text',     'social'],
    ['site_facebook',    '#',                                  'Facebook URL',           'text',     'social'],
    ['free_shipping',    '999',                                'Free Shipping Above ₹',  'number',   'shipping'],
    ['shipping_charge',  '79',                                 'Shipping Charge ₹',      'number',   'shipping'],
    ['online_discount',  '5',                                  'Online Payment Discount %','number', 'payment'],
    ['gst_percent',      '0',                                  'GST %',                  'number',   'payment'],
    ['seo_title',        'Samadhan – Wear The Universe | Spiritual Bracelets India', 'SEO Title', 'text', 'seo'],
    ['seo_desc',         'Buy authentic crystal bracelets, evil eye, rudraksha online. Free shipping above ₹999. COD on select pincodes.', 'SEO Description', 'textarea', 'seo'],
    ['seo_keywords',     'spiritual bracelets,crystal bracelets Delhi,evil eye,rudraksha', 'SEO Keywords', 'textarea', 'seo'],
    ['ga_id',            '',                                   'Google Analytics ID',    'text',     'seo'],
    ['promo_banner',     '🎉 Use code SAMADHAN10 for 10% OFF | Free shipping above ₹999 | COD available on select pincodes', 'Promo Banner Text', 'text', 'marketing'],
    ['promo_banner_active','1',                                'Promo Banner Active',    'boolean',  'marketing'],
    ['promo_banner_color','#2d1b69',                           'Banner Background Color','color',    'marketing'],
    ['cod_cities',       'Delhi,Noida,Gurgaon,Gurugram,Faridabad,Ghaziabad,Greater Noida', 'COD Available Cities', 'textarea', 'shipping'],
    ['return_policy',    '7 days easy return policy',         'Return Policy',          'text',     'general'],
    ['about_text',       'Samadhan was founded with a belief that nature has answers to every problem. Our mission is to bring authentic, spiritually charged gemstone products to people.', 'About Us Text', 'textarea', 'general'],
  ];

  for (const [key, value, label, type, group] of settings) {
    await raw.query(
      'INSERT IGNORE INTO site_settings (key_name, value, label, type, group_name) VALUES (?,?,?,?,?)',
      [key, value, label, type, group]
    );
  }
  console.log('✅ Site settings initialized');

  // ── CATEGORIES ──
  const [catCount] = await raw.query('SELECT COUNT(*) as c FROM categories');
  if (catCount[0].c === 0) {
    const cats = [
      ['Crystal Bracelets',    'crystal-bracelets',    '💎', 'Natural healing crystal bracelets', 0],
      ['Rudraksha',            'rudraksha',            '🟤', 'Authentic Nepali Rudraksha products', 1],
      ['Evil Eye',             'evil-eye',             '👁️', 'Protection from negative energy', 2],
      ['Sacred Geometry',      'sacred-geometry',      '🔺', 'Pyramids, turtles and sacred symbols', 3],
      ['Money & Prosperity',   'money-prosperity',     '🌳', 'Attract wealth and abundance', 4],
      ['Gift Hampers',         'gift-hampers',         '🎁', 'Perfect spiritual gift sets', 5],
    ];
    await raw.query(
      'INSERT INTO categories (name,slug,icon,description,sort_order) VALUES ?',
      [cats]
    );
    console.log('✅ Categories created');
  }

  // ── ADMIN USER ──
  const [admins] = await raw.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (admins.length === 0) {
    const hashed = await bcrypt.hash(config.admin.pass, 10);
    await raw.query(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')",
      ['Admin', config.admin.email, hashed]
    );
    console.log(`✅ Admin: ${config.admin.email}`);
  }

  // ── SAMPLE PRODUCTS ──
  const [pCount] = await raw.query('SELECT COUNT(*) as c FROM products');
  if (pCount[0].c === 0) {
    const [cats] = await raw.query('SELECT id, slug FROM categories');
    const catMap = {};
    cats.forEach(c => catMap[c.slug] = c.id);

    const products = [
      [catMap['crystal-bracelets'], 'Black Obsidian Bracelet',   'black-obsidian-bracelet',   'Protection', 'Natural Stone', 499, 799,  'Powerful protection stone that blocks negative energy.', 'Blocks negative energy|Brings clarity|Grounding effect', JSON.stringify(['/images/products/black-obsidian.jpg']), 'Best Seller', 100, 1],
      [catMap['crystal-bracelets'], 'Rose Quartz Bracelet',      'rose-quartz-bracelet',      'Love',       'Natural Stone', 599, 899,  'Stone of love and compassion.', 'Self-love|Relationship harmony|Emotional healing', JSON.stringify(['/images/products/rose-quartz.jpg']), 'Best Seller', 100, 1],
      [catMap['crystal-bracelets'], "Tiger's Eye Bracelet",      'tigers-eye-bracelet',       'Focus',      'Natural Stone', 699, 999,  'Stone of confidence and courage.', 'Confidence|Mental clarity|Success', JSON.stringify(['/images/products/tigers-eye.jpg']), 'Best Seller', 100, 1],
      [catMap['crystal-bracelets'], 'Amethyst Bracelet',         'amethyst-bracelet',         'Healing',    'Natural Stone', 749, 1099, 'Spiritual awareness and inner peace.', 'Stress relief|Better sleep|Intuition', JSON.stringify(['/images/products/amethyst.jpg']), 'New', 100, 1],
      [catMap['evil-eye'],          'Evil Eye Bracelet',         'evil-eye-bracelet',         'Protection', 'Metal',         549, 799,  'Classic evil eye protection bracelet.', 'Protection|Good luck|Positive vibes', JSON.stringify(['/images/products/evil-eye.jpg']), 'Popular', 100, 1],
      [catMap['sacred-geometry'],   'Crystal Pyramid',           'crystal-pyramid',           'Energy',     'Crystal',       899, 1299, 'Sacred geometry pyramid for energy amplification.', 'Energy amplify|Vastu correction|Meditation', JSON.stringify(['/images/products/pyramid.jpg']), null, 100, 0],
      [catMap['money-prosperity'],  'Money Tree Crystal',        'money-tree-crystal',        'Wealth',     'Crystal',       799, 1199, 'Attract wealth and prosperity.', 'Wealth attraction|Business success|Positive energy', JSON.stringify(['/images/products/money-tree.jpg']), 'Hot', 100, 0],
      [catMap['sacred-geometry'],   'Stone Turtle',              'stone-turtle',              'Wealth',     'Natural Stone', 649, 949,  'Feng shui stone turtle for luck.', 'Good luck|Career growth|Stability', JSON.stringify(['/images/products/turtle.jpg']), null, 100, 0],
    ];

    for (const p of products) {
      const [cat_id, name, slug, purpose, material, price, orig_price, desc, benefits, images, badge, stock, featured] = p;
      await raw.query(
        'INSERT INTO products (category_id,name,slug,purpose,material,price,original_price,description,stone_benefits,images,badge,stock,is_featured) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [cat_id, name, slug, purpose, material, price, orig_price, desc, benefits, images, badge, stock, featured]
      );
    }
    console.log('✅ Sample products added');
  }

  // ── SAMPLE BANNERS ──
  const [bCount] = await raw.query('SELECT COUNT(*) as c FROM banners');
  if (bCount[0].c === 0) {
    await raw.query(
      'INSERT INTO banners (text, link, bg_color, text_color, is_active, sort_order) VALUES ?',
      [[
        ['🎉 Use code SAMADHAN10 for 10% OFF on your first order!', '/shop', '#2d1b69', '#e8e4f0', 1, 1],
        ['✨ Free shipping on orders above ₹999 | COD available on select pincodes', '/shop', '#1a1040', '#e8e4f0', 1, 2],
        ['🔮 New arrivals every week — Shop the latest spiritual collection', '/shop', '#3d2b89', '#e8e4f0', 1, 3],
      ]]
    );
    console.log('✅ Banners created');
  }

  // ── SAMPLE COUPONS ──
  const [cCount] = await raw.query('SELECT COUNT(*) as c FROM coupons');
  if (cCount[0].c === 0) {
    await raw.query(
      'INSERT INTO coupons (code,type,value,min_order,max_uses) VALUES ?',
      [[
        ['SAMADHAN10', 'percent', 10, 0,   500],
        ['WELCOME50',  'fixed',   50, 299, 200],
        ['SPIRITUAL20','percent', 20, 499, 100],
        ['UNIVERSE15', 'percent', 15, 399, 150],
      ]]
    );
    console.log('✅ Coupons added');
  }

  await raw.end();
  console.log('\n🎉 Samadhan V3 setup complete!');
  console.log('   Run: npm run dev\n');
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
