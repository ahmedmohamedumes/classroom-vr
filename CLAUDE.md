# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
cd server && npm install

# Run the server (serves on http://localhost:3000)
cd server && npm start
```

There is no build step, linter, or test suite configured.

## Architecture

A browser-based multiplayer VR classroom. The server serves static client files and acts as a Socket.IO signaling relay. All rendering and game logic runs entirely in the browser.

**Server (`server/server.js`):** Express static file server + Socket.IO hub. Maintains an in-memory `players` map (socket id → position/rotation). Relays `playerMoved`, `chatMessage`, and WebRTC signaling events (`webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`) between clients. Uses ES modules (`"type": "module"`).

**Client (`server/public/`):**
- `index.html` — Entry point. Loads Socket.IO from CDN, then imports `main.js` as an ES module.
- `main.js` — Core client logic. Sets up the Three.js scene (renderer, camera, lights, classroom geometry, collision boxes), handles keyboard/WebXR gamepad input, sends position updates at 20 Hz, manages WebRTC peer connections for voice calls (using Google STUN), and wires up all Socket.IO event handlers.
- `player.js` — Creates Three.js capsule meshes for local/remote players and handles smooth interpolation of remote player positions/rotations via `lerp`/`slerp`.

**Client dependencies are loaded from CDN** (no bundler):
- Three.js r0.164.0 via `cdn.jsdelivr.net`
- Socket.IO 4.7.5 via `cdn.socket.io`

## Key Patterns

**WebRTC flow:** `peerConnections` map stores `RTCPeerConnection` per remote player id. ICE candidates arriving before `setRemoteDescription` are buffered in `pendingCandidates` and flushed after the remote description is set. The server relays all signaling messages (never sees media).

**Collision:** `addCollisionBox` registers AABB boxes (walls, desks). `resolveCollision` slides the player along X or Z axes when a collision is detected, with incremental stepping as fallback.

**XR support:** `renderer.xr.enabled = true` must be set before `VRButton.createButton`. The animation loop uses `renderer.setAnimationLoop((time, xrFrame) => {...})` to receive the XR frame for correct gamepad reads.

**HTTPS requirement:** WebXR and microphone access require HTTPS on non-localhost. Use ngrok or swap to `https.createServer` with a self-signed cert in `server.js`.
