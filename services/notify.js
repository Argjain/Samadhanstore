// services/notify.js — Email + SMS notifications
const nodemailer = require('nodemailer');
const https      = require('https');
const config     = require('../config/app');
const {trackingUrl} = require('./orderAccess');
const escapeHTML = value => require('ejs').escapeXML(String(value ?? ''));

// ── EMAIL ──────────────────────────────────────────
const transporter = nodemailer.createTransport({
  connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
  host: config.mail.host,
  port: config.mail.port,
  secure: config.mail.port === 465,
  auth: { user: config.mail.user, pass: config.mail.pass },
});

function orderEmailHTML(order, type = 'confirm') {
  const sym = config.business.currencySymbol;
  const itemsHTML = order.items.map(i =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHTML(i.name)}</td>
     <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td>
     <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${sym}${Number(i.line_total ?? (i.unit_price ?? i.price)*i.qty).toLocaleString('en-IN')}</td></tr>`
  ).join('');

  const subject = type === 'confirm'
    ? `Order Confirmed – ${order.order_id} | Samadhan`
    : `Order Shipped – ${order.order_id} | Samadhan`;

  const bodyMsg = type === 'confirm'
    ? `<p>Your order has been placed successfully! We will process it shortly.</p>`
    : `<p>Your order has been shipped! Tracking ID: <strong>${escapeHTML(order.tracking_id || 'N/A')}</strong></p>`;

  return {
    subject,
    html: `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f0c1a;color:#e8e4f0;">
      <div style="background:#2d1b69;padding:30px;text-align:center;">
        <h1 style="color:#e8e4f0;margin:0;letter-spacing:4px;">SAMADHAN</h1>
        <p style="color:#8b7fd4;margin:8px 0 0;letter-spacing:2px;font-size:12px;">WEAR THE UNIVERSE</p>
      </div>
      <div style="padding:30px;">
        <h2 style="color:#8b7fd4;">🎉 ${type === 'confirm' ? 'Order Confirmed!' : 'Order Shipped!'}</h2>
        <p style="color:#b8b0d0;">Namaste ${escapeHTML(order.name)},</p>
        ${bodyMsg}
        <div style="background:#1a1040;border-radius:8px;padding:20px;margin:20px 0;">
          <p style="color:#8b7fd4;margin:0 0 8px;font-size:12px;letter-spacing:2px;">ORDER ID</p>
          <p style="color:#e8e4f0;font-size:1.2rem;font-weight:bold;margin:0;">${escapeHTML(order.order_id)}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <thead><tr style="background:#1a1040;">
            <th style="padding:10px;text-align:left;color:#8b7fd4;font-size:12px;">Product</th>
            <th style="padding:10px;text-align:center;color:#8b7fd4;font-size:12px;">Qty</th>
            <th style="padding:10px;text-align:right;color:#8b7fd4;font-size:12px;">Total</th>
          </tr></thead>
          <tbody style="color:#e8e4f0;">${itemsHTML}</tbody>
        </table>
        <div style="text-align:right;padding:10px 0;">
          <strong style="color:#8b7fd4;">Total: ${sym}${Number(order.total).toLocaleString('en-IN')}</strong>
        </div>
        <div style="background:#1a1040;border-radius:8px;padding:16px;margin:16px 0;">
          <p style="color:#8b7fd4;margin:0 0 8px;font-size:12px;">DELIVERY ADDRESS</p>
          <p style="color:#e8e4f0;margin:0;">${escapeHTML(order.address)}, ${escapeHTML(order.city)}, ${escapeHTML(order.state)} - ${escapeHTML(order.pincode)}</p>
        </div>
        <p><a href="${config.site.url}${trackingUrl(order)}">Track your order securely</a></p>
        <p style="color:#8b7fd4;font-size:13px;">Questions? Contact us at ${config.site.email} or WhatsApp: ${config.site.phone}</p>
      </div>
      <div style="background:#1a1040;padding:20px;text-align:center;">
        <p style="color:#8b7fd4;margin:0;font-size:12px;">© 2026 Samadhan | Wear The Universe</p>
      </div>
    </div>`
  };
}

const Email = {
  async sendOrderConfirm(order) {
    if (!config.mail.user || !config.mail.pass) return false;
    try {
      const { subject, html } = orderEmailHTML(order, 'confirm');
      await transporter.sendMail({ from: config.mail.from, to: order.email, subject, html });
      return true;
    } catch(e) { console.error('Order email delivery failed:',e.code || 'provider error'); return false; }
  },

  async sendOrderShipped(order) {
    if (!config.mail.user) return;
    try {
      const { subject, html } = orderEmailHTML(order, 'shipped');
      await transporter.sendMail({ from: config.mail.from, to: order.email, subject, html });
    } catch(e) { console.error('Email error:', e.message); }
  },

  async sendContactForm(data) {
    if (!config.mail.user) return;
    try {
      await transporter.sendMail({
        from: config.mail.from,
        to: config.site.email,
        subject: `Contact Form: ${data.subject || 'Query'} – ${data.name}`,
        html: `<p><b>Name:</b> ${escapeHTML(data.name)}</p><p><b>Email:</b> ${escapeHTML(data.email)}</p><p><b>Phone:</b> ${escapeHTML(data.phone||'N/A')}</p><p><b>Message:</b><br>${escapeHTML(data.message)}</p>`,
      });
    } catch(e) { console.error('Email error:', e.message); }
  },
};

// ── SMS (Fast2SMS) ─────────────────────────────────
const SMS = {
  async send(phone, message) {
    if (!config.sms.key) return false;
    // Clean phone number
    let cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) cleanPhone = cleanPhone.slice(2);
    if (cleanPhone.length !== 10) return false;

    const payload = JSON.stringify({
      route: 'q', // Quick SMS
      message,
      language: 'english',
      flash: 0,
      numbers: cleanPhone,
    });

    return new Promise((resolve) => {
      const req = https.request({
        method: 'POST',
        hostname: 'www.fast2sms.com',
        path: '/dev/bulkV2',
        headers: {
          authorization: config.sms.key,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          let accepted=false; try {accepted=res.statusCode===200 && JSON.parse(data).return===true;} catch {}
          if(!accepted) console.error('SMS provider did not accept the notification');
          resolve(accepted);
        });
      });
      req.setTimeout(10000,()=>req.destroy(new Error('SMS timeout')));
      req.on('error', e => { console.error('SMS error:', e.message); resolve(false); });
      req.write(payload);
      req.end();
    });
  },

  async sendOrderConfirm(order) {
    const msg = `Dear ${order.name}, your Samadhan order #${order.order_id} is confirmed! Total: Rs.${order.total}. Track at ${config.site.url}${trackingUrl(order)}`;
    return this.send(order.phone, msg);
  },

  async sendOrderShipped(order) {
    const msg = `Your Samadhan order #${order.order_id} has been shipped! Tracking ID: ${order.tracking_id || 'N/A'}. Expected delivery in 3-5 days.`;
    await this.send(order.phone, msg);
  },
};

module.exports = { Email, SMS };
