'use strict';
/* Channels: users create channels and go live. Live playback is HLS served
   by node-media-server; OBS pushes RTMP to rtmp://host:RTMP_PORT/live/<stream_key>. */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { logActivity } = require('./auth');

const router = express.Router();

function row2channel(c, includeKey) {
  const base = {
    id: c.id, ownerId: c.owner_id, name: c.name, logo: c.logo, category: c.category,
    description: c.description, isLive: !!c.is_live, current: c.current, next: c.next,
    viewers: c.viewers,
    hlsUrl: `/live/${c.stream_key}/index.m3u8`
  };
  if (includeKey) {
    base.streamKey = c.stream_key;
    base.rtmpUrl = (process.env.RTMP_PUBLIC_URL || `rtmp://localhost:${process.env.RTMP_PORT || 1935}/live`);
  }
  return base;
}

// --- List all channels (public) ---
router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all();
  res.json({ channels: rows.map(c => row2channel(c, false)) });
});

// --- My channels (with stream key + RTMP ingest URL) ---
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM channels WHERE owner_id=? ORDER BY created_at DESC').all(req.auth.sub);
  res.json({ channels: rows.map(c => row2channel(c, true)) });
});

// --- Create a channel (any logged-in user) ---
router.post('/', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Channel name is required' });
  const id = 'ch_' + crypto.randomBytes(5).toString('hex');
  const streamKey = crypto.randomBytes(10).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO channels (id,owner_id,name,logo,category,description,stream_key,is_live,current,next,viewers,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, u.id, String(b.name).trim(), b.logo || '📺', b.category || 'Entertainment',
    b.description || '', streamKey, 0, b.current || '', b.next || '', '0 watching', now);
  logActivity(u, `Created channel '${b.name}'`);
  res.status(201).json({ channel: row2channel(db.prepare('SELECT * FROM channels WHERE id=?').get(id), true) });
});

// --- Get my channel's stream credentials ---
router.get('/:id/key', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.owner_id !== req.auth.sub) return res.status(403).json({ error: 'Not your channel' });
  res.json({ channel: row2channel(c, true) });
});

// --- Mark channel live / offline (owner) ---
router.post('/:id/live', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.owner_id !== req.auth.sub) return res.status(403).json({ error: 'Not your channel' });
  const live = req.body && req.body.live ? 1 : 0;
  db.prepare('UPDATE channels SET is_live=?, current=? WHERE id=?').run(live, (req.body && req.body.current) || c.current, c.id);
  res.json({ channel: row2channel(db.prepare('SELECT * FROM channels WHERE id=?').get(c.id), true) });
});

// --- Update / delete (owner or admin) ---
router.patch('/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  const isAdmin = ['Super Admin', 'Content Admin', 'Moderation Admin'].includes(u.role);
  if (c.owner_id !== req.auth.sub && !isAdmin) return res.status(403).json({ error: 'Not allowed' });
  const b = req.body || {};
  db.prepare('UPDATE channels SET name=?, logo=?, category=?, description=?, current=?, next=? WHERE id=?').run(
    b.name ?? c.name, b.logo ?? c.logo, b.category ?? c.category, b.description ?? c.description,
    b.current ?? c.current, b.next ?? c.next, c.id);
  res.json({ channel: row2channel(db.prepare('SELECT * FROM channels WHERE id=?').get(c.id), c.owner_id === req.auth.sub) });
});
router.delete('/:id', requireAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM channels WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  const isAdmin = ['Super Admin', 'Content Admin', 'Moderation Admin'].includes(u.role);
  if (c.owner_id !== req.auth.sub && !isAdmin) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM channels WHERE id=?').run(c.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.row2channel = row2channel;
