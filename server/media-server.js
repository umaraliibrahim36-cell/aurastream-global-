'use strict';
/* Live streaming via node-media-server.
 *
 * Broadcasters push RTMP to:   rtmp://<host>:<RTMP_PORT>/live/<stream_key>
 * Viewers play HLS from:        http://<host>:<MEDIA_HTTP_PORT>/live/<stream_key>/index.m3u8
 * The main API also proxies /live/* to this HLS output.
 *
 * When a stream starts/stops we flip the matching channel's is_live flag.
 */
const NodeMediaServer = require('node-media-server');
const { db } = require('./db');

function startMediaServer() {
  // node-media-server@2.x has a cosmetic logging bug on some Node versions
  // ('version is not defined') thrown asynchronously after the servers start.
  // Swallow only that specific, harmless error so it does not spam logs.
  process.on('uncaughtException', (err) => {
    if (err && /version is not defined/.test(err.message)) return;
    console.error('uncaughtException:', err);
  });
  const config = {
    rtmp: {
      port: parseInt(process.env.RTMP_PORT || '1935', 10),
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60
    },
    http: {
      port: parseInt(process.env.MEDIA_HTTP_PORT || '8000', 10),
      mediaroot: './media',
      allow_origin: '*'
    },
    trans: {
      // Requires ffmpeg installed on the host for RTMP -> HLS transmux.
      ffmpeg: process.env.FFMPEG_PATH || '/usr/bin/ffmpeg',
      tasks: [
        {
          app: 'live',
          hls: true,
          hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
          dash: false
        }
      ]
    }
  };

  const nms = new NodeMediaServer(config);

  // Validate stream key on publish; reject unknown keys.
  nms.on('prePublish', (id, StreamPath) => {
    const key = (StreamPath || '').split('/').pop();
    const ch = db.prepare('SELECT * FROM channels WHERE stream_key=?').get(key);
    if (!ch) {
      const session = nms.getSession(id);
      if (session) session.reject();
      console.warn('[live] rejected unknown stream key:', key);
    }
  });

  nms.on('postPublish', (id, StreamPath) => {
    const key = (StreamPath || '').split('/').pop();
    db.prepare('UPDATE channels SET is_live=1 WHERE stream_key=?').run(key);
    console.log('[live] channel live:', key);
  });

  nms.on('donePublish', (id, StreamPath) => {
    const key = (StreamPath || '').split('/').pop();
    db.prepare('UPDATE channels SET is_live=0 WHERE stream_key=?').run(key);
    console.log('[live] channel offline:', key);
  });

  try {
    nms.run();
    console.log(`[live] RTMP ingest on :${config.rtmp.port}, HLS on :${config.http.port}`);
  } catch (e) {
    console.warn('[live] media server failed to start (ffmpeg missing?):', e.message);
  }
  return nms;
}

module.exports = { startMediaServer };
