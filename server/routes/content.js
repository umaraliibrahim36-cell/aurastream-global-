'use strict';
/* Content catalogue + video upload (creators upload, admins moderate). */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { logActivity } = require('./auth');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '2048', 10);
const ALLOWED = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname || '.mp4');
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only video files are allowed'));
  }
});

function row2content(c) {
  return {
    id: c.id, title: c.title, type: c.type, genre: c.genre, year: c.year, rating: c.rating,
    poster: c.poster, videoUrl: c.video_url, description: c.description,
    cast: JSON.parse(c.cast_json || '[]'), status: c.status,
    isFeatured: !!c.is_featured, isTrending: !!c.is_trending, isNew: !!c.is_new,
    isPremium: !!c.is_premium, isAfrican: !!c.is_african, isNigerian: !!c.is_nigerian,
    isInternational: !!c.is_international, views: c.views, likes: c.likes, ownerId: c.owner_id
  };
}

// --- Public catalogue (approved only) ---
router.get('/', (req, res) => {
  const rows = db.prepare("SELECT * FROM contents WHERE status='Approved' ORDER BY created_at DESC").all();
  res.json({ contents: rows.map(row2content) });
});

// --- Single item (increments views) ---
router.get('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE contents SET views=views+1 WHERE id=?').run(c.id);
  res.json({ content: row2content(c) });
});

// --- Creator uploads a video file ---
router.post('/upload', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  if (!u || !u.is_creator) return res.status(403).json({ error: 'Creator access required. Apply for Creator Studio first.' });
  upload.single('video')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file received' });
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'Title is required' });
    const id = 'c_' + crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();
    const videoUrl = '/uploads/' + req.file.filename;
    db.prepare(`INSERT INTO contents
      (id,owner_id,title,type,genre,year,rating,poster,video_url,description,cast_json,status,is_african,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, u.id, String(b.title).trim(), b.type || 'movie', b.genre || 'General',
      parseInt(b.year || new Date().getFullYear(), 10), b.rating || 'PG',
      b.poster || 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&q=80&w=800',
      videoUrl, b.description || '', JSON.stringify((b.cast || '').split(',').map(s => s.trim()).filter(Boolean)),
      'Pending', 1, now);
    logActivity(u, `Uploaded '${b.title}' (pending review)`);
    res.status(201).json({ content: row2content(db.prepare('SELECT * FROM contents WHERE id=?').get(id)) });
  });
});

// --- My uploads ---
router.get('/mine/list', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM contents WHERE owner_id=? ORDER BY created_at DESC').all(req.auth.sub);
  res.json({ contents: rows.map(row2content) });
});

// --- Admin: moderation queue (pending) ---
router.get('/admin/pending', requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM contents WHERE status='Pending' ORDER BY created_at DESC").all();
  res.json({ contents: rows.map(row2content) });
});

// --- Admin: approve / reject ---
router.post('/admin/:id/approve', requireAdmin, (req, res) => {
  db.prepare("UPDATE contents SET status='Approved' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
router.post('/admin/:id/reject', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contents WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Admin: toggle flags / delete ---
router.patch('/admin/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM contents WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const map = { isFeatured: 'is_featured', isTrending: 'is_trending', isPremium: 'is_premium', status: 'status' };
  for (const k of Object.keys(map)) {
    if (b[k] !== undefined) {
      const col = map[k];
      const val = k === 'status' ? b[k] : (b[k] ? 1 : 0);
      db.prepare(`UPDATE contents SET ${col}=? WHERE id=?`).run(val, c.id);
    }
  }
  res.json({ content: row2content(db.prepare('SELECT * FROM contents WHERE id=?').get(c.id)) });
});
router.delete('/admin/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contents WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
