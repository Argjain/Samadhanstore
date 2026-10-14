const sanitizeHtml = require('sanitize-html');

function safeLink(value, fallback = '') {
  if (typeof value !== 'string' || /[\x00-\x20\\]/.test(value)) return fallback;
  if (/^\/(?!\/)/.test(value)) return value;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback; }
  catch { return fallback; }
}
function cleanBlog(value) {
  return sanitizeHtml(typeof value === 'string' ? value.slice(0, 200000) : '', {
    allowedTags: ['p','br','h2','h3','h4','strong','b','em','i','u','s','ul','ol','li','blockquote','a','img','hr','table','thead','tbody','tr','th','td','pre','code'],
    allowedAttributes: { a: ['href','title','rel'], img: ['src','alt','width','height','loading'], th: ['scope'], td: ['colspan','rowspan'] },
    allowedSchemes: ['https','http','mailto'],
    allowedSchemesByTag: { img: ['https','http'] }, allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform('a', {rel:'noopener noreferrer'}), img: sanitizeHtml.simpleTransform('img', {loading:'lazy'}) }
  });
}
function stars(value) { return Math.max(0, Math.min(5, Math.round(Number(value) || 0))); }
function whatsapp(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = '91' + digits;
  return /^\d{11,15}$/.test(digits) ? 'https://wa.me/' + digits : '';
}
module.exports = { safeLink, cleanBlog, stars, whatsapp };
