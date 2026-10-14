// middlewares/validate.js — Input validation helpers

const validators = {
  phone: (val) => {
    if (typeof val !== 'string' || !val) return 'Phone number is required.';
    const cleaned = val.replace(/[\s\-\+\(\)]/g, '');
    if (!/^\d{10}$/.test(cleaned) && !/^91\d{10}$/.test(cleaned)) {
      return 'Phone number must be 10 digits.';
    }
    return null;
  },
  email: (val) => {
    if (typeof val !== 'string' || !val) return 'Email is required.';
    if (val.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
      return 'Please enter a valid email address.';
    }
    return null;
  },
  name: (val) => {
    if (typeof val !== 'string' || !val || val.trim().length < 2) return 'Name must be at least 2 characters.';
    if (val.trim().length > 100) return 'Name too long (max 100 characters).';
    return null;
  },
  pincode: (val) => {
    if (typeof val !== 'string' || !val) return 'Pincode is required.';
    if (!/^\d{6}$/.test(val.trim())) return 'Pincode must be exactly 6 digits.';
    return null;
  },
  address: (val) => {
    if (typeof val !== 'string' || !val || (val.trim().length < 10 || val.length > 2000)) return 'Please enter complete address (min 10 characters).';
    return null;
  },
  city: (val) => {
    if (typeof val !== 'string' || !val || (val.trim().length < 2 || val.length > 100)) return 'City is required.';
    return null;
  },
  state: (val) => {
    if (typeof val !== 'string' || !val || (val.trim().length < 2 || val.length > 100)) return 'State is required.';
    return null;
  },
  password: (val) => {
    if (typeof val !== 'string' || !val) return 'Password is required.';
    if (val.length < 8 || Buffer.byteLength(val,'utf8') > 72) return 'Password must contain at least 8 characters and fit within 72 bytes.';
    return null;
  },
};

// Middleware factory: validates specified fields from req.body
function validateFields(fields, redirectTo) {
  return (req, res, next) => {
    const errors = [];
    for (const field of fields) {
      const validator = validators[field];
      if (validator) {
        const err = validator(req.body[field]);
        if (err) errors.push(err);
      }
    }
    if (errors.length > 0) {
      if (req.headers['content-type']?.includes('application/json')) {
        return res.json({ success: false, message: errors[0] });
      }
      req.flash('error', errors[0]);
      return res.redirect(redirectTo || 'back');
    }
    next();
  };
}

module.exports = { validators, validateFields };
