// models/Blog.js — Blog posts CRUD
const db = require('../config/db');
const {cleanBlog} = require('../services/contentSafety');

const Blog = {
  async getAll(onlyPublished = true) {
    const where = onlyPublished ? 'WHERE is_published = 1' : '';
    const [rows] = await db.query(
      `SELECT * FROM blogs ${where} ORDER BY created_at DESC`
    );
    return rows;
  },

  async getBySlug(slug) {
    const [rows] = await db.query('SELECT * FROM blogs WHERE slug = ? AND is_published = 1', [slug]);
    return rows[0] ? {...rows[0], content:cleanBlog(rows[0].content)} : null;
  },

  async getById(id) {
    const [rows] = await db.query('SELECT * FROM blogs WHERE id = ?', [id]);
    return rows[0] ? {...rows[0], content:cleanBlog(rows[0].content)} : null;
  },

  async getRecent(limit = 3) {
    const [rows] = await db.query(
      'SELECT id, title, slug, image, excerpt, created_at FROM blogs WHERE is_published = 1 ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rows;
  },

  async create(data) {
    const slug = (data.slug || data.title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const excerpt = data.excerpt || (cleanBlog(data.content)).substring(0, 160).replace(/<[^>]+>/g, '');
    const [result] = await db.query(
      `INSERT INTO blogs (title, slug, content, excerpt, image, tags, author, is_published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.title, slug, cleanBlog(data.content), excerpt, data.image || null,
       data.tags || null, data.author || 'Samadhan', data.is_published ? 1 : 0]
    );
    return result.insertId;
  },

  async update(id, data) {
    const slug = (data.slug || data.title)
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const excerpt = data.excerpt || (cleanBlog(data.content)).substring(0, 160).replace(/<[^>]+>/g, '');
    if (data.image) {
      await db.query(
        `UPDATE blogs SET title=?, slug=?, content=?, excerpt=?, image=?, tags=?, author=?, is_published=? WHERE id=?`,
        [data.title, slug, cleanBlog(data.content), excerpt, data.image,
         data.tags || null, data.author || 'Samadhan', data.is_published ? 1 : 0, id]
      );
    } else {
      await db.query(
        `UPDATE blogs SET title=?, slug=?, content=?, excerpt=?, tags=?, author=?, is_published=? WHERE id=?`,
        [data.title, slug, cleanBlog(data.content), excerpt,
         data.tags || null, data.author || 'Samadhan', data.is_published ? 1 : 0, id]
      );
    }
  },

  async delete(id) {
    await db.query('DELETE FROM blogs WHERE id = ?', [id]);
  },
};

module.exports = Blog;
