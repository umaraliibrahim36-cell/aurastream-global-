'use strict';
/* Account creation, login, logout, profile. */
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { signToken, requireAuth } = require('../auth');

const router = express.Router();

// Brute-force protection on auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

const DEFAULT_SETTINGS = {
  language: 'English', region: 'Nigeria', maturity: '18+', videoQuality: 'Auto (Up to 4K)',
  autoplayNext: true, autoplayPreviews: true, dataSaver: false, downloadsWifiOnly: true,
  theme: 'Dark', notifEmail: true, notifPush: true, notifNewContent: true, notifBilling: true,
  profilePublic: false, shareWatchActivity: false
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, isCreator: !!u.is_creator,
    avatar: u.avatar, country: u.country, currency: u.currency, phone: u.phone, bio: u.bio,
    status: u.status,
    subscription: { planId: u.plan_id, name: u.plan_name, status: u.plan_status, expires: u.plan_expires },
    settings: JSON.parse(u.settings_json || '{}')
  };
}

function setAuthCookie(res, token) {
  res.cookie('as_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// --- Register ---
router.post('/register', authLimiter, (req, res) => {
  const { name, email, password, country, currency } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (!emailRe.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'An account with that email already exists' });

  const id = 'usr_' + crypto.randomBytes(6).toString('hex');
  const hash = bcrypt.hashSync(String(password), 10);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users
    (id,name,email,password_hash,role,is_creator,avatar,country,currency,status,plan_id,plan_name,plan_status,plan_expires,settings_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, String(name).trim(), email.toLowerCase(), hash, 'User', 0,
    'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name),
    country || 'Nigeria', currency || 'NGN', 'Active',
    'sub_free', 'Free Tier', 'Active', null, JSON.stringify(DEFAULT_SETTINGS), now);

  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  const token = signToken(u);
  setAuthCookie(res, token);
  logActivity(u, 'Created account');
  res.status(201).json({ token, user: publicUser(u) });
});

// --- Login ---
router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase());
  if (!u || !bcrypt.compareSync(String(password), u.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (u.status === 'Suspended') return res.status(403).json({ error: 'This account is suspended' });
  const token = signToken(u);
  setAuthCookie(res, token);
  logActivity(u, 'Signed in');
  res.json({ token, user: publicUser(u) });
});

// --- Logout ---
router.post('/logout', (req, res) => {
  res.clearCookie('as_token');
  res.json({ ok: true });
});

// --- Current user ---
router.get('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(u) });
});

// --- Update profile / settings ---
router.patch('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const { name, phone, bio, country, currency, avatar, settings } = req.body || {};
  db.prepare(`UPDATE users SET name=?, phone=?, bio=?, country=?, currency=?, avatar=?, settings_json=? WHERE id=?`).run(
    name ?? u.name, phone ?? u.phone, bio ?? u.bio, country ?? u.country,
    currency ?? u.currency, avatar ?? u.avatar,
    settings ? JSON.stringify(settings) : u.settings_json, u.id);
  const nu = db.prepare('SELECT * FROM users WHERE id=?').get(u.id);
  logActivity(nu, 'Updated profile');
  res.json({ user: publicUser(nu) });
});

// --- Change password ---
router.post('/change-password', requireAuth, authLimiter, (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  if (!u || !bcrypt.compareSync(String(current || ''), u.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(next), 10), u.id);
  logActivity(u, 'Changed password');
  res.json({ ok: true });
});

// --- Apply to become a creator ---
router.post('/apply-creator', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET is_creator=1 WHERE id=?').run(req.auth.sub);
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
  logActivity(u, 'Applied for Creator Studio');
  res.json({ user: publicUser(u) });
});

function logActivity(u, action) {
  try {
    db.prepare('INSERT INTO activity_logs (id,user_id,user_name,email,action,timestamp) VALUES (?,?,?,?,?,?)')
      .run('act_' + crypto.randomBytes(5).toString('hex'), u.id, u.name, u.email, action,
        new Date().toISOString().slice(0, 16).replace('T', ' '));
  } catch (_) {}
}

module.exports = router;
module.exports.publicUser = publicUser;
module.exports.logActivity = logActivity;
