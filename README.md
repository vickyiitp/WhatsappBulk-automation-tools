# WhatsApp Bulk Messenger – Automation Tool

> **Send personalized WhatsApp messages at scale** — import your contacts from Excel/CSV, write a template, and let the app handle delivery with real-time progress tracking.

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D16-green?logo=node.js) ![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## Features

- **QR / Pairing-code login** — authenticate WhatsApp Web once; session is saved for future runs
- **Excel & CSV support** — drag-and-drop upload, auto-detects `Name` / `Phone` columns
- **Personalised templates** — use `{name}` placeholder for per-contact customisation
- **Real-time dashboard** — live progress bar, sent / failed / skipped counters via Socket.IO
- **Rate limiting** — configurable random delay between messages to avoid bans
- **Stop mid-campaign** — abort at any time and review the activity log
- **Zero cloud dependency** — runs entirely on your local machine

---

Send personalized WhatsApp messages to a list of contacts imported from an Excel or CSV file.

---

## Table of Contents
1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Running the App](#running-the-app)
5. [How to Use](#how-to-use)
6. [Excel File Format](#excel-file-format)
7. [Project Structure](#project-structure)
8. [Configuration](#configuration)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)
11. [Contributing](#contributing)
12. [License](#license)

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 16.x |
| npm | ≥ 8.x |
| Google Chrome / Chromium | Installed (used by Puppeteer) |
| WhatsApp | Active account on your phone |

> **Windows users:** On the first `npm install`, Puppeteer will download a bundled Chromium binary (~170 MB). This is a one-time download.

---

## Installation

```bash
# 1. Clone or copy the project
cd "e:\vickyiitp\Projects\Whatsaapp bulk"

# 2. Install dependencies  (takes 2-5 minutes the first time)
npm install

# 3. Copy the environment file
copy .env.example .env
```

---

## Running the App

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

Then open your browser at:

```
http://localhost:3000
```

---

## How to Use

### Step 1 – Connect WhatsApp
1. Click **Connect** in the *WhatsApp Connection* card.
2. A QR code will appear within ~15 seconds.
3. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**.
4. Scan the QR code.
5. The status changes to **Connected ✅**.

> The session is saved locally in `.wwebjs_auth/`. Next time you start the app you will be logged in automatically without scanning again.

### Step 2 – Upload Contacts
1. Drag & drop an Excel/CSV file onto the upload area (or click to browse).
2. The app parses the file and shows a preview of the first 5 contacts.

### Step 3 – Write a Message Template
1. Type your message in the *Message Template* box.
2. Use `{name}` anywhere in the text – it will be replaced with the contact's name.
3. A live preview appears beneath the editor.

**Example template:**
```
Hello {name},

We help businesses automate their marketing with AI tools.

Are you available for a quick call this week?
```

### Step 4 – Start Sending
1. Click **▶ Start Sending**.
2. Watch the progress bar and live stats update in real time.
3. Each message is followed by a random 5–10 second delay (configurable in `.env`).
4. Use **⏹ Stop** to abort mid-campaign.

### Step 5 – Review Results
- The *Activity Log* shows every contact's send status (Sent / Failed / Skipped).
- Failed messages show the reason (e.g., number not on WhatsApp).
- **↺ Reset session** lets you re-send to the same numbers in a new run.

---

## Excel File Format

The file must have **Name** and **Phone** columns (case-insensitive):

```
Name      | Phone
----------|---------------
Rahul     | 919876543210
Aman      | 918765432109
Priya     | 917654321098
```

**Accepted column name variations:**

| Name column | Phone column |
|-------------|-------------|
| `Name` | `Phone` |
| `Full Name` | `PhoneNumber` |
| `Contact Name` | `Mobile` |
| `Customer` | `MobileNumber` |
| | `Number` |
| | `WhatsApp` |

**Phone number format:** Include the country code (no `+` or spaces needed – all non-digit characters are stripped automatically).

```
919876543210   ✓  (India: 91 + 10-digit mobile)
+91 9876543210 ✓  (stripped to 919876543210)
9876543210     ✗  (too short – missing country code)
```

---

## Project Structure

```
whatsapp-bulk-messenger/
├── server/
│   ├── index.js                  # Express + Socket.IO entry point
│   ├── whatsapp/
│   │   └── client.js             # WhatsApp Web.js wrapper (QR, session, events)
│   ├── services/
│   │   ├── excelService.js       # Excel / CSV parser
│   │   └── messageService.js     # Bulk send logic with delay & duplicate guard
│   └── routes/
│       ├── whatsapp.js           # GET/POST /api/whatsapp/*
│       ├── contacts.js           # POST/GET/DELETE /api/contacts/*
│       └── messages.js           # POST/GET /api/messages/*
├── client/
│   ├── index.html                # Single-page dashboard
│   ├── css/
│   │   └── styles.css
│   └── js/
│       └── app.js                # Socket.IO + REST client logic
├── uploads/                      # Temporary upload directory (auto-created)
├── .wwebjs_auth/                 # WhatsApp session storage (auto-created)
├── .env                          # Your local config (not committed)
├── .env.example                  # Template
├── .gitignore
├── package.json
└── README.md
```

---

## Configuration

Edit `.env` to customise behaviour:

```env
# Server port
PORT=3000

# Delay between messages (milliseconds)
MIN_DELAY=5000    # 5 seconds minimum
MAX_DELAY=10000   # 10 seconds maximum
```

Increasing the delay reduces the risk of your WhatsApp account being flagged for spam.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/whatsapp/status` | Current WA connection status + QR data URL |
| `POST` | `/api/whatsapp/connect` | Initialise WA client |
| `POST` | `/api/whatsapp/disconnect` | Destroy WA client |
| `POST` | `/api/contacts/upload` | Upload Excel/CSV file |
| `GET`  | `/api/contacts` | Fetch loaded contacts |
| `DELETE` | `/api/contacts` | Clear contacts |
| `POST` | `/api/messages/send` | Start bulk send `{ template }` |
| `POST` | `/api/messages/stop` | Stop current send job |
| `GET`  | `/api/messages/status` | Sending progress stats |
| `POST` | `/api/messages/reset-session` | Clear duplicate-send tracker |

---

## Troubleshooting

### QR code never appears
- Make sure no other WhatsApp Web session is already open in a browser.
- Delete `.wwebjs_auth/` and restart the server.

### "Chromium not found" error
- Run `npm install` again (Puppeteer downloads Chromium automatically).
- On Windows, ensure you are **not** running in a sandboxed environment.

### Messages show as "Failed"
- Verify the phone number includes the **country code** (e.g., `91` for India).
- Confirm the number is registered on WhatsApp.

### WhatsApp banning risk
- Keep delays at 5–10 seconds (default).
- Avoid sending to thousands of numbers in one session.
- Do **not** use this tool for spam.

---

## Legal Notice

This tool is intended for legitimate business communications only (e.g., notifying your own customers). Sending unsolicited bulk messages may violate WhatsApp's Terms of Service. Use responsibly.

---

## Contributing

Pull requests are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "feat: add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

[MIT](LICENSE) © 2026 vickyiitp
