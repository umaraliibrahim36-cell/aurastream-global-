'use strict';
/* Paystack payments: initialize a transaction, verify it, and handle webhooks.
 * Docs: https://paystack.com/docs/api/transaction/
 *
 * Flow used by the website (inline popup):
 *  1. Browser gets PAYSTACK_PUBLIC_KEY from /api/payments/config.
 *  2. Browser opens Paystack inline checkout with the plan amount.
 *  3. On success Paystack returns a `reference`; browser calls /verify.
 *  4. Server calls Paystack verify API with the SECRET key, and on success
 *     activates the subscription + writes an invoice.
 *  5. A webhook (/webhook) provides a server-to-server backup confirmation.
 */
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { logActivity } = require('./auth');

const router = express.Router();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY || '';
const PS = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  timeout: 20000
});

function planDays(duration) {
  if (/forever/i.test(duration || '')) return null;
  const m = (duration || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 30;
}

function activateSubscription(user, plan, amountNaira, method, reference) {
  const days = planDays(plan.duration);
  const expires = days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null;
  db.prepare('UPDATE users SET plan_id=?, plan_name=?, plan_status=?, plan_expires=? WHERE id=?')
    .run(plan.id, plan.name, 'Active', expires, user.id);
  if (amountNaira > 0) {
    const invId = 'INV-' + Date.now().toString().slice(-8);
    db.prepare('INSERT INTO invoices (id,user_id,plan,amount,method,status,reference,date) VALUES (?,?,?,?,?,?,?,?)')
      .run(invId, user.id, plan.name, amountNaira, method || 'Paystack', 'Paid', reference || null,
        new Date().toISOString().slice(0, 10));
  }
  db.prepare('INSERT INTO notifications (id,user_id,title,message,date,read) VALUES (?,?,?,?,?,0)')
    .run('n_' + crypto.randomBytes(4).toString('hex'), user.id, 'Subscription Active',
      `You're now on ${plan.name}.`, 'Just now');
  logActivity(user, `Subscribed to ${plan.name}${amountNaira ? ` (₦${amountNaira} via ${method || 'Paystack'})` : ''}`);
}

// --- Expose the PUBLIC key to the browser ---
router.get('/config', (_req, res) => {
  res.json({ publicKey: PAYSTACK_PUBLIC, enabled: !!(PAYSTACK_SECRET && PAYSTACK_PUBLIC) });
});

// --- Plans + promo list ---
router.get('/plans', (_req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY price ASC').all();
  res.json({ plans });
});

// --- Initialize a transaction (returns authorization_url + reference) ---
router.post('/initialize', requireAuth, async (req, res) => {
  const { planId, promo } = req.body || {};
  const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);

  // Free plan: switch immediately, no payment (no Paystack key needed).
  if (plan.price === 0) {
    activateSubscription(user, plan, 0, '-', null);
    return res.json({ free: true });
  }

  if (!PAYSTACK_SECRET) return res.status(503).json({ error: 'Payments are not configured. Set PAYSTACK_SECRET_KEY.' });

  let amount = plan.price;
  if (promo) {
    const pr = db.prepare('SELECT * FROM promo_codes WHERE code=?').get(String(promo).toUpperCase());
    if (pr) amount = Math.round(amount * (100 - pr.pct) / 100);
  }

  try {
    const { data } = await PS.post('/transaction/initialize', {
      email: user.email,
      amount: amount * 100, // Paystack expects the smallest unit (kobo)
      currency: 'NGN',
      callback_url: (process.env.PUBLIC_URL || '') + '/?pay=callback',
      metadata: { userId: user.id, planId: plan.id, planName: plan.name, amountNaira: amount }
    });
    res.json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
      publicKey: PAYSTACK_PUBLIC,
      email: user.email,
      amount: amount * 100
    });
  } catch (e) {
    res.status(502).json({ error: 'Paystack initialization failed', detail: e.response?.data?.message || e.message });
  }
});

// --- Verify a transaction after the inline popup / redirect ---
router.post('/verify', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(503).json({ error: 'Payments are not configured.' });
  const { reference } = req.body || {};
  if (!reference) return res.status(400).json({ error: 'reference is required' });
  try {
    const { data } = await PS.get('/transaction/verify/' + encodeURIComponent(reference));
    const tx = data.data;
    if (tx.status !== 'success') return res.status(400).json({ error: 'Payment not successful', status: tx.status });
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.auth.sub);
    const planId = tx.metadata?.planId;
    const plan = db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
    if (!plan) return res.status(400).json({ error: 'Unknown plan in transaction' });
    // Guard against double-processing the same reference.
    const dup = db.prepare('SELECT id FROM invoices WHERE reference=?').get(reference);
    if (!dup) activateSubscription(user, plan, Math.round(tx.amount / 100), tx.channel || 'Paystack', reference);
    res.json({ ok: true, plan: plan.name });
  } catch (e) {
    res.status(502).json({ error: 'Verification failed', detail: e.response?.data?.message || e.message });
  }
});

// --- Webhook (server-to-server). Mounted with raw body in index.js ---
function webhookHandler(req, res) {
  if (!PAYSTACK_SECRET) return res.sendStatus(503);
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');
  if (hash !== signature) return res.sendStatus(401);
  let event;
  try { event = JSON.parse(req.body.toString('utf8')); } catch (_) { return res.sendStatus(400); }
  if (event.event === 'charge.success') {
    const tx = event.data;
    const userId = tx.metadata?.userId;
    const planId = tx.metadata?.planId;
    const user = userId && db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    const plan = planId && db.prepare('SELECT * FROM plans WHERE id=?').get(planId);
    if (user && plan) {
      const dup = db.prepare('SELECT id FROM invoices WHERE reference=?').get(tx.reference);
      if (!dup) activateSubscription(user, plan, Math.round(tx.amount / 100), tx.channel || 'Paystack', tx.reference);
    }
  }
  res.sendStatus(200);
}

// --- Billing history ---
router.get('/invoices', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM invoices WHERE user_id=? ORDER BY date DESC').all(req.auth.sub);
  res.json({ invoices: rows });
});

module.exports = router;
module.exports.webhookHandler = webhookHandler;
