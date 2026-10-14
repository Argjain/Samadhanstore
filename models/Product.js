// models/Product.js
const db = require('../config/db');

// Safe JSON parse for images
function cleanImageList(list) {
  return (Array.isArray(list) ? list : [])
    .map(v => (typeof v === 'string' ? v.trim() : v))
    .filter(v => typeof v === 'string' && v.length > 0)
    .filter(v => v !== 'null' && v !== 'undefined');
}

function parseImages(val) {
  if (!val) return [];
  if (Array.isArray(val)) return cleanImageList(val);
  if (typeof val === 'string') {
    // Try JSON first
    try { 
      const parsed = JSON.parse(val);
      return cleanImageList(Array.isArray(parsed) ? parsed : [parsed]);
    } catch(e) { 
      // Comma separated fallback
      if (val.includes(',')) return cleanImageList(val.split(','));
      return cleanImageList([val]);
    }
  }
  return [];
}

const Product = {

  async getAll({ categoryId, categorySlug, purpose, material, planet, mulank, zodiac, search, sort, minPrice, maxPrice, inStock, limit, offset, countOnly = false } = {}) {
    let where = ['p.is_active = 1'];
    const params = [];
    if (categoryId)   { where.push('FIND_IN_SET(?, p.category_id)');                                 params.push(categoryId); }
    if (categorySlug) { where.push('EXISTS (SELECT 1 FROM categories filter_cat WHERE FIND_IN_SET(filter_cat.id, p.category_id) AND filter_cat.slug = ?)');    params.push(categorySlug); }
    if (purpose)      { where.push('p.purpose = ?');                                               params.push(purpose); }
    if (material)     { where.push('p.material = ?');                                              params.push(material); }
    if (planet)       { where.push('FIND_IN_SET(?, p.planet)');                                    params.push(planet); }
    if (mulank)       { where.push('FIND_IN_SET(?, p.mulank)');                                    params.push(mulank); }
    if (zodiac)       { where.push('FIND_IN_SET(?, p.zodiac)');                                    params.push(zodiac); }
    if (search)       { where.push('(p.name LIKE ? OR p.description LIKE ?)');                    params.push('%'+search+'%', '%'+search+'%'); }
    if (minPrice !== undefined && minPrice !== '' && Number.isFinite(Number(minPrice)) && Number(minPrice)>=0)     { where.push('p.price >= ?');                                                params.push(parseFloat(minPrice)); }
    if (maxPrice !== undefined && maxPrice !== '' && Number.isFinite(Number(maxPrice)) && Number(maxPrice)>=0)     { where.push('p.price <= ?');                                                params.push(parseFloat(maxPrice)); }
    if (inStock)      { where.push('p.stock > 0'); }

    if(countOnly) {const [[row]]=await db.query(`SELECT COUNT(*) AS total FROM products p WHERE ${where.join(' AND ')}`,params);return row.total;}
    const orderMap = {
      featured:   'p.is_featured DESC, p.sort_order ASC',
      newest:     'p.created_at DESC',
      price_asc:  'p.price ASC',
      price_desc: 'p.price DESC',
      top_rated:  'avg_rating DESC',
    };
    const order = (orderMap[sort] || orderMap.featured) + ', p.id ASC';

    let limitClause = '';
    if (limit) {
      limitClause = ` LIMIT ${Math.min(500,Math.max(1,Math.trunc(Number(limit))||24))}`;
      if (offset) limitClause += ` OFFSET ${Math.min(100000,Math.max(0,Math.trunc(Number(offset))||0))}`;
    }

    const [rows] = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug,
       COALESCE(r.avg_rating,0) as avg_rating,
       COALESCE(r.review_count,0) as review_count
       FROM products p
       LEFT JOIN categories c ON c.id = CAST(SUBSTRING_INDEX(p.category_id, ',', 1) AS UNSIGNED)
       LEFT JOIN (SELECT product_id, AVG(rating) as avg_rating, COUNT(*) as review_count
         FROM reviews WHERE is_approved=1 AND rating BETWEEN 1 AND 5 GROUP BY product_id) r ON r.product_id=p.id
       WHERE ${where.join(' AND ')}
       ORDER BY ${order}${limitClause}`,
      params
    );
    return rows.map(p => ({ ...p, images: parseImages(p.images) }));
  },

  async search(query) {
    const [rows]=await db.query('SELECT name,slug,price,images FROM products WHERE is_active=1 AND name LIKE ? ORDER BY is_featured DESC,id ASC LIMIT 6',['%'+query+'%']);
    return rows.map(p=>({...p,images:parseImages(p.images)}));
  },
  async getFeatured(limit = 8) {
    const [rows] = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = CAST(SUBSTRING_INDEX(p.category_id, ',', 1) AS UNSIGNED)
       WHERE p.is_featured = 1 AND p.is_active = 1
       ORDER BY p.sort_order ASC, p.id ASC
       LIMIT ?`, [limit]
    );
    return rows.map(p => ({ ...p, images: parseImages(p.images) }));
  },

  async getBySlug(slug) {
    const [rows] = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = CAST(SUBSTRING_INDEX(p.category_id, ',', 1) AS UNSIGNED)
       WHERE p.slug = ? AND p.is_active = 1`, [slug]
    );
    if (!rows[0]) return null;
    return { ...rows[0], images: parseImages(rows[0].images) };
  },

  async getById(id) {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
    if (!rows[0]) return null;
    return { ...rows[0], images: parseImages(rows[0].images) };
  },

  async getRelated(categoryId, excludeId, limit = 4) {
    const ids = String(categoryId || '')
      .split(',')
      .map(v => v.trim())
      .filter(v => v.length > 0);
    if (ids.length === 0) return [];

    const catConditions = ids.map(() => 'FIND_IN_SET(?, p.category_id)').join(' OR ');
    const params = [...ids, excludeId, limit];

    const [rows] = await db.query(
      `SELECT p.*, c.name as category_name, c.slug as category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = CAST(SUBSTRING_INDEX(p.category_id, ',', 1) AS UNSIGNED)
       WHERE (${catConditions}) AND p.id != ? AND p.is_active = 1
       LIMIT ?`,
      params
    );
    return rows.map(p => ({ ...p, images: parseImages(p.images) }));
  },

  async create(data) {
    const slug = (data.slug || data.name)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const images = JSON.stringify(Array.isArray(data.images) ? data.images : []);
    const categoryId = Array.isArray(data.category_id) ? data.category_id.join(',') : data.category_id;
    const planetStr = Array.isArray(data.planet) ? data.planet.join(',') : data.planet;
    const mulankStr = Array.isArray(data.mulank) ? data.mulank.join(',') : data.mulank;
    const zodiacStr = Array.isArray(data.zodiac) ? data.zodiac.join(',') : data.zodiac;
    const [result] = await db.query(
      `INSERT INTO products
       (name,slug,category_id,purpose,material,price,original_price,
        description,stone_benefits,images,badge,stock,is_featured,seo_title,seo_desc,
        combo_qty,combo_price,planet,mulank,zodiac)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [data.name, slug, categoryId||null, data.purpose||null, data.material||null,
       data.price, data.original_price||null, data.description||'', data.stone_benefits||'',
       images, data.badge||null, data.stock||100, data.is_featured?1:0,
       data.seo_title||null, data.seo_desc||null,
       data.combo_qty||null, data.combo_price||null,
       planetStr||null, mulankStr||null, zodiacStr||null]
    );
    return result.insertId;
  },

  async update(id, data) {
    const slug = (data.slug || data.name)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    // images already stringified from route
    const images = typeof data.images === 'string'
      ? data.images
      : JSON.stringify(Array.isArray(data.images) ? data.images : []);
    const planetStr = Array.isArray(data.planet) ? data.planet.join(',') : data.planet;
    const mulankStr = Array.isArray(data.mulank) ? data.mulank.join(',') : data.mulank;
    const zodiacStr = Array.isArray(data.zodiac) ? data.zodiac.join(',') : data.zodiac;
    const categoryId = Array.isArray(data.category_id) ? data.category_id.join(',') : data.category_id;
    await db.query(
      `UPDATE products SET
       name=?,slug=?,category_id=?,purpose=?,material=?,price=?,original_price=?,
       description=?,stone_benefits=?,images=?,badge=?,stock=?,is_featured=?,
       seo_title=?,seo_desc=?,combo_qty=?,combo_price=?,
       planet=?,mulank=?,zodiac=?
       WHERE id=?`,
      [data.name, slug, categoryId||null, data.purpose||null, data.material||null,
       data.price, data.original_price||null, data.description||'', data.stone_benefits||'',
       images, data.badge||null, data.stock||0, data.is_featured?1:0,
       data.seo_title||null, data.seo_desc||null,
       data.combo_qty||null, data.combo_price||null,
       planetStr||null, mulankStr||null, zodiacStr||null, id]
    );
  },

  async delete(id) {
    await db.query('DELETE FROM products WHERE id = ?', [id]);
  },

  async updateStock(id, qty) {
    await db.query('UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?', [qty, id]);
  },

  async getFilters() {
    try {
      const [purposes]  = await db.query('SELECT DISTINCT purpose  FROM products WHERE purpose  IS NOT NULL AND is_active=1');
      const [materials] = await db.query('SELECT DISTINCT material FROM products WHERE material IS NOT NULL AND is_active=1');
      const [[price]]   = await db.query('SELECT MIN(price) as min_price, MAX(price) as max_price FROM products WHERE is_active=1');
      return {
        purposes:   purposes.map(p => p.purpose),
        materials:  materials.map(m => m.material),
        priceRange: price || { min_price: 0, max_price: 9999 },
      };
    } catch(e) {
      return { purposes: [], materials: [], priceRange: { min_price: 0, max_price: 9999 } };
    }
  },

  async getStats() {
    const [[s]] = await db.query(
      'SELECT COUNT(*) as total, SUM(CASE WHEN stock < 10 THEN 1 ELSE 0 END) as low_stock FROM products'
    );
    return s;
  },
};

module.exports = Product;
