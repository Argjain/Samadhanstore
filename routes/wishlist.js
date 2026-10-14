const express = require('express');
const router  = require('../middlewares/asyncRouter')();
const { Wishlist } = require('../models/User');
const { requireLogin } = require('../middlewares/auth');

router.use(requireLogin);

router.get('/', async (req,res) => {
  const items = await Wishlist.get(req.session.user.id);
  res.render('pages/wishlist',{pageTitle:'My Wishlist – Samadhan', items});
});

router.post('/toggle', async (req,res) => {
  const {productId} = req.body;
  const added = await Wishlist.toggle(req.session.user.id, parseInt(productId));
  res.json({success:true, added, message: added ? 'Added to wishlist! ❤️' : 'Removed from wishlist.'});
});

module.exports = router;
