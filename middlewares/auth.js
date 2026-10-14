// middlewares/auth.js
exports.requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Please login first.');
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
};

exports.requireAdmin = (req, res, next) => {
  if (req.session.isAdmin) return next();
  res.status(403).render('pages/error', { pageTitle: 'Access Denied', message: 'Admin access required.' });
};

exports.redirectIfLoggedIn = (req, res, next) => {
  if (req.session.user) return res.redirect('/account');
  next();
};
