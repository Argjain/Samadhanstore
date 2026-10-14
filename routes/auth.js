const express = require('express');
const router  = require('../middlewares/asyncRouter')();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const config = require('../config/app');
router.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});next();});
const { User } = require('../models/User');
const { redirectIfLoggedIn } = require('../middlewares/auth');
const { validateFields, validators } = require('../middlewares/validate');

router.get('/login',    redirectIfLoggedIn, (req,res) => res.render('pages/auth', {pageTitle:'Login',mode:'login'}));
router.get('/register', redirectIfLoggedIn, (req,res) => res.render('pages/auth', {pageTitle:'Register',mode:'register'}));

router.post('/login', redirectIfLoggedIn, async (req,res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string') { req.flash('error','Please enter your email and password.'); return res.redirect('/auth/login'); }
  const user = await User.findByEmail(email);
  if (!user || !(await User.verifyPassword(password, user.password))) {
    req.flash('error','Incorrect email or password.');
    return res.render('pages/auth',{pageTitle:'Login',mode:'login'});
  }
  const retained = {};
  for (const key of ['cart','coupon','discount','buyNowCart','buyNowCoupon','buyNowDiscount','checkoutOwner','orderAccess','returnTo']) if(req.session[key]!==undefined) retained[key]=req.session[key];
  await new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
  Object.assign(req.session,retained);
  req.session.user    = {id:user.id, name:user.name, email:user.email, phone:user.phone, authVersion:Number(user.session_version)};
  req.session.isAdmin = user.role === 'admin';
  const returnTo = req.session.returnTo || (user.role==='admin'?'/admin':'/account');
  delete req.session.returnTo;
  req.flash('success',`Welcome back, ${user.name}! 🙏`);
  res.redirect(returnTo);
});

router.post('/register', redirectIfLoggedIn, validateFields(['name', 'email', 'phone', 'password'], '/auth/register'), async (req,res) => {
  const {name,email,phone,password,confirm_password} = req.body;
  if (password!==confirm_password) { req.flash('error','Passwords do not match.'); return res.render('pages/auth',{pageTitle:'Register',mode:'register'}); }
  const existing = await User.findByEmail(email);
  if (existing) { req.flash('error','Email already registered.'); return res.render('pages/auth',{pageTitle:'Register',mode:'register'}); }
  await User.create({name,email,phone,password});
  req.flash('success','Account created successfully! 🎉');
  res.redirect('/auth/login');
});

router.get('/logout', (req,res) => req.session.destroy(()=>res.redirect('/')));
// --- FORGOT PASSWORD ROUTES ---

// 1. Forgot Password Page dikhana
router.get('/forgot-password', (req, res) => {
    res.render('pages/forgot-password', { pageTitle: 'Forgot Password' });
});

// 2. Email bhejne ka logic
router.post('/forgot-password', validateFields(['email'], '/auth/forgot-password'), async (req, res) => {
    const { email } = req.body;
    const user = await User.findByEmail(email);

    // Identical response for missing accounts and unavailable email delivery.
    req.flash('success', 'If an account exists, a reset link will be sent to its email.');
    res.redirect('/auth/forgot-password');
    if (!user || !config.mail.user || !config.mail.pass) return;
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now()+3600000).toISOString().slice(0,19).replace('T',' ');
    try {
      await User.saveResetToken(email,token,expires);
      const transporter = nodemailer.createTransport({host:config.mail.host,port:config.mail.port,secure:config.mail.port===465,
        auth:{user:config.mail.user,pass:config.mail.pass},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
      await transporter.sendMail({to:user.email,from:config.mail.from,subject:'Password Reset Request - Samadhan',
        text:'Set a new password using this link (expires in 1 hour): '+config.site.url.replace(/\/$/,'')+'/auth/reset-password/'+token});
    } catch(err) {
      console.error('Reset email unavailable:',err.code || 'delivery failed');
      await User.clearResetToken(email,token).catch(()=>{});
    }
});

// 3. Reset Password Page dikhana
router.get('/reset-password/:token', async (req, res) => {
    const user = await User.findByToken(req.params.token);
    if (!user) {
        req.flash('error', 'This password reset link is invalid or has expired.');
        return res.redirect('/auth/forgot-password');
    }
    res.render('pages/reset-password', { token: req.params.token, pageTitle: 'Reset Password' });
});

// 4. Naya Password Save karna
router.post('/reset-password/:token', async (req, res) => {
    const user = await User.findByToken(req.params.token);
    
    if (!user) {
        req.flash('error', 'Invalid or expired reset token.');
        return res.redirect('/auth/forgot-password');
    }

    const passwordError = validators.password(req.body.password);
    if (passwordError) { req.flash('error',passwordError); return res.redirect('/auth/reset-password/' + encodeURIComponent(req.params.token)); }
    if (req.body.password !== req.body.confirmPassword) {
        req.flash('error', 'Passwords do not match.');
        return res.redirect('back');
    }

    if (!await User.updatePassword(user.id, req.body.password, req.params.token)) {
      req.flash('error','This reset link has already been used or expired.');return res.redirect('/auth/forgot-password');
    }
    await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));

    req.flash('success', 'Password changed successfully! Please log in.');
    res.redirect('/auth/login');
});
module.exports = router;
