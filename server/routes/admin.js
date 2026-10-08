'use strict';
/* Admin + user management endpoints. */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAuth, requireAdmin, ADMIN_ROLES } = require('../auth');
const { publicUser, logActivity } = require('./auth');

const router = express.Router();

// --- Platform stats ---
router.get('/stats', requireAdmin, (_req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const creators = db.prepare('SELECT COUNT(*) c FROM users WHERE is_creator=1').get().c;
  const contents = db.prepare('SELECT COUNT(*) c FROM contents').get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM contents WHERE status='Pending'").get().c;
  const channels = db.prepare('SELECT COUNT(*) c FROM channels').get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='Paid'").get().s;
  res.json({ users, creators, contents, pending, channels, revenue });
});

// --- Users list / manage ---
router.get('/users', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT id,name,email,role,country,plan_name,status,created_at,is_creator FROM users ORDER BY created_at DESC').all();
  res.json({ users: rows });
});
router.patch('/users/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  if (b.role && !([...ADMIN_ROLES, 'Creator', 'User'].includes(b.role))) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role=?, status=?, is_creator=? WHERE id=?').run(
    b.role ?? u.role, b.status ?? u.status,
    b.isCreator !== undefined ? (b.isCreator ? 1 : 0) : u.is_creator, u.id);
  const actor = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  logActivity(actor, `Updated user ${u.name}`);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
});
router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.auth.sub) return res.status(400).json({ error: 'You cannot delete your own account here' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Plans CRUD ---
router.post('/plans', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Plan name required' });
  const id = b.id || 'sub_' + crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT OR REPLACE INTO plans (id,name,price,duration,benefits) VALUES (?,?,?,?,?)')
    .run(id, b.name, parseInt(b.price || 0, 10), b.duration || '30 Days', b.benefits || '');
  res.json({ ok: true, id });
});
router.delete('/plans/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Promo codes ---
router.get('/promos', requireAdmin, (_req, res) => res.json({ promos: db.prepare('SELECT * FROM promo_codes').all() }));
router.post('/promos', requireAdmin, (req, res) => {
  const { code, pct } = req.body || {};
  if (!code || !pct) return res.status(400).json({ error: 'code and pct required' });
  db.prepare('INSERT OR REPLACE INTO promo_codes (code,pct) VALUES (?,?)').run(String(code).toUpperCase(), parseInt(pct, 10));
  res.json({ ok: true });
});
router.delete('/promos/:code', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM promo_codes WHERE code=?').run(String(req.params.code).toUpperCase());
  res.json({ ok: true });
});

// --- Activity log ---
router.get('/activity', requireAdmin, (_req, res) => {
  res.json({ logs: db.prepare('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 300').all() });
});

// --- Notifications for the current user ---
router.get('/notifications', requireAuth, (req, res) => {
  res.json({ notifications: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY rowid DESC LIMIT 50').all(req.auth.sub) });
});
router.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE user_id=?').run(req.auth.sub);
  res.json({ ok: true });
});

module.exports = router;
