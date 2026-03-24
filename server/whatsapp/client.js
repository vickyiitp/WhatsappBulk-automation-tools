'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

if (process.env.RENDER) {
  process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
}

let whatsappClient  = null;
let clientStatus    = 'disconnected'; // disconnected | connecting | qr_ready | pairing_ready | connected
let qrCodeDataURL   = null;
let _pairingCode    = null;   // 8-digit pairing code shown to user
let _pairingPhone   = null;   // phone number requested for pairing
let _io             = null;

function resolveAuthPath() {
  const configured = process.env.WHATSAPP_AUTH_DIR;
  if (configured) return path.resolve(configured);

  if (process.env.RENDER) {
    const renderBase = process.env.RENDER_DISK_PATH || process.cwd();
    return path.join(renderBase, '.wwebjs_auth');
  }

  return path.resolve(process.cwd(), '.wwebjs_auth');
}

function resolveCachePath() {
  const configured = process.env.WHATSAPP_CACHE_DIR;
  if (configured) return path.resolve(configured);

  if (process.env.RENDER) {
    const renderBase = process.env.RENDER_DISK_PATH || process.cwd();
    return path.join(renderBase, '.wwebjs_cache');
  }

  return path.resolve(process.cwd(), '.wwebjs_cache');
}

function resetRuntimeState() {
  clientStatus  = 'disconnected';
  qrCodeDataURL = null;
  _pairingCode  = null;
  _pairingPhone = null;
}

function clearWhatsAppStorage() {
  const targets = [resolveAuthPath(), resolveCachePath()];
  for (const target of targets) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`[whatsapp] cleared session data → ${target}`);
    } catch (err) {
      console.warn(`[whatsapp] failed to clear session data ${target} → ${err.message}`);
    }
  }
}

function resolveExecutablePath() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
  if (configured) return configured;

  try {
    const puppeteer = require('puppeteer');
    const resolved = puppeteer.executablePath();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch (_) {
    // Fall through to common Linux paths below.
  }

  const candidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function ensureBrowserAvailable() {
  const existingPath = resolveExecutablePath();
  if (existingPath) return existingPath;

  if (!process.env.RENDER) return undefined;

  const cacheDir = process.env.PUPPETEER_CACHE_DIR;
  process.env.PUPPETEER_CACHE_DIR = cacheDir;

  console.log(`[whatsapp] browser missing, attempting Chrome install in ${cacheDir}`);

  try {
    execSync('npx puppeteer browsers install chrome', {
      stdio: 'inherit',
      env: process.env,
    });

    const installedPath = resolveExecutablePath();
    if (installedPath) return installedPath;
  } catch (err) {
    console.error('[whatsapp] chrome install error –', err.message);
  }

  return undefined;
}

function buildPuppeteerConfig() {
  const executablePath = ensureBrowserAvailable();

  return {
    headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : true,
    executablePath: executablePath || undefined,
    timeout: 120000, // 2 minutes to launch browser on slow environments
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-features=site-per-process,Translate,BackForwardCache',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-extensions',
      '--mute-audio'
    ],
  };
}

/**
 * Boot (or re-boot) the WhatsApp client.
 * Safe to call multiple times – will skip if a client is already running.
 */
function initializeClient(io) {
  _io = io;

  if (whatsappClient) {
    if (clientStatus === 'connected' || clientStatus === 'connecting' || clientStatus === 'qr_ready' || clientStatus === 'pairing_ready') {
      console.log(`[whatsapp] client already initialised – status ${clientStatus}`);
      _io && _io.emit('status', { status: clientStatus, message: 'WhatsApp session is already active.' });
      return;
    }

    try {
      whatsappClient.destroy().catch(() => {});
    } catch (_) { /* ignore */ }
    whatsappClient = null;
  }

  const authPath = resolveAuthPath();
  const cachePath = resolveCachePath();
  fs.mkdirSync(authPath, { recursive: true });
  fs.mkdirSync(cachePath, { recursive: true });

  whatsappClient = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    authTimeoutMs: 120000,
    qrMaxRetries: 5,
    webVersionCache: {
      type: 'local',
      path: path.join(cachePath, 'web-version-cache.html'),
    },
    puppeteer: buildPuppeteerConfig(),
  });

  console.log(`[whatsapp] auth path → ${authPath}`);
  console.log(`[whatsapp] cache path → ${cachePath}`);
  const executablePath = resolveExecutablePath();
  if (executablePath) {
    console.log(`[whatsapp] browser path → ${executablePath}`);
  }

  // ── Events ────────────────────────────────────────────────────────────────

  whatsappClient.on('loading_screen', (pct, msg) => {
    console.log(`[whatsapp] loading ${pct}% – ${msg}`);
    _io && _io.emit('status', { status: 'connecting', message: `Loading ${pct}%…` });
  });

  whatsappClient.on('qr', async (qr) => {
    console.log('[whatsapp] QR received – waiting for scan');
    clientStatus  = 'qr_ready';
    qrCodeDataURL = await qrcode.toDataURL(qr);
    _io && _io.emit('qr', qrCodeDataURL);
    _io && _io.emit('status', { status: 'qr_ready', message: 'Scan the QR code with WhatsApp' });

    // If a phone number was pre-registered, auto-request the pairing code now
    if (_pairingPhone) {
      try {
        const code = await whatsappClient.requestPairingCode(_pairingPhone);
        _pairingCode = code;
        clientStatus = 'pairing_ready';
        console.log(`[whatsapp] pairing code for ${_pairingPhone} → ${code}`);
        _io && _io.emit('pairing_code', { code });
        _io && _io.emit('status', {
          status: 'pairing_ready',
          message: `Enter this code on your phone: ${code}`,
        });
      } catch (err) {
        console.error('[whatsapp] requestPairingCode error –', err.message);
        _io && _io.emit('pairing_code', { error: `Could not get pairing code: ${err.message}` });
        // Fall back to showing the QR code
        _pairingPhone = null;
      }
    }
  });

  whatsappClient.on('authenticated', () => {
    console.log('[whatsapp] authenticated');
    clientStatus  = 'connecting';
    qrCodeDataURL = null;
    _pairingCode  = null;
    _pairingPhone = null;
    _io && _io.emit('status', { status: 'connecting', message: 'Authenticated – loading chats…' });
  });

  whatsappClient.on('ready', () => {
    console.log('[whatsapp] ready');
    clientStatus  = 'connected';
    qrCodeDataURL = null;
    _pairingCode  = null;
    _pairingPhone = null;
    _io && _io.emit('status', { status: 'connected', message: 'WhatsApp connected successfully!' });
  });

  whatsappClient.on('auth_failure', (msg) => {
    console.error('[whatsapp] auth_failure –', msg);
    resetRuntimeState();
    whatsappClient = null;
    clearWhatsAppStorage();
    _io && _io.emit('status', { status: 'disconnected', message: 'Authentication failed. Please reconnect.' });
  });

  whatsappClient.on('disconnected', (reason) => {
    console.warn('[whatsapp] disconnected –', reason);
    resetRuntimeState();
    whatsappClient = null;
    clearWhatsAppStorage();
    _io && _io.emit('status', { status: 'disconnected', message: 'WhatsApp disconnected.' });
  });

  whatsappClient.on('error', (err) => {
    console.error('[whatsapp] client internal error –', err);
    if (_io) {
      const errMsg = err instanceof Error ? err.message : String(err);
      _io.emit('sending_error', { error: `[WHATSAPP INTERNAL ERROR] ${errMsg}` });
    }
  });

  // ── Boot ──────────────────────────────────────────────────────────────────
  clientStatus = 'connecting';
  whatsappClient.initialize().catch((err) => {
    console.error('[whatsapp] initialize error –', err.message);
    if (err?.stack) console.error(err.stack);
    resetRuntimeState();
    whatsappClient = null;
    _io && _io.emit('status', { status: 'disconnected', message: `Failed to start: ${err.message}` });
  });
}

/**
 * Gracefully destroy the current client (clears puppeteer).
 */
async function destroyClient(options = {}) {
  const { clearSession = true } = options;

  if (whatsappClient) {
    try {
      await whatsappClient.destroy();
    } catch (_) { /* ignore */ }
    whatsappClient = null;
  }
  resetRuntimeState();
  if (clearSession) clearWhatsAppStorage();
  _io && _io.emit('status', { status: 'disconnected', message: 'Disconnected.' });
}

/**
 * Set the phone number that should automatically receive a pairing code once
 * the QR event fires.  Must be called BEFORE initializeClient().
 * @param {string} phone  E.164 digits only, e.g. "919876543210"
 */
function setPairingPhone(phone) {
  _pairingPhone = phone.replace(/\D/g, '');
}

const getClient      = () => whatsappClient;
const getStatus      = () => clientStatus;
const getQR          = () => qrCodeDataURL;
const getPairingCode = () => _pairingCode;

module.exports = { initializeClient, destroyClient, setPairingPhone, getClient, getStatus, getQR, getPairingCode };
