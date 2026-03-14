'use strict';

const XLSX = require('xlsx');

// Dangerous prototype keys – reject any row that contains them (GHSA-4r6h-8v6p-xvw6 mitigation)
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizePhone(rawPhone) {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  const cc = String(process.env.DEFAULT_COUNTRY_CODE || '').replace(/\D/g, '');

  if (!digits) return '';

  // If user uploaded local numbers and a default country code is configured,
  // expand them to full international format.
  if (cc) {
    if (digits.length === 10) return `${cc}${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `${cc}${digits.slice(1)}`;
  }

  return digits;
}

/**
 * Parse an Excel (.xlsx / .xls) or CSV file and return a list of contacts.
 * Expected columns (case-insensitive): Name, Phone / PhoneNumber / Mobile / Number
 *
 * @param {string} filePath  Absolute path to the uploaded file.
 * @returns {{ name: string, phone: string }[]}
 */
function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath, {
    // Mitigate ReDoS: cap the number of rows and characters read (GHSA-5pgg-2g8v-p4x9)
    sheetRows: 10001,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

  const contacts = [];
  const seen     = new Set(); // deduplicate inside the same file

  for (const row of rows) {
    // Use Object.create(null) intentionally to avoid prototype chain pollution
    const r = Object.create(null);
    for (const key of Object.keys(row)) {
      const safeKey = key.toLowerCase().trim().replace(/\s+/g, '');
      // Skip any key that would pollute the prototype chain
      if (PROTO_KEYS.has(safeKey)) continue;
      // Truncate values to avoid ReDoS on very long strings
      const val = String(row[key] ?? '').slice(0, 500);
      r[safeKey] = val;
    }

    const rawName  = r['name'] || r['fullname'] || r['contactname'] || r['customer'] || '';
    const rawPhone = r['phone'] || r['phonenumber'] || r['mobile'] || r['mobilenumber']
                  || r['number'] || r['contact'] || r['whatsapp'] || '';

    if (!rawName || !rawPhone) continue;

    const name  = rawName.toString().trim();
    const phone = normalizePhone(rawPhone);

    // Minimum 10 digits, maximum 15 (international standard)
    if (phone.length < 10 || phone.length > 15) continue;

    const key = `${name.toLowerCase()}:${phone}`;
    if (seen.has(key)) continue;
    seen.add(key);

    contacts.push({ name, phone });
  }

  return contacts;
}

module.exports = { parseExcel };
