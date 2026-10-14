// routes/blog.js — Public blog pages
const express = require('express');
const router = require('../middlewares/asyncRouter')();
const Blog = require('../models/Blog');

// Blog listing page
router.get('/', async (req, res) => {
  const posts = await Blog.getAll(true);
  res.render('pages/blog', {
    pageTitle: 'Blog – Samadhan | Crystal & Spiritual Knowledge',
    pageDesc: 'Learn about crystals, spiritual bracelets, astrology and healing stones.',
    posts,
  });
});

// Single blog post
router.get('/:slug', async (req, res, next) => {
  const post = await Blog.getBySlug(req.params.slug);
  if (!post) return res.redirect('/blog');
  const recent = await Blog.getRecent(3);
  res.render('pages/blog-post', {
    pageTitle: post.title + ' – Samadhan Blog',
    pageDesc: post.excerpt || '',
    post,
    recentPosts: recent.filter(p => p.id !== post.id),
  });
});

module.exports = router;
