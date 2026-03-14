'use strict';

const { getClient } = require('../whatsapp/client');

// ── Module-level state ────────────────────────────────────────────────────────
const state = {
  isRunning:   false,
  total:       0,
  sent:        0,
  failed:      0,
  skipped:     0,
  results:     [],
  sentNumbers: new Set(), // tracks numbers sent in this server session
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function isTransientSendError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    msg.includes('detached frame') ||
    msg.includes('execution context was destroyed') ||
    msg.includes('target closed') ||
    msg.includes('session closed') ||
    msg.includes('protocol error')
  );
}

async function sendWithRetry(client, chatId, message, maxAttempts = 3) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await client.sendMessage(chatId, message);
      return;
    } catch (err) {
      lastErr = err;
      if (!isTransientSendError(err) || attempt === maxAttempts) break;
      // Brief backoff gives WhatsApp Web time to recover from internal reloads.
      await delay(1200 * attempt);
    }
  }

  throw lastErr;
}

/**
 * Replace {name} (and {Name}, {NAME} variants) in the template string.
 */
function personalise(template, name) {
  return template.replace(/\{name\}/gi, name);
}

function pushResult(entry) {
  state.results.push({ ...entry, timestamp: new Date().toISOString() });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start sending messages to the given contacts list.
 *
 * @param {{ name: string, phone: string }[]} contacts
 * @param {string} template   Message template with optional {name} placeholder.
 * @param {object} io         Socket.IO server instance for real-time events.
 * @param {number} minDelay   Min milliseconds between messages (default 5 000).
 * @param {number} maxDelay   Max milliseconds between messages (default 10 000).
 */
async function startSending(contacts, template, io, minDelay = 5000, maxDelay = 10000) {
  if (state.isRunning) throw new Error('A send job is already in progress.');

  const client = getClient();
  if (!client)  throw new Error('WhatsApp is not connected. Please scan the QR code first.');

  // Reset counters (keep sentNumbers to prevent re-sends in the same server session)
  state.isRunning = true;
  state.total     = contacts.length;
  state.sent      = 0;
  state.failed    = 0;
  state.skipped   = 0;
  state.results   = [];

  io.emit('sending_started', { total: contacts.length });

  for (let i = 0; i < contacts.length; i++) {
    if (!state.isRunning) {
      io.emit('sending_stopped', {
        sent: state.sent, failed: state.failed, skipped: state.skipped,
      });
      break;
    }

    const contact = contacts[i];

    // ── Duplicate guard ──────────────────────────────────────────────────────
    if (state.sentNumbers.has(contact.phone)) {
      state.skipped++;
      pushResult({ name: contact.name, phone: contact.phone, status: 'skipped', reason: 'Already sent this session' });
      io.emit('progress', buildProgress(i + 1, contact, 'skipped', 'Already sent this session'));
      continue;
    }

    // ── Send ─────────────────────────────────────────────────────────────────
    try {
      const chatId  = `${contact.phone}@c.us`;
      const message = personalise(template, contact.name);

      const waNumber = await client.getNumberId(contact.phone);
      if (!waNumber?._serialized) {
        throw new Error('Number is not registered on WhatsApp');
      }

      await sendWithRetry(client, chatId, message);

      state.sent++;
      state.sentNumbers.add(contact.phone);
      pushResult({ name: contact.name, phone: contact.phone, status: 'success' });
      io.emit('progress', buildProgress(i + 1, contact, 'success'));

      console.log(`[send] ✓  ${contact.name} (${contact.phone})`);
    } catch (err) {
      state.failed++;
      pushResult({ name: contact.name, phone: contact.phone, status: 'failed', reason: err.message });
      io.emit('progress', buildProgress(i + 1, contact, 'failed', err.message));
      console.warn(`[send] ✗  ${contact.name} (${contact.phone}) → ${err.message}`);
    }

    // ── Inter-message delay (skip after last contact) ─────────────────────
    if (i < contacts.length - 1 && state.isRunning) {
      const wait    = randomDelay(minDelay, maxDelay);
      const nextName = contacts[i + 1]?.name ?? '';
      io.emit('waiting', { seconds: Math.round(wait / 1000), next: nextName });
      await delay(wait);
    }
  }

  state.isRunning = false;
  io.emit('sending_complete', {
    total:   state.total,
    sent:    state.sent,
    failed:  state.failed,
    skipped: state.skipped,
    results: state.results,
  });
}

function buildProgress(current, contact, status, reason) {
  return {
    current,
    total:   state.total,
    sent:    state.sent,
    failed:  state.failed,
    skipped: state.skipped,
    name:    contact.name,
    phone:   contact.phone,
    status,
    reason:  reason || null,
  };
}

function stopSending() {
  state.isRunning = false;
}

function getState() {
  return {
    isRunning: state.isRunning,
    total:     state.total,
    sent:      state.sent,
    failed:    state.failed,
    skipped:   state.skipped,
    results:   [...state.results],
  };
}

/**
 * Clear the session-duplicate tracker so the same numbers can be messaged again.
 * Not allowed while a job is in progress.
 */
function resetSession() {
  if (state.isRunning) throw new Error('Cannot reset while sending is in progress.');
  state.sentNumbers.clear();
  state.results   = [];
  state.sent      = 0;
  state.failed    = 0;
  state.skipped   = 0;
}

module.exports = { startSending, stopSending, getState, resetSession };
