'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { parseExcel } = require('../services/excelService');

// ── Multer config ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename:    (_req, file, cb) => cb(null, `upload_${Date.now()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${ext}. Use .xlsx, .xls, or .csv`));
  },
});

// ── POST /api/contacts/upload ─────────────────────────────────────────────────
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });

    let contacts = [];
    try {
      contacts = parseExcel(req.file.path);
    } catch (parseErr) {
      fs.unlink(req.file.path, () => {}); // cleanup on error
      return res.status(422).json({ error: `Could not parse file: ${parseErr.message}` });
    }

    // Clean up temp file
    fs.unlink(req.file.path, () => {});

    if (contacts.length === 0) {
      return res.status(422).json({
        error: 'No valid contacts found. Make sure the file has "Name" and "Phone" columns.',
      });
    }

    req.app.locals.contacts = contacts;
    console.log(`[contacts] loaded ${contacts.length} contacts`);

    res.json({
      message:  `Loaded ${contacts.length} contacts`,
      count:    contacts.length,
      preview:  contacts.slice(0, 5),
    });
  });
});

// ── GET /api/contacts ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json({ contacts: req.app.locals.contacts || [], count: (req.app.locals.contacts || []).length });
});

// ── DELETE /api/contacts ──────────────────────────────────────────────────────
router.delete('/', (req, res) => {
  req.app.locals.contacts = [];
  res.json({ message: 'Contacts cleared' });
});

module.exports = router;
