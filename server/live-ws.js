'use strict';
/*
 * Browser-native live streaming relay (no OBS / RTMP / ffmpeg required).
 *
 * How it works:
 *   - A creator opens their camera in the browser. MediaRecorder produces a
 *     continuous WebM stream in small timeslices (chunks).
 *   - Those chunks are sent over a WebSocket to this relay.
 *   - The relay forwards every chunk to all connected viewers of that channel.
 *   - Viewers rebuild the stream with Media Source Extensions (MSE) and play it
 *     in a normal <video> element.
 *   - The very first chunk from MediaRecorder carries the WebM header/init data,
 *     so we cache it and replay it to anyone who joins mid-broadcast.
 *
 * This works in Chrome, Edge, modern Android WebView and most mobile browsers.
 * It is a genuine live broadcast: what the creator's camera sees, viewers see
 * a couple of seconds later.
 *
 * Protocol (all control messages are JSON text frames; media is binary):
 *   broadcaster -> server : {t:'start', mime:'video/webm;codecs="vp8,opus"'}
 *   broadcaster -> server : <binary chunk> ...
 *   server -> viewer      : {t:'start', mime} then the cached header, then chunks
 *   server -> viewer      : {t:'offline'} when no broadcast is running
 *   server -> both        : {t:'viewers', count:N}
 */
const { WebSocketServer } = require('ws');
const url = require('url');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { JWT_SECRET } = require('./auth');

// channelId -> { mime, header:Buffer|null, broadcaster:ws, viewers:Set<ws> }
const rooms = new Map();

function broadcastViewerCount(room, channelId) {
  const count = room.viewers.size;
  const payload = JSON.stringify({ t: 'viewers', count });
  if (room.broadcaster && room.broadcaster.readyState === 1) room.broadcaster.send(payload);
  for (const v of room.viewers) if (v.readyState === 1) v.send(payload);
  try {
    db.prepare('UPDATE channels SET viewers=? WHERE id=?')
      .run(`${count} watching`, channelId);
  } catch (_) {}
}

function setLive(channelId, live, title) {
  try {
    if (title !== undefined) {
      db.prepare('UPDATE channels SET is_live=?, current=? WHERE id=?').run(live ? 1 : 0, title || '', channelId);
    } else {
      db.prepare('UPDATE channels SET is_live=? WHERE id=?').run(live ? 1 : 0, channelId);
    }
    if (!live) db.prepare('UPDATE channels SET viewers=? WHERE id=?').run('0 watching', channelId);
  } catch (_) {}
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = url.parse(req.url);
    if (pathname !== '/ws/live') return; // let other upgrade handlers deal with it
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws, req) => {
    const q = url.parse(req.url, true).query;
    const role = q.role === 'broadcast' ? 'broadcast' : 'view';
    const channelId = String(q.channel || '');
    const channel = db.prepare('SELECT * FROM channels WHERE id=?').get(channelId);
    if (!channel) { ws.send(JSON.stringify({ t: 'error', message: 'Channel not found' })); return ws.close(); }

    if (role === 'broadcast') {
      // Authenticate and verify ownership.
      let auth = null;
      try { auth = jwt.verify(String(q.token || ''), JWT_SECRET); } catch (_) {}
      if (!auth || channel.owner_id !== auth.sub) {
        ws.send(JSON.stringify({ t: 'error', message: 'You do not own this channel' }));
        return ws.close();
      }
      // Only one broadcaster per channel; replace any stale one.
      let room = rooms.get(channelId);
      if (room && room.broadcaster && room.broadcaster !== ws) {
        try { room.broadcaster.close(); } catch (_) {}
      }
      if (!room) { room = { mime: '', header: null, broadcaster: ws, viewers: new Set() }; rooms.set(channelId, room); }
      room.broadcaster = ws;
      ws._role = 'broadcast';
      ws._channelId = channelId;

      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          let msg; try { msg = JSON.parse(data.toString()); } catch (_) { return; }
          if (msg.t === 'start') {
            room.mime = msg.mime || 'video/webm;codecs="vp8,opus"';
            room.header = null; // reset; next binary chunk is the new header
            setLive(channelId, true, msg.title);
            // Tell any waiting viewers the stream is starting.
            for (const v of room.viewers) if (v.readyState === 1) v.send(JSON.stringify({ t: 'start', mime: room.mime }));
          }
          return;
        }
        // Binary media chunk.
        if (!room.header) room.header = Buffer.from(data); // cache init segment
        for (const v of room.viewers) {
          if (v.readyState === 1) v.send(data, { binary: true });
        }
      });

      const end = () => {
        setLive(channelId, false);
        for (const v of room.viewers) if (v.readyState === 1) v.send(JSON.stringify({ t: 'ended' }));
        room.broadcaster = null;
        room.header = null;
        room.mime = '';
        if (room.viewers.size === 0) rooms.delete(channelId);
      };
      ws.on('close', end);
      ws.on('error', end);
      ws.send(JSON.stringify({ t: 'ready' }));
      return;
    }

    // ---- Viewer ----
    let room = rooms.get(channelId);
    ws._role = 'view';
    ws._channelId = channelId;
    if (!room) { room = { mime: '', header: null, broadcaster: null, viewers: new Set() }; rooms.set(channelId, room); }
    room.viewers.add(ws);

    if (room.broadcaster && room.mime) {
      ws.send(JSON.stringify({ t: 'start', mime: room.mime }));
      if (room.header && ws.readyState === 1) ws.send(room.header, { binary: true });
    } else {
      ws.send(JSON.stringify({ t: 'offline' }));
    }
    broadcastViewerCount(room, channelId);

    const leave = () => {
      room.viewers.delete(ws);
      if (!room.broadcaster && room.viewers.size === 0) rooms.delete(channelId);
      else broadcastViewerCount(room, channelId);
    };
    ws.on('close', leave);
    ws.on('error', leave);
  });

  console.log('Live WebSocket relay attached at /ws/live');
  return wss;
}

module.exports = { attach };
