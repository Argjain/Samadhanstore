const express = require('express');
const router  = require('../middlewares/asyncRouter')();
const { Review } = require('../models/User');
const { requireLogin } = require('../middlewares/auth');

router.post('/add', requireLogin, async (req,res) => {
  const {productId,rating,title,review} = req.body;
  const score=Number(rating), id=Number(productId);
  if (!Number.isSafeInteger(id) || id<1 || !Number.isInteger(score) || score<1 || score>5 ||
      typeof review!=='string' || !review.trim() || review.length>5000 || (title!==undefined && (typeof title!=='string' || title.length>150))) {
    return res.status(400).json({success:false,message:'Choose 1–5 stars and enter a review (up to 5,000 characters).'});
  }
  const product=await require('../models/Product').getById(id);
  if(!product || !product.is_active) return res.status(404).json({success:false,message:'Product not found.'});
  await Review.create({productId:parseInt(productId), userId:req.session.user.id, name:req.session.user.name, email:req.session.user.email, rating:score, title, review});
  req.flash('success','Review submitted successfully! It will be visible after approval. 🙏');
  res.json({success:true,message:'Review submitted successfully!'});
});

module.exports = router;
