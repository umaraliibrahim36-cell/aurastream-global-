'use strict';
/* AuraStream main server: website + REST API + live streaming. */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { seed } = require('./db');
const { attachUser } = require('./auth');

// Build schema + seed base data on boot.
seed();

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const MEDIA_HTTP_PORT = parseInt(process.env.MEDIA_HTTP_PORT || '8000', 10);

// --- Security headers. CSP is relaxed to allow the Tailwind/FontAwesome CDNs
//     the existing front-end uses, plus the Paystack inline script. ---
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com', 'https://js.paystack.co', 'https://cdnjs.cloudflare.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      'img-src': ["'self'", 'data:', 'https:'],
      'media-src': ["'self'", 'https:', 'http:', 'blob:'],
      'connect-src': ["'self'", 'https://api.paystack.co', 'ws:', 'wss:'],
      'frame-src': ["'self'", 'https://checkout.paystack.com']
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// --- Paystack webhook needs the RAW body for signature verification; mount it
//     BEFORE the JSON body parser. ---
const { webhookHandler } = require('./routes/payments');
app.post('/api/payments/webhook', express.raw({ type: '*/*' }), webhookHandler);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);

// Light global API rate limit.
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));

// --- API routes ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// --- Serve uploaded videos ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '1h' }));

// --- Proxy HLS live playback (/live/*) to the media server ---
app.use('/live', (req, res) => {
  const options = {
    hostname: '127.0.0.1', port: MEDIA_HTTP_PORT,
    path: '/live' + req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1' }
  };
  const proxy = http.request(options, (pr) => {
    res.writeHead(pr.statusCode || 502, pr.headers);
    pr.pipe(res);
  });
  proxy.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'Live stream unavailable' }); });
  req.pipe(proxy);
});

// --- Static website ---
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Boot ---
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`AuraStream running on http://localhost:${PORT}`);
  if (!process.env.PAYSTACK_SECRET_KEY) console.warn('WARNING: PAYSTACK_SECRET_KEY not set — payments are disabled until configured.');
});

// --- Browser-native live streaming relay (camera -> WebSocket -> viewers).
//     This is the default "Go Live" path and needs no OBS/ffmpeg. ---
try {
  require('./live-ws').attach(server);
} catch (e) {
  console.warn('Browser live relay disabled:', e.message);
}

// --- Start live streaming server (best-effort; needs ffmpeg) ---
try {
  const { startMediaServer } = require('./media-server');
  startMediaServer();
} catch (e) {
  console.warn('Live streaming disabled:', e.message);
}

module.exports = server;
