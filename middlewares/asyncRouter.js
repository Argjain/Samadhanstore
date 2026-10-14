// Express 4 does not forward rejected async handlers to its error handler.
const express = require('express');
module.exports = function asyncRouter() {
  const router = express.Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
    const original = router[method];
    const wrap = value => Array.isArray(value) ? value.map(wrap) :
      (typeof value === 'function' && value.length < 4 ? function(req, res, next) {
        try { Promise.resolve(value(req, res, next)).catch(next); } catch (error) { next(error); }
      } : value);
    router[method] = function(...args) { return original.apply(this, args.map(wrap)); };
  }
  return router;
};
