# Credential Matrix Tester

Test multiple User IDs against multiple Passwords on a live login page using real browser automation.

> **Ethical Use Only**: This tool is intended for authorized security testing, penetration testing on systems you own, or systems you have explicit written permission to test. Unauthorized use against third-party systems may violate laws and terms of service.

## Features

- **Matrix Testing** — Every User ID x Every Password combination
- **Real Browser Automation** — Uses Puppeteer (headless Chromium)
- **Smart Success Detection** — Detects login success/failure via URL, content, and DOM indicators
- **Export Results** — Download as CSV or styled Excel (.xlsx)
- **Clean Web UI** — Modern responsive interface with live progress
- **Custom Selectors** — Configure CSS selectors for any login form
- **Cloud Ready** — Dockerfile + Render blueprint included

## Project Structure

```
credential-matrix-tester/
├── server.js          # Express backend with Puppeteer
├── package.json       # Dependencies
├── public/
│   └── index.html     # Frontend UI
├── exports/           # Generated CSV/Excel files (auto-created)
├── Dockerfile         # Docker image for any cloud provider
├── render.yaml        # One-click deploy to Render
├── .env.example       # Environment variables template
├── .gitignore
└── README.md
```

## Requirements

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)
- npm (comes with Node.js)
- ~500MB free space (for Puppeteer's Chromium download)

## Quick Start (Local)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/credential-matrix-tester.git
cd credential-matrix-tester
npm install
```

This downloads Puppeteer and its bundled Chromium browser automatically.

### 2. Configure environment (optional)

```bash
cp .env.example .env
# Edit .env if you want to change PORT or MAX_COMBINATIONS
```

### 3. Start the server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### 4. Open in browser

Navigate to: **http://localhost:3000**

---

## Deploy to Render (Recommended)

1. Fork this repository to your GitHub account.
2. Go to [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
3. Connect your GitHub repo and click **Apply**.
4. Render will build the Docker image and deploy automatically.

> **Note**: Render's free tier has limited RAM. For large tests, use the Standard plan or reduce your wordlists.

---

## Deploy with Docker

```bash
docker build -t credential-tester .
docker run -p 3000:3000 credential-tester
```

Then open http://localhost:3000.

---

## Deploy to Railway / Fly.io / VPS

1. Push this repo to GitHub.
2. Connect your GitHub repo to the platform.
3. Set the **build command**: `npm install`
4. Set the **start command**: `npm start`
5. Ensure the platform has enough RAM (Chromium needs ~300-500MB).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MAX_COMBINATIONS` | `1000` | Maximum ID x Password combos per request (protects server) |

Create a `.env` file to override:

```env
PORT=8080
MAX_COMBINATIONS=500
```

---

## Usage

1. **Enter the Login Page URL** — The full URL of the login form you want to test.
2. **Configure Selectors** (optional) — CSS selectors for the username, password, and submit fields. Defaults work for most standard login forms.
3. **Paste User IDs** — One per line.
4. **Paste Passwords** — One per line.
5. **Click "Test All Combinations"** — The server will test every combination sequentially.
6. **Review Results** — See stats, individual results, and successful logins highlighted.
7. **Export** — Download results as CSV or Excel.

---

## How It Works

The backend uses **Puppeteer** to:
1. Launch a headless Chromium browser (once per test batch)
2. Navigate to the target login page
3. Attempt each credential pair by typing into form fields
4. Detect success/failure by analyzing:
   - URL changes (e.g., redirect to `/dashboard`)
   - Page content keywords (e.g., "welcome", "incorrect password")
   - Error DOM elements (`.error`, `.alert-danger`, etc.)
5. Return structured results to the frontend

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Puppeteer fails to launch | Ensure you have enough RAM. On Linux servers, install Chromium dependencies (see Dockerfile) |
| Login form not detected | Customize the CSS selectors in the UI to match your target form |
| Rate limiting / blocking | Increase the delay between requests in `server.js` (currently 300ms) |
| Export files not downloading | Check that the `exports/` directory exists and is writable |
| "Too many combinations" | Reduce your wordlists or increase `MAX_COMBINATIONS` env var |

---

## Publishing to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/credential-matrix-tester.git
git push -u origin main
```

Add topics/tags like `security`, `puppeteer`, `penetration-testing`, `nodejs`.

---

## License

MIT — Use responsibly and only on systems you have permission to test.
