// models/ComboDeals.js — Multi-product combo deals
const db = require('../config/db');

// Normalize product_ids from form (single checkbox => string, multiple => array)
function normalizeIds(val) {
  if (val === undefined || val === null) return [];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map(Number).filter(n => Number.isInteger(n) && n > 0);
}

function parseImages(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(v => typeof v === 'string' && v.length > 0);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string' && v.length > 0) : [parsed];
    } catch(e) {
      return val.includes(',') ? val.split(',').map(s => s.trim()).filter(Boolean) : [val];
    }
  }
  return [];
}

async function hydrate(deals, publicOnly=false) {
  for(const deal of deals) deal.product_ids=deal.product_ids?String(deal.product_ids).split(',').map(Number):[];
  const ids=[...new Set(deals.flatMap(d=>d.product_ids))];
  if(!ids.length) return publicOnly ? [] : deals.map(d=>({...d,products:[]}));
  const [rows]=await db.query('SELECT id,name,price,original_price,images,slug,is_active,stock FROM products WHERE id IN (?)',[ids]);
  const products=new Map(rows.map(p=>[p.id,{...p,images:parseImages(p.images)}]));
  for(const deal of deals) deal.products=deal.product_ids.map(id=>products.get(id)).filter(Boolean);
  return publicOnly?deals.filter(d=>d.products.length===d.product_ids.length && d.products.length>0 && d.products.every(p=>p.is_active)):deals;
}

const ComboDeals = {

  async getAll() {
    const [deals] = await db.query(
      `SELECT cd.*, GROUP_CONCAT(cdi.product_id) as product_ids
       FROM combo_deals cd
       LEFT JOIN combo_deal_items cdi ON cd.id = cdi.combo_deal_id
       GROUP BY cd.id
       ORDER BY cd.created_at DESC`
    );
    // Fetch product details for each deal
    return hydrate(deals);
  },

  async getById(id) {
    const [rows] = await db.query('SELECT * FROM combo_deals WHERE id = ?', [id]);
    if (!rows[0]) return null;
    const deal = rows[0];
    const [items] = await db.query(
      'SELECT product_id FROM combo_deal_items WHERE combo_deal_id = ?', [id]
    );
    deal.product_ids = items.map(i => i.product_id);
    const [products] = await db.query(
      'SELECT id, name, price, original_price, images, slug FROM products WHERE id IN (?)',
      [deal.product_ids.length ? deal.product_ids : [0]]
    );
    deal.products = products.map(p => ({ ...p, images: parseImages(p.images) }));
    return deal;
  },

  async getActiveDeals() {
    const [deals] = await db.query(
      `SELECT cd.*, GROUP_CONCAT(cdi.product_id) as product_ids
       FROM combo_deals cd
       LEFT JOIN combo_deal_items cdi ON cd.id = cdi.combo_deal_id
       WHERE cd.is_active = 1
       GROUP BY cd.id`
    );
    return hydrate(deals,true);
  },

  // Find deals that include a specific product
  async getDealsForProduct(productId) {
    const [rows] = await db.query(
      `SELECT cd.*, GROUP_CONCAT(cdi2.product_id) as product_ids
       FROM combo_deals cd
       JOIN combo_deal_items cdi ON cd.id = cdi.combo_deal_id AND cdi.product_id = ?
       LEFT JOIN combo_deal_items cdi2 ON cd.id = cdi2.combo_deal_id
       WHERE cd.is_active = 1
       GROUP BY cd.id`,
      [productId]
    );
    return hydrate(rows,true);
  },

  // Find matching deals from cart product IDs
  async findMatchingDeals(cartProductIds) {
    if (!cartProductIds.length) return [];
    const activeDeals = await this.getActiveDeals();
    return activeDeals.filter(deal => {
      return deal.product_ids.every(pid => cartProductIds.includes(pid));
    });
  },

  async create(data) {
    const [result] = await db.query(
      'INSERT INTO combo_deals (title, description, image, combo_price, is_active) VALUES (?,?,?,?,?)',
      [data.title, data.description || '', data.image || null, data.combo_price, data.is_active ? 1 : 0]
    );
    const dealId = result.insertId;
    // Add product items
    const productIds = normalizeIds(data.product_ids);
    if (productIds.length > 0) {
      const values = productIds.map(pid => [dealId, pid]);
      await db.query('INSERT INTO combo_deal_items (combo_deal_id, product_id) VALUES ?', [values]);
    }
    return dealId;
  },

  async update(id, data) {
    if (data.image !== undefined && data.image !== null && data.image !== '') {
      await db.query(
        'UPDATE combo_deals SET title=?, description=?, image=?, combo_price=?, is_active=? WHERE id=?',
        [data.title, data.description || '', data.image, data.combo_price, data.is_active ? 1 : 0, id]
      );
    } else {
      await db.query(
        'UPDATE combo_deals SET title=?, description=?, combo_price=?, is_active=? WHERE id=?',
        [data.title, data.description || '', data.combo_price, data.is_active ? 1 : 0, id]
      );
    }
    // Replace product items
    await db.query('DELETE FROM combo_deal_items WHERE combo_deal_id = ?', [id]);
    const productIds = normalizeIds(data.product_ids);
    if (productIds.length > 0) {
      const values = productIds.map(pid => [id, pid]);
      await db.query('INSERT INTO combo_deal_items (combo_deal_id, product_id) VALUES ?', [values]);
    }
  },

  async delete(id) {
    await db.query('DELETE FROM combo_deals WHERE id = ?', [id]);
  },
};

module.exports = ComboDeals;
