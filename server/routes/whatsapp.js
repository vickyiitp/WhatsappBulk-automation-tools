'use strict';

const express = require('express');
const router  = express.Router();
const {
  initializeClient, destroyClient, setPairingPhone, getStatus, getQR, getPairingCode,
} = require('../whatsapp/client');

// GET /api/whatsapp/status
router.get('/status', (_req, res) => {
  res.json({ status: getStatus(), qr: getQR(), pairingCode: getPairingCode() });
});

// POST /api/whatsapp/connect  (QR mode)
router.post('/connect', (req, res) => {
  const { io } = req.app.locals;
  initializeClient(io);
  res.json({ message: 'Connecting…' });
});

// POST /api/whatsapp/connect-phone  (pairing-code mode)
// Body: { phone: "919876543210" }
router.post('/connect-phone', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length < 10 || cleaned.length > 15) {
    return res.status(400).json({ error: 'Enter a valid phone number with country code (e.g. 919876543210).' });
  }

  const { io } = req.app.locals;
  setPairingPhone(cleaned);
  initializeClient(io);
  res.json({ message: 'Connecting… pairing code will be sent shortly.' });
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', async (_req, res) => {
  try {
    await destroyClient();
    res.json({ message: 'Disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
