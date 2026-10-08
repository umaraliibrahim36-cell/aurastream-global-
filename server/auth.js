'use strict';
/* Authentication helpers: JWT signing/verification + role guards. */
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

const ADMIN_ROLES = ['Super Admin', 'Content Admin', 'Moderation Admin', 'Finance Admin', 'Support Admin'];

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function readToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.cookies && req.cookies.as_token) return req.cookies.as_token;
  return null;
}

// Attaches req.user when a valid token is present; never rejects.
function attachUser(req, _res, next) {
  const t = readToken(req);
  if (t) {
    try { req.auth = jwt.verify(t, JWT_SECRET); } catch (_) { req.auth = null; }
  }
  next();
}

// Requires a logged-in user.
function requireAuth(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  next();
}

// Requires an admin role (any of ADMIN_ROLES).
function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' });
  if (!ADMIN_ROLES.includes(req.auth.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { signToken, attachUser, requireAuth, requireAdmin, ADMIN_ROLES, JWT_SECRET };
