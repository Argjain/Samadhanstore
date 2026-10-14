// models/Settings.js — Admin se sab kuch control
const db = require('../config/db');
const businessRules = require('../services/businessRules');

let cache = {}; // Memory cache for performance

const Settings = {

  // Sab settings load karo (cached)
  async getAll() {
    const [rows] = await db.query('SELECT key_name, value, label, type, group_name FROM site_settings ORDER BY group_name, id');
    const settings = {};
    rows.forEach(r => settings[r.key_name] = r.value);
    cache = businessRules.effective(settings);
    return cache;
  },

  // Group wise settings (admin panel ke liye)
  async getGrouped() {
    const [rows] = await db.query('SELECT * FROM site_settings ORDER BY group_name, id');
    const effective = businessRules.effective(Object.fromEntries(rows.map(r=>[r.key_name,r.value])));
    const grouped = {};
    rows.forEach(r => {
      if (r.key_name === 'business_rules_source') return;
      if (businessRules.fields[r.key_name]) r.value = effective[r.key_name];
      if (!grouped[r.group_name]) grouped[r.group_name] = [];
      grouped[r.group_name].push(r);
    });
    return grouped;
  },

  // Single setting
  async get(key) {
    if (cache[key] !== undefined) return cache[key];
    const [rows] = await db.query('SELECT value FROM site_settings WHERE key_name = ?', [key]);
    return rows[0]?.value || null;
  },

  // Update single setting
  async set(key, value) {
    await db.query('UPDATE site_settings SET value = ? WHERE key_name = ?', [value, key]);
    cache[key] = value;
  },

  // Bulk update (admin form submit)
  async bulkUpdate(data) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT key_name,type,value FROM site_settings FOR UPDATE');
      const current = businessRules.effective(Object.fromEntries(rows.map(r=>[r.key_name,r.value])));
      const changingRules = Object.keys(businessRules.fields).some(key=>Object.hasOwn(data,key));
      if (changingRules) {
        // Store all four effective values, including ones omitted in a partial edit.
        for (const key of Object.keys(businessRules.fields)) {
          const value = Object.hasOwn(data,key) ? data[key] : current[key];
          if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value)) || Number(value)<0 || ((key==='online_discount'||key==='gst_percent') && Number(value)>100)) throw new Error('Please enter valid shipping, discount and tax amounts.');
          await conn.query('INSERT INTO site_settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=VALUES(value)',[key,value]);
        }
        await conn.query("INSERT INTO site_settings (key_name,value) VALUES ('business_rules_source','admin') ON DUPLICATE KEY UPDATE value='admin'");
      }
      for (const row of rows) {
        if (businessRules.fields[row.key_name] || row.key_name==='business_rules_source') continue;
        const value = row.type === 'boolean' ? (data[row.key_name]==='1'?'1':'0') : data[row.key_name];
        if (value === undefined) continue;
        if (typeof value !== 'string') throw new Error('Please check the settings form.');
        await conn.query('UPDATE site_settings SET value=? WHERE key_name=?',[value,row.key_name]);
      }
      await conn.commit(); cache = {};
    } catch(e) {await conn.rollback();throw e;}
    finally {conn.release();}
  },

  // Cache refresh
  async refresh() {
    cache = {};
    return this.getAll();
  },
};

module.exports = Settings;
