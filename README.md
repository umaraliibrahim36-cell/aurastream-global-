# AuraStream — Live Streaming & Creator Platform

A full-stack build of the AuraStream website: a Node.js backend with real user
accounts, channels, video upload, live streaming and **Paystack** payments, the
existing web UI wired to that backend, plus an **Android app** (WebView wrapper)
with a GitHub Actions pipeline that builds signed APKs.

```
aurastream/
  server/      Node.js + Express API, SQLite DB, website, live streaming
  android/     Android WebView app (Kotlin)
  .github/     GitHub Actions workflow that builds the APK
```

## 1. Backend server

### Requirements
- Node.js 16+ (18/20 recommended)
- `ffmpeg` only if you want the *optional* OBS/RTMP ingest path. The default
  in-browser “Go Live” needs **no ffmpeg and no OBS**.

### Setup
```bash
cd server
npm install
cp .env.example .env      # then edit .env
npm start                 # http://localhost:4000
```

On first run the database is created and seeded with sample content, plans and a
Super Admin account:

- **admin@aurastream.global** / **ChangeMe!2026**  — change the password after logging in.

### Configure Paystack
Get your keys from the Paystack dashboard (Settings → API Keys & Webhooks) and put
them in `.env`:
```
PAYSTACK_SECRET_KEY=sk_test_xxx
PAYSTACK_PUBLIC_KEY=pk_test_xxx
```
In the Paystack dashboard set the **webhook URL** to:
```
https://your-domain.com/api/payments/webhook
```
Until keys are set, paid plans are disabled but everything else (free plan,
accounts, uploads, live) works.

### What the server provides
| Feature | How |
|---|---|
| Accounts | `POST /api/auth/register`, `/login`, `/logout`, `/me` (JWT + bcrypt) |
| Security | Helmet CSP, rate limiting, httpOnly cookie + Bearer token, role guards |
| Channels | `POST /api/channels` — any logged-in creator can make one |
| Video upload | `POST /api/content/upload` (multipart) — creators only, goes to a moderation queue, plays from `/uploads/...` once approved |
| Live (browser) | **Default.** Camera → `WebSocket /ws/live` relay → viewers watch via Media Source Extensions. No OBS/ffmpeg. |
| Live (OBS) | Optional pro path: push RTMP to `rtmp://host:1935/live/<stream_key>`, viewers watch HLS at `/live/<key>/index.m3u8` (needs ffmpeg) |
| Payments | `POST /api/payments/initialize` + `/verify` + `/webhook` (Paystack) |
| Admin | `/api/admin/*` — stats, user & plan management, moderation, activity log |

### Going live (broadcasters)
The real, zero-setup way: open **Creator Studio → New channel → Go live**. The
browser asks for camera & microphone, then streams straight to viewers. What your
camera sees, viewers on the **Live TV** page see a couple of seconds later. This
works in Chrome, Edge, modern mobile browsers and the Android app — no OBS, no
ffmpeg, no stream keys.

Prefer a studio setup? Each channel also exposes an **OBS/RTMP** server URL and
stream key (under “Advanced” on the channel card) that viewers watch over HLS.
That path needs `ffmpeg` on the host.

## 2. Website
Served at `/` by the same server. It is a real single-page app (`public/index.html`
+ `public/app.js`) wired to the backend: clear sign in / sign up, a live content
library that plays uploaded videos, Creator Studio (create channel, upload,
in-browser Go Live), Live TV, Paystack checkout, profile/billing, and an admin
console. Nothing is a mock — every screen reads and writes the real API.

## 3. Android app
A WebView wrapper in `android/` that loads your server, with:
- file picker + camera/mic permissions so **video upload and going live work from the phone**
- pull-to-refresh, back-navigation, a JS bridge (`AndroidBridge`), and a Settings
  screen to point the app at your server URL.

### Set your server URL
Edit `android/app/build.gradle` → `DEFAULT_SERVER_URL`, or set it in-app under
Settings. For the Android emulator talking to a local server use
`http://10.0.2.2:4000`.

### Build locally
```bash
cd android
gradle wrapper --gradle-version 8.9   # first time only, creates ./gradlew
./gradlew assembleDebug                # app/build/outputs/apk/debug/
```

### CI/CD (GitHub Actions)
`.github/workflows/android.yml` builds a debug APK on every push and a **signed
release APK** when these repository secrets are set:

| Secret | Meaning |
|---|---|
| `KEYSTORE_BASE64` | Your keystore, base64-encoded (`base64 -w0 my.keystore`) |
| `KEYSTORE_PASSWORD` | Keystore password |
| `KEY_ALIAS` | Key alias |
| `KEY_PASSWORD` | Key password |

Pushing a tag like `v1.0` also attaches the APKs to a GitHub Release.
APKs are always available as workflow artifacts.

## Security notes
- Passwords are hashed with bcrypt; sessions use signed JWTs.
- Auth endpoints are rate-limited against brute force.
- The Paystack webhook verifies the `x-paystack-signature` HMAC before trusting it.
- Serve the site over **HTTPS** in production and keep `PAYSTACK_SECRET_KEY` server-side only.
- Change the seeded admin password immediately.

## Deploy checklist
1. Host the `server/` on a VM/container with a domain + HTTPS (nginx/Caddy in front).
2. Set a strong `JWT_SECRET` and real Paystack keys in `.env`.
3. (Optional) Open the RTMP port (1935) and install `ffmpeg` only if you want the
   OBS ingest path — the default in-browser Go Live works without it.
4. Point the Android app's `DEFAULT_SERVER_URL` at your domain and ship the APK.
