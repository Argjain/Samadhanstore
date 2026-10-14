const db = require('../config/db');
function normalize(data) {
  const text = (key, max, fallback = '') => {
    if (data[key] !== undefined && typeof data[key] !== 'string') throw new Error('Invalid category ' + key + '.');
    const value = (data[key] || fallback).trim();
    if ([...value].length > max) throw new Error('Category ' + key + ' is too long (maximum ' + max + ' characters).');
    return value;
  };
  const name = text('name',100);
  if (!name) throw new Error('Please enter a category name.');
  const sort = data.sort_order === '' || data.sort_order === undefined ? 0 : Number(data.sort_order);
  if (!Number.isInteger(sort) || sort < 0 || sort > 2147483647) throw new Error('Sort order must be a non-negative whole number.');
  return { name, icon:text('icon',10,'💎'), description:text('description',5000), sort_order:sort,
    is_active: data.is_active === true || data.is_active === 'on' || data.is_active === '1' };
}
const Category = {
  async getAll(activeOnly=true){
    const where=activeOnly?'WHERE is_active=1':'';
    const [rows]=await db.query(`SELECT * FROM categories ${where} ORDER BY sort_order ASC`);
    return rows;
  },
  async getBySlug(slug){const [r]=await db.query('SELECT * FROM categories WHERE slug=?',[slug]);return r[0]||null;},
  async getById(id){const [r]=await db.query('SELECT * FROM categories WHERE id=?',[id]);return r[0]||null;},
  async create(data){
    data = normalize(data);
    const slug=data.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'category-' + require('crypto').randomBytes(6).toString('hex');
    const [r]=await db.query('INSERT INTO categories (name,slug,icon,description,sort_order,is_active) VALUES (?,?,?,?,?,?)',[data.name,slug,data.icon,data.description||null,data.sort_order,data.is_active?1:0]);
    return r.insertId;
  },
  async update(id,data){
    data = normalize(data);
    // Keep the category URL stable when changing its display name.
    const [r] = await db.query('UPDATE categories SET name=?,icon=?,description=?,sort_order=?,is_active=? WHERE id=?',[data.name,data.icon,data.description||null,data.sort_order,data.is_active?1:0,id]);
    if (!r.affectedRows) throw new Error('Category no longer exists. Please reload the page.');
  },
  async delete(id){await db.query('DELETE FROM categories WHERE id=?',[id]);},
};
module.exports=Category;
