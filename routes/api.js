const express  = require('express');
const router   = require('../middlewares/asyncRouter')();
const Product  = require('../models/Product');
const { Wishlist, Banner } = require('../models/User');
const db       = require('../config/db');
const { isCODAvailable } = require('../middlewares/codCheck');

router.get('/search', async (req,res) => {
  const q=typeof req.query.q==='string'?req.query.q.trim().slice(0,80):'';
  if (q.length<2) return res.json({products:[]});
  const products = await Product.search(q);
  res.json({products: products.slice(0,6).map(p=>({
    name: p.name,
    slug: p.slug,
    price: p.price,
    main_image: require('../services/images').imageUrl((p.images||[])[0],96)
  }))});
});

router.post('/quiz-result', async (req,res) => {
  const {answers,productSlug} = req.body;
  const product = await Product.getBySlug(productSlug);
  if (product) await db.query('INSERT INTO quiz_results (answers,recommended_product_id) VALUES (?,?)',[JSON.stringify(answers),product.id]);
  res.json({success:true});
});

router.post('/check-cod', (req,res) => {
  const {city,pincode}=req.body;
  const available=isCODAvailable(city,pincode);
  res.json({available, message:available?'✅ COD is available!':'❌ COD is only available in Delhi NCR.'});
});

// Load more products (pagination for homepage)
router.get('/products', async (req, res) => {
  const offset = Math.min(100000,Math.max(0,parseInt(req.query.offset,10)||0));
  const limit = Math.min(24,Math.max(1,parseInt(req.query.limit,10)||12));
  const rows = await Product.getAll({ limit:limit+1, offset });
  const products=rows.slice(0,limit);
  res.json({
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price: p.price,
      original_price: p.original_price,
      images: (p.images || []).map(image=>require('../services/images').imageUrl(image,480)),
      stock:p.stock,
      category_name: p.category_name,
      badge: p.badge,
      avg_rating: p.avg_rating,
      review_count: p.review_count,
      combo_qty: p.combo_qty,
      combo_price: p.combo_price,
    })),
    hasMore: rows.length > limit,
  });
});

module.exports = router;