# Classroom Multiplayer VR — Setup Guide

A browser-based multiplayer VR classroom with real-time player movement, chat, and WebRTC voice calls using Three.js + Socket.IO.

---

## Quick Start (Node.js only)

**Prerequisites:** Node.js 18+

```bash
cd server
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

For WebXR on a headset, the page must be served over HTTPS. See the HTTPS section below.

---

## Project Structure

```
server/
├── server.js        # Socket.IO server + static file serving
├── package.json
└── public/
    ├── index.html   # Client entry point
    ├── main.js      # Three.js scene, movement, WebRTC
    └── player.js    # Player mesh + interpolation helpers
```

---

## Features

- Real-time multiplayer movement via Socket.IO
- VR support (WebXR) with gamepad/thumbstick movement
- Peer-to-peer voice calls and broadcast via WebRTC
- In-world chat overlay

---

## HTTPS (required for WebXR on headsets)

Browsers require HTTPS for WebXR and microphone access on non-localhost origins. Options:

**Option 1 — ADB reverse port forwarding (easiest, no HTTPS needed):**
```bash
adb reverse tcp:3000 tcp:3000
```
Then open `http://localhost:3000` in the Meta Browser on your headset.

**Option 2 — local self-signed cert:**
```bash
# generate cert (once)
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```
Then update `server.js` to use `https.createServer({ key, cert }, app)` instead of `http.createServer(app)`.