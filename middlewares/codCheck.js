// middlewares/codCheck.js — NCR COD availability
const config = require('../config/app');

function isCODAvailable(city, pincode) {
  // City check
  if (typeof city !== 'string' || typeof pincode !== 'string' || !/^\d{6}$/.test(pincode)) return false;
  const cityLower = city.toLowerCase().trim().replace(/\s+/g,' ');
  const aliases = { 'new delhi':'delhi', 'gurugram':'gurgaon' };
  const normalized = aliases[cityLower] || cityLower;
  const cityMatch = config.cod.cities.some(c => (aliases[c] || c) === normalized);

  // Pincode check
  const pin = parseInt(pincode);
  const pinMatch = pin >= config.cod.pincodeStart && pin <= config.cod.pincodeEnd;

  return cityMatch && pinMatch;
}

module.exports = { isCODAvailable };
