/* ─────────────────────────────────────────────────────────────
   WhatsApp Bulk Messenger – Frontend Logic
   ───────────────────────────────────────────────────────────── */

'use strict';

// ══ Socket.IO ═════════════════════════════════════════════════════════════════
const socket = io();

socket.on('connect', () => {
  setSocketStatus(true);
  fetchWhatsAppStatus(); // reconcile after re-connect
});

socket.on('disconnect', () => setSocketStatus(false));

socket.on('status',          (d) => handleWhatsAppStatus(d));
socket.on('qr',              (d) => showQRCode(d));
socket.on('pairing_code',    (d) => handlePairingCode(d));
socket.on('progress',        (d) => handleProgress(d));
socket.on('waiting',         (d) => showWaiting(d));
socket.on('sending_started', (d) => onSendingStarted(d));
socket.on('sending_complete',(d) => onSendingComplete(d));
socket.on('sending_stopped', (d) => onSendingStopped(d));
socket.on('sending_error',   (d) => { toast('Error: ' + d.error, 'error'); resetSendingUI(); });

// ══ Server socket indicator ═══════════════════════════════════════════════════
function setSocketStatus(online) {
  const dot   = document.getElementById('socketDot');
  const label = document.getElementById('socketLabel');
  dot.className   = 'dot ' + (online ? 'dot--online' : 'dot--offline');
  label.textContent = online ? 'Server connected' : 'Server offline';
}

// ══ WhatsApp status handling ══════════════════════════════════════════════════
async function fetchWhatsAppStatus() {
  try {
    const r = await apiFetch('/api/whatsapp/status');
    handleWhatsAppStatus(r);
    if (r.qr)          showQRCode(r.qr);
    if (r.pairingCode) handlePairingCode({ code: r.pairingCode });
  } catch (_) {}
}

function handleWhatsAppStatus({ status, message }) {
  const badge       = document.getElementById('waBadge');
  const qrSection   = document.getElementById('qrSection');
  const connSec     = document.getElementById('connectedSection');
  const conningSec  = document.getElementById('connectingSection');
  const conningMsg  = document.getElementById('connectingMsg');
  const btnConnect  = document.getElementById('btnConnect');
  const btnDisconn  = document.getElementById('btnDisconnect');
  const btnLogout   = document.getElementById('btnLogout');

  // Reset visibility
  qrSection.classList.add('hidden');
  connSec.classList.add('hidden');
  conningSec.classList.add('hidden');

  if (status === 'connected') {
    badge.textContent = 'Connected';
    badge.className   = 'badge badge--connected';
    connSec.classList.remove('hidden');
    btnConnect.classList.add('hidden');
    btnDisconn.classList.remove('hidden');
    btnLogout.classList.remove('hidden');
    document.getElementById('pairingCodeBox').classList.add('hidden');
  } else if (status === 'pairing_ready') {
    badge.textContent = 'Enter Code';
    badge.className   = 'badge badge--qr';
    btnConnect.classList.add('hidden');
    btnDisconn.classList.remove('hidden');
    btnLogout.classList.add('hidden');
  } else if (status === 'qr_ready') {
    badge.textContent = 'Scan QR';
    badge.className   = 'badge badge--qr';
    qrSection.classList.remove('hidden');
    btnConnect.classList.add('hidden');
    btnDisconn.classList.remove('hidden');
    btnLogout.classList.add('hidden');
  } else if (status === 'connecting') {
    badge.textContent = 'Connecting';
    badge.className   = 'badge badge--connecting';
    conningSec.classList.remove('hidden');
    if (message) conningMsg.textContent = message;
    btnConnect.classList.add('hidden');
    btnDisconn.classList.add('hidden');
    btnLogout.classList.add('hidden');
  } else {
    // disconnected
    badge.textContent = 'Disconnected';
    badge.className   = 'badge badge--disconnected';
    btnConnect.classList.remove('hidden');
    btnDisconn.classList.add('hidden');
    btnLogout.classList.add('hidden');
    document.getElementById('pairingCodeBox').classList.add('hidden');
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  const isQR = tab === 'qr';
  document.getElementById('tabQR').className    = 'tab-btn' + (isQR  ? ' tab-btn--active' : '');
  document.getElementById('tabPhone').className = 'tab-btn' + (!isQR ? ' tab-btn--active' : '');
  document.getElementById('tabContentQR').classList.toggle('hidden', !isQR);
  document.getElementById('tabContentPhone').classList.toggle('hidden', isQR);
  // Update Connect button label
  document.getElementById('btnConnect').textContent = isQR ? 'Connect' : 'Connect via Phone';
}

function showQRCode(dataUrl) {
  const img = document.getElementById('qrImage');
  img.src   = dataUrl;
  document.getElementById('qrSection').classList.remove('hidden');
}

// ══ Connect / Disconnect  ════════════════════════════════════════════════════
async function connectWhatsApp() {
  // If phone tab is active, delegate to phone connect
  if (!document.getElementById('tabContentPhone').classList.contains('hidden')) {
    return connectWithPhone();
  }
  try {
    await apiFetch('/api/whatsapp/connect', 'POST');
    handleWhatsAppStatus({ status: 'connecting', message: 'Initialising WhatsApp…' });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function connectWithPhone() {
  const phone = document.getElementById('phoneInput').value.trim();
  if (!phone) { toast('Enter your phone number first', 'warning'); return; }

  try {
    await apiFetch('/api/whatsapp/connect-phone', 'POST', { phone });
    handleWhatsAppStatus({ status: 'connecting', message: 'Requesting pairing code…' });
    document.getElementById('btnPhoneConnect').disabled = true;
    toast('Connecting… pairing code will appear in a few seconds', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function handlePairingCode({ code, error }) {
  const box     = document.getElementById('pairingCodeBox');
  const display = document.getElementById('pairingCodeDisplay');
  box.classList.remove('hidden');
  // Make sure phone tab is visible
  switchTab('phone');

  if (error) {
    display.textContent = '–';
    toast(error, 'error');
    return;
  }
  // Format as "ABCD-1234" style (insert hyphen in the middle if 8 chars)
  const formatted = code.length === 8 ? code.slice(0, 4) + '-' + code.slice(4) : code;
  display.textContent = formatted;
  document.getElementById('btnPhoneConnect').disabled = false;
  toast(`Pairing code: ${formatted}  — Enter it on WhatsApp now!`, 'success');
}

async function disconnectWhatsApp() {
  if (!confirm('Pause service? This stops the underlying WhatsApp client but keeps you logged in.')) return;
  try {
    await apiFetch('/api/whatsapp/disconnect', 'POST');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function logoutWhatsApp() {
  if (!confirm('Log out from WhatsApp? This will clear your session and you will need to scan the QR code next time.')) return;
  try {
    await apiFetch('/api/whatsapp/logout', 'POST');
    toast('Logged out successfully', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ══ Excel Upload ══════════════════════════════════════════════════════════════
function onDragOver(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.add('drop-zone--active');
}
function onDragLeave() {
  document.getElementById('dropZone').classList.remove('drop-zone--active');
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drop-zone--active');
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
}

async function uploadFile(file) {
  if (!file) return;

  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext     = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    toast('Please upload an .xlsx, .xls, or .csv file', 'error');
    return;
  }

  const progressWrap = document.getElementById('uploadProgress');
  const bar          = document.getElementById('uploadBar');
  const msg          = document.getElementById('uploadMsg');

  progressWrap.classList.remove('hidden');
  document.getElementById('previewSection').classList.add('hidden');
  bar.style.width     = '30%';
  msg.textContent     = 'Uploading…';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const res  = await fetch('/api/contacts/upload', { method: 'POST', body: formData });
    const data = await res.json();

    bar.style.width = '100%';
    msg.textContent = 'Done';

    if (!res.ok) throw new Error(data.error || 'Upload failed');

    setTimeout(() => progressWrap.classList.add('hidden'), 600);
    renderPreview(data);
    toast(`Loaded ${data.count} contacts`, 'success');
  } catch (e) {
    bar.style.width = '0%';
    msg.textContent = '';
    progressWrap.classList.add('hidden');
    toast(e.message, 'error');
  }

  // Reset file input so the same file can be re-uploaded if needed
  document.getElementById('fileInput').value = '';
}

function renderPreview({ count, preview }) {
  document.getElementById('contactsBadge').textContent = `${count} contacts`;
  document.getElementById('previewLabel').textContent  =
    count > 5 ? `Showing first 5 of ${count} contacts` : `${count} contact(s)`;
  document.getElementById('statTotal').textContent     = count;

  const tbody = document.getElementById('previewBody');
  tbody.innerHTML = '';
  (preview || []).forEach((c, i) => {
    const tr  = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td>`;
    tbody.appendChild(tr);
  });

  document.getElementById('previewSection').classList.remove('hidden');
  updatePreview();
}

async function clearContacts() {
  await apiFetch('/api/contacts', 'DELETE');
  document.getElementById('previewSection').classList.add('hidden');
  document.getElementById('contactsBadge').textContent = '0 contacts';
  document.getElementById('statTotal').textContent     = '0';
  document.getElementById('previewBody').innerHTML     = '';
  document.getElementById('previewBox').classList.add('hidden');
  toast('Contacts cleared');
}

// ══ Message Template Preview ══════════════════════════════════════════════════
function updatePreview() {
  const template = document.getElementById('templateInput').value;
  const box      = document.getElementById('previewBox');
  const pre      = document.getElementById('previewText');

  if (!template.trim()) {
    box.classList.add('hidden');
    return;
  }

  // Use first contact from preview if available
  const firstRow = document.getElementById('previewBody').querySelector('td:nth-child(2)');
  const name     = firstRow ? firstRow.textContent : 'Rahul';
  pre.textContent = template.replace(/\{name\}/gi, name);
  box.classList.remove('hidden');
}

// ══ Sending controls ═════════════════════════════════════════════════════════
async function startSending() {
  const template = document.getElementById('templateInput').value.trim();
  if (!template) { toast('Please write a message template', 'warning'); return; }

  // Quick guards
  const totalEl = document.getElementById('statTotal');
  if (parseInt(totalEl.textContent || '0', 10) === 0) {
    toast('Upload contacts first', 'warning');
    return;
  }

  try {
    const data = await apiFetch('/api/messages/send', 'POST', { template });
    toast(`Started – sending to ${data.total} contacts`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function stopSending() {
  await apiFetch('/api/messages/stop', 'POST');
  toast('Stop signal sent', 'warning');
}

async function resetSession() {
  try {
    await apiFetch('/api/messages/reset-session', 'POST');
    document.getElementById('statSent').textContent    = '0';
    document.getElementById('statFailed').textContent  = '0';
    document.getElementById('statSkipped').textContent = '0';
    toast('Session reset – you can re-send to the same contacts now', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ══ Sending event handlers ════════════════════════════════════════════════════
function onSendingStarted({ total }) {
  document.getElementById('statTotal').textContent   = total;
  document.getElementById('statSent').textContent    = '0';
  document.getElementById('statFailed').textContent  = '0';
  document.getElementById('statSkipped').textContent = '0';

  const wrap  = document.getElementById('overallProgressWrap');
  const label = document.getElementById('overallProgressLabel');
  wrap.style.display  = 'block';
  label.style.display = 'block';
  document.getElementById('overallBar').style.width = '0%';
  label.textContent = `0 / ${total}`;

  document.getElementById('btnSend').classList.add('hidden');
  document.getElementById('btnStop').classList.remove('hidden');
  document.getElementById('waitingLabel').style.display = 'none';
}

function handleProgress({ current, total, sent, failed, skipped, name, status, reason }) {
  document.getElementById('statSent').textContent    = sent;
  document.getElementById('statFailed').textContent  = failed;
  document.getElementById('statSkipped').textContent = skipped || 0;

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('overallBar').style.width  = pct + '%';
  document.getElementById('overallProgressLabel').textContent = `${current} / ${total}`;

  addLogRow(name, '', status, reason);
}

function showWaiting({ seconds, next }) {
  const el      = document.getElementById('waitingLabel');
  el.style.display = 'block';
  el.textContent   = `Waiting ${seconds}s before sending to ${next || 'next contact'}…`;
}

function onSendingComplete({ total, sent, failed, skipped }) {
  resetSendingUI();
  document.getElementById('statSent').textContent    = sent;
  document.getElementById('statFailed').textContent  = failed;
  document.getElementById('statSkipped').textContent = skipped;
  document.getElementById('overallBar').style.width  = '100%';
  document.getElementById('overallProgressLabel').textContent = `${total} / ${total} – Complete ✓`;
  document.getElementById('waitingLabel').style.display = 'none';
  toast(`Campaign complete! ✓ ${sent} sent  ✗ ${failed} failed  ⟳ ${skipped} skipped`, 'success');
}

function onSendingStopped({ sent, failed, skipped }) {
  resetSendingUI();
  toast(`Stopped. ✓ ${sent} sent  ✗ ${failed} failed`, 'warning');
}

function resetSendingUI() {
  document.getElementById('btnSend').classList.remove('hidden');
  document.getElementById('btnStop').classList.add('hidden');
}

// ══ Activity Log ══════════════════════════════════════════════════════════════
function addLogRow(name, phone, status, reason) {
  const tbody = document.getElementById('logBody');
  const empty = document.getElementById('logEmpty');
  if (empty) empty.remove();

  const pill = {
    success: '<span class="status-pill status-pill--success">✓ Sent</span>',
    failed:  '<span class="status-pill status-pill--failed">✗ Failed</span>',
    skipped: '<span class="status-pill status-pill--skipped">⟳ Skipped</span>',
  }[status] || status;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${timeNow()}</td>
    <td>${esc(name)}</td>
    <td>${esc(phone)}</td>
    <td>${pill}</td>
    <td class="hint">${esc(reason || '')}</td>`;
  tbody.prepend(tr);

  // Keep log manageable
  if (tbody.rows.length > 200) tbody.deleteRow(tbody.rows.length - 1);
}

function clearLog() {
  document.getElementById('logBody').innerHTML =
    '<tr id="logEmpty"><td colspan="5" class="center hint">No activity yet</td></tr>';
}

// ══ Utilities ════════════════════════════════════════════════════════════════
async function apiFetch(url, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

let _toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent  = msg;
  el.className    = `toast toast--${type}`;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ══ Boot ══════════════════════════════════════════════════════════════════════
fetchWhatsAppStatus();
