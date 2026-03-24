'use strict';

require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const path        = require('path');
const fs          = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST', 'DELETE'] } });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../client')));

// ── Ensure uploads dir exists ────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── Shared application state ─────────────────────────────────────────────────
app.locals.contacts = [];
app.locals.io       = io;

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/whatsapp', require('./routes/whatsapp'));
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/messages',  require('./routes/messages'));

// ── Fallback: serve SPA ───────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] client connected  → ${socket.id}`);

  // Push current WhatsApp status to the newly connected browser tab
  const { getStatus, getQR, getPairingCode } = require('./whatsapp/client');
  socket.emit('status', { status: getStatus() });
  const qr = getQR();
  if (qr) socket.emit('qr', qr);
  const pc = getPairingCode();
  if (pc) socket.emit('pairing_code', { code: pc });

  socket.on('disconnect', () => {
    console.log(`[socket] client disconnected → ${socket.id}`);
  });
});

// ── Render Crash Prevention & Debugging ───────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[process] Unhandled Rejection at:', promise, 'reason:', reason);
  const errMsg = reason instanceof Error ? reason.message : String(reason);
  if (app.locals.io) {
    app.locals.io.emit('sending_error', { error: `[SERVER CRASH PREVENTED] Unhandled Rejection: ${errMsg}` });
  }
});

process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught Exception:', err);
  if (app.locals.io) {
    app.locals.io.emit('sending_error', { error: `[SERVER CRASH PREVENTED] Uncaught Exception: ${err.message}` });
  }
  // Let the process survive or restart depending on the environment.
  // We don't exit here so the user can see the error on the frontend.
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================');
  console.log(`  WhatsApp Bulk Messenger`);
  console.log(`  http://localhost:${PORT}`);
  console.log('======================================\n');
  
  // ── Keep Awake for Render Free Tier ──────────────────────────────────────────
  if (process.env.RENDER_EXTERNAL_URL) {
    const KEEP_AWAKE_INTERVAL = 14 * 60 * 1000; // 14 minutes
    console.log(`[keep-awake] Enabled for ${process.env.RENDER_EXTERNAL_URL}`);
    setInterval(() => {
      const httpModule = process.env.RENDER_EXTERNAL_URL.startsWith('https') ? require('https') : require('http');
      httpModule.get(process.env.RENDER_EXTERNAL_URL, (res) => {
        console.log(`[keep-awake] Pinged self -> Status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.error('[keep-awake] Error pinging self:', err.message);
      });
    }, KEEP_AWAKE_INTERVAL);
  }
});
