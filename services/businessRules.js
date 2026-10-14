const config = require('../config/app');
const fields = { free_shipping:'freeShippingAbove', shipping_charge:'shippingCharge', online_discount:'onlinePaymentDiscount', gst_percent:'gstPercent' };
function resolve(settings) {
  const rules = { ...config.business };
  // Preserve the currently deployed environment prices until the first explicit
  // admin save. Old seed values must not silently change what customers pay.
  if (settings.business_rules_source === 'admin') {
    for (const [key,field] of Object.entries(fields)) {
      const value = Number(settings[key]);
      if (settings[key] !== undefined && Number.isFinite(value) && value >= 0 && (!key.includes('discount') || value <= 100)) rules[field] = value;
    }
  }
  return rules;
}
function effective(settings) {
  const rules = resolve(settings), result = { ...settings };
  for (const [key,field] of Object.entries(fields)) result[key] = String(rules[field]);
  return result;
}
async function read(connection) {
  const [rows] = await connection.query("SELECT key_name,value FROM site_settings WHERE key_name IN ('free_shipping','shipping_charge','online_discount','gst_percent','business_rules_source')");
  return resolve(Object.fromEntries(rows.map(r=>[r.key_name,r.value])));
}
module.exports = { fields, resolve, effective, read };
