const express = require('express');
const router  = require('../middlewares/asyncRouter')();
// FIX: Removed curly braces {} around Order
const Order = require('../models/Order'); 
const { requireLogin } = require('../middlewares/auth');

router.use(requireLogin);

router.get('/', async (req,res,next) => {
  try {
    const orders = await Order.getByUser(req.session.user.id);
    res.render('pages/account',{pageTitle:'My Account – Samadhan', orders, user:req.session.user});
  } catch(error) {
    next(error);
  }
});

module.exports = router;