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
- `index.html` — Entry point. Declares a Three.js import map (maps `"three"` and `"three/addons/"` to `cdn.jsdelivr.net`), loads Socket.IO from CDN, then imports `main.js` as an ES module.
- `main.js` — Core client logic. Sets up the Three.js scene (renderer, camera, lights, classroom geometry, collision boxes), handles keyboard + mouse look input, sends position updates at 20 Hz, manages WebRTC peer connections for voice calls (using Google STUN), and wires up all Socket.IO event handlers.
- `player.js` — Loads `character.glb` via GLTFLoader (cached, cloned per player with SkeletonUtils), auto-scales to 1.75 m, drives idle/walk animations via AnimationMixer, and handles smooth interpolation of remote player positions/rotations.
- `character.glb` — The 3D character model with two NLA animations: `idel` and `walk` (exported from Blender with Mixamo rig).

**Client dependencies are loaded from CDN via import map** (no bundler):
- Three.js r164.0 — `"three"` and `"three/addons/"` mapped in `index.html`
- Socket.IO 4.7.5 via `cdn.socket.io`

## Key Patterns

**Mouse look:** Pointer Lock API — click canvas to lock pointer. `cameraYaw` and `cameraPitch` are updated on `mousemove`. Camera orbits around the player pivot using spherical coordinates. Camera Y is clamped between 0.8 and 3.85 to stay inside the room. Keyboard movement is camera-relative (W always moves toward where you're looking).

**Character model:** `player.js` loads `character.glb` once and clones it per player using `SkeletonUtils.clone`. Auto-scales to 1.75 m by measuring mesh-only bounding box (bones are excluded to avoid inflating the box). Model is rotated `Math.PI / 2` (or `-Math.PI / 2`) on Y to align its forward axis with Three.js `-Z` forward. The player pivot sits at `y=0` (floor level); the model's feet are positioned at `y=0` of the pivot.

**Animation:** All AnimationActions are initialized at `weight=0` and playing, preventing T-pose bleed during crossfades. `switchAnim` directly sets weights (1 for target, 0 for all others). `idel` plays at rest; `walk` plays while any WASD key is held. Remote players auto-switch based on whether their target position changed.

**WebRTC flow:** `peerConnections` map stores `RTCPeerConnection` per remote player id. ICE candidates arriving before `setRemoteDescription` are buffered in `pendingCandidates` and flushed after the remote description is set. The server relays all signaling messages (never sees media).

**Collision:** `addCollisionBox` registers AABB boxes (walls, desks). `resolveCollision` slides the player along X or Z axes when a collision is detected, with incremental stepping as fallback.

**XR support:** `renderer.xr.enabled = true` must be set before `VRButton.createButton`. The animation loop uses `renderer.setAnimationLoop((time, xrFrame) => {...})` to receive the XR frame for correct gamepad reads.

**HTTPS requirement:** WebXR and microphone access require HTTPS on non-localhost. Use ADB reverse port forwarding (`adb reverse tcp:3000 tcp:3000`) for local testing, or swap to `https.createServer` with a self-signed cert in `server.js`.

## Character Model Pipeline (Blender → Mixamo → Three.js)

1. Model in Blender: Z-up, character faces -Y (front view), origin at feet center, ~1.75 m tall
2. Export FBX: Forward `-Z`, Up `Z`
3. Upload to Mixamo → auto-rig → download T-pose with skin as `character_base.fbx`
4. Download animations without skin: `idle.fbx`, `walk.fbx`
5. In Blender: import walk action onto student armature via Action Editor → push down to NLA → rename strip to `walk`
6. NLA editor must have exactly two strips: `idel` and `walk` (delete any `t-pose` or extra tracks)
7. Export GLB: NLA Tracks ✓, Y Up ✓ → `server/public/character.glb`
8. Animation names in Three.js must exactly match strings used in code: `'idel'` and `'walk'`
