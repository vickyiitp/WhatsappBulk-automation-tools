'use strict';

const express = require('express');
const router  = express.Router();
const {
  startSending,
  stopSending,
  getState,
  resetSession,
} = require('../services/messageService');

const MIN_DELAY = parseInt(process.env.MIN_DELAY, 10) || 5000;
const MAX_DELAY = parseInt(process.env.MAX_DELAY, 10) || 10000;

// ── POST /api/messages/send ───────────────────────────────────────────────────
router.post('/send', (req, res) => {
  const { template } = req.body;
  const contacts     = req.app.locals.contacts || [];
  const { io }       = req.app.locals;

  if (!template || !template.trim()) {
    return res.status(400).json({ error: 'Message template is required.' });
  }
  if (contacts.length === 0) {
    return res.status(400).json({ error: 'No contacts loaded. Please upload an Excel file first.' });
  }

  // Respond immediately; sending runs asynchronously in background
  res.json({ message: 'Sending started', total: contacts.length });

  startSending(contacts, template, io, MIN_DELAY, MAX_DELAY).catch((err) => {
    console.error('[messages] startSending error –', err.message);
    io.emit('sending_error', { error: err.message });
  });
});

// ── POST /api/messages/stop ───────────────────────────────────────────────────
router.post('/stop', (_req, res) => {
  stopSending();
  res.json({ message: 'Stop signal sent' });
});

// ── GET /api/messages/status ──────────────────────────────────────────────────
router.get('/status', (_req, res) => {
  res.json(getState());
});

// ── POST /api/messages/reset-session ─────────────────────────────────────────
router.post('/reset-session', (_req, res) => {
  try {
    resetSession();
    res.json({ message: 'Session reset. You can now re-send to the same contacts.' });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

module.exports = router;
