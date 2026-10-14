const { User } = require('../models/User');
module.exports = async function sessionSecurity(req, res, next) {
  try {
    if (req.session.user || req.session.isAdmin) {
      const user = req.session.user && await User.findById(req.session.user.id);
      if (!user || req.session.user.authVersion !== Number(user.session_version) || !!req.session.isAdmin !== (user.role === 'admin')) {
        const cart = req.session.cart;
        await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
        if (cart) req.session.cart = cart;
      }
    }
    next();
  } catch (err) { next(err); }
};
