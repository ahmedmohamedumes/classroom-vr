// client/main.js
import * as THREE from "three";
import { VRButton } from "three/addons/webxr/VRButton.js";
import { createLocalPlayer, createRemotePlayer, updateRemoteTarget, interpolateRemotes, switchAnim } from "./player.js";

// ---------- Socket.IO ----------
const socket = io(); // ensure this connects to the same origin

// ---------- Scene / Camera / Renderer ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 1.6, 5);

// Create renderer and enable XR BEFORE adding the VRButton
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true; // MUST enable XR before VRButton
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// ---------- Lights ----------
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 0.8);
sun.position.set(5, 10, 5);
sun.castShadow = true;
scene.add(sun);


// ---------- Collision boxes ----------
const collisionBoxes = [];
export function addCollisionBox(minX, minY, minZ, maxX, maxY, maxZ) {
  collisionBoxes.push({
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  });
}

function checkCollision(position, radius = 0.3) {
  const playerBox = {
    min: new THREE.Vector3(position.x - radius, position.y - 0.9, position.z - radius),
    max: new THREE.Vector3(position.x + radius, position.y + 0.9, position.z + radius)
  };
  for (const box of collisionBoxes) {
    const intersects =
      playerBox.min.x <= box.max.x && playerBox.max.x >= box.min.x &&
      playerBox.min.y <= box.max.y && playerBox.max.y >= box.min.y &&
      playerBox.min.z <= box.max.z && playerBox.max.z >= box.min.z;
    if (intersects) return true;
  }
  return false;
}

export function resolveCollision(oldPos, newPos, radius = 0.3) {
  if (!checkCollision(newPos, radius)) return newPos.clone();

  // Try sliding on X
  const testX = new THREE.Vector3(newPos.x, newPos.y, oldPos.z);
  if (!checkCollision(testX, radius)) return testX;

  // Try sliding on Z
  const testZ = new THREE.Vector3(oldPos.x, newPos.y, newPos.z);
  if (!checkCollision(testZ, radius)) return testZ;

  // Step incremental toward newPos
  const dir = new THREE.Vector3().subVectors(newPos, oldPos);
  if (dir.lengthSq() === 0) return oldPos.clone();
  dir.normalize();
  const stepSize = 0.02;
  const maxSteps = Math.ceil(oldPos.distanceTo(newPos) / stepSize);
  let testPos = oldPos.clone();
  for (let i = 0; i < maxSteps; i++) {
    const next = testPos.clone().addScaledVector(dir, stepSize);
    if (!checkCollision(next, radius)) testPos.copy(next);
    else break;
  }
  if (!testPos.equals(oldPos)) return testPos;
  return oldPos.clone();
}

// ---------- Classroom geometry (same as before) ----------
function createClassroom(){
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20,15), new THREE.MeshStandardMaterial({color:0xcccccc}));
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMaterial = new THREE.MeshStandardMaterial({color:0xf5f5dc});
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(20,4,0.2), wallMaterial);
  backWall.position.set(0,2,-7.5); scene.add(backWall); addCollisionBox(-10,0,-7.6,10,4,-7.4);
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(20,4,0.2), wallMaterial);
  frontWall.position.set(0,2,7.5); scene.add(frontWall); addCollisionBox(-10,0,7.4,10,4,7.6);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.2,4,15), wallMaterial);
  leftWall.position.set(-10,2,0); scene.add(leftWall); addCollisionBox(-10.1,0,-7.5,-9.9,4,7.5);
  const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.2,4,15), wallMaterial);
  rightWall.position.set(10,2,0); scene.add(rightWall); addCollisionBox(9.9,0,-7.5,10.1,4,7.5);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(20,15), new THREE.MeshStandardMaterial({color:0xffffff}));
  ceiling.rotation.x = Math.PI/2; ceiling.position.y = 4; scene.add(ceiling);

  const deskMaterial = new THREE.MeshStandardMaterial({color:0x8b4513});
  const teacherDesk = new THREE.Mesh(new THREE.BoxGeometry(2,0.8,1), deskMaterial);
  teacherDesk.position.set(0,0.4,-6); scene.add(teacherDesk); addCollisionBox(-1,0,-6.5,1,0.8,-5.5);

  const positions = [
    [-4,0.4,-2],[0,0.4,-2],[4,0.4,-2],
    [-4,0.4,2],[0,0.4,2],[4,0.4,2],
    [-4,0.4,5],[0,0.4,5],[4,0.4,5]
  ];
  positions.forEach((p)=>{
    const d = new THREE.Mesh(new THREE.BoxGeometry(1.2,0.6,0.8), deskMaterial);
    d.position.set(p[0],p[1],p[2]); d.castShadow=true; scene.add(d);
    addCollisionBox(p[0]-0.6, 0, p[2]-0.4, p[0]+0.6, 0.6, p[2]+0.4);
  });
}
createClassroom();

// ---------- Players ----------
const local = createLocalPlayer(scene, 0x00aa00);
const remotes = {}; // id -> remote

function updatePlayerDropdown() {
  const sel = document.getElementById('player-select');
  if (!sel) return;
  const previous = sel.value;
  sel.innerHTML = '<option value="">Select player</option>';
  Object.keys(remotes).forEach(id => {
    if (id === socket.id) return;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${id.slice(0,6)}`;
    sel.appendChild(opt);
  });
  if (previous) {
    const exists = Array.from(sel.options).some(o => o.value === previous);
    if (exists) sel.value = previous;
  }
}

// Camera follow local (third-person orbit using mouse yaw/pitch)
const CAM_DISTANCE = 4;
const CAM_HEIGHT_OFFSET = 1.6;
function updateCamera() {
  if (renderer.xr.isPresenting) return;

  const sinYaw   = Math.sin(cameraYaw);
  const cosYaw   = Math.cos(cameraYaw);
  const sinPitch = Math.sin(cameraPitch);
  const cosPitch = Math.cos(cameraPitch);

  // Spherical offset: camera sits behind & above player based on yaw/pitch
  const offsetX = CAM_DISTANCE * sinYaw * cosPitch;
  const offsetY = CAM_DISTANCE * sinPitch + CAM_HEIGHT_OFFSET;
  const offsetZ = CAM_DISTANCE * cosYaw * cosPitch;

  const desired = local.mesh.position.clone().add(new THREE.Vector3(offsetX, offsetY, offsetZ));
  // Clamp vertical position inside the room (floor y=0, ceiling y=4)
  desired.y = Math.max(0.8, Math.min(3.85, desired.y));
  camera.position.lerp(desired, 0.15);

  // Look slightly above mesh base (eye level)
  const lookAt = local.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0));
  camera.lookAt(lookAt);
}

// ---------- Keyboard input ----------
const keys = {};
window.addEventListener('keydown', (e)=>keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', (e)=>keys[e.key.toLowerCase()] = false);

// ---------- Mouse look (Pointer Lock) ----------
let cameraYaw = Math.PI;   // start facing into the room (toward -Z)
let cameraPitch = 0.2;     // slight downward tilt
const MOUSE_SENSITIVITY = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting) renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  cameraYaw   -= e.movementX * MOUSE_SENSITIVITY;
  cameraPitch -= e.movementY * MOUSE_SENSITIVITY;
  cameraPitch  = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraPitch));
});

// ---------- Networking (Socket.IO handlers) ----------
socket.on("connect", () => {
  console.log("socket connected", socket.id);
});
socket.on("currentPlayers", (players) => {
  Object.entries(players).forEach(([id, p]) => {
    if (id === socket.id) {
      local.mesh.position.set(p.position.x, p.position.y || 1.0, p.position.z);
    } else {
      if (!remotes[id]) remotes[id] = createRemotePlayer(scene, id, 0xff0000, p.position);
    }
  });
  updatePlayerDropdown();
});
socket.on("newPlayer", (p) => {
  if (p.id === socket.id) return;
  if (!remotes[p.id]) remotes[p.id] = createRemotePlayer(scene, p.id, 0xff0000, p.position);
  updatePlayerDropdown();
});
socket.on("playerMoved", ({ id, state }) => {
  if (id === socket.id) return;
  if (!remotes[id]) remotes[id] = createRemotePlayer(scene, id, 0xff0000, state.position);
  updateRemoteTarget(remotes[id], state);
});
socket.on("playerDisconnected", (id) => {
  if (remotes[id]) {
    scene.remove(remotes[id].mesh);
    delete remotes[id];
    if (audioElements[id]) {
      try { audioElements[id].srcObject = null; audioElements[id].remove(); } catch(e){}
      delete audioElements[id];
    }
    if (peerConnections[id]) {
      try { peerConnections[id].close(); } catch(e){}
      delete peerConnections[id];
    }
    if (peersShareLocal[id]) {
      delete peersShareLocal[id];
      localSharedCount = Math.max(0, localSharedCount - 1);
      if (localSharedCount <= 0 && localStream) {
        try { for (const t of localStream.getTracks()) t.stop(); } catch(e){}
        localStream = null;
      }
    }
    updatePlayerDropdown();
    updateActiveCallsDisplay();
  }
});

// chat (optional; safe-guard DOM presence)
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim()) {
      socket.emit('chatMessage', chatInput.value.trim());
      chatInput.value = '';
    }
  });
  socket.on('chatMessage', ({ id, message }) => {
    const el = document.createElement('div');
    el.textContent = `${id.slice(0,6)}: ${message}`;
    chatMessages?.appendChild(el);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  });
}

// ----------------- WebRTC audio (peer connections + signaling) -----------------
const peerConnections = {}; // remoteId -> RTCPeerConnection
const audioElements = {};   // remoteId -> HTMLAudioElement
let localStream = null;
const peersShareLocal = {}; // remoteId -> bool (did we add local tracks to this pc)
let localSharedCount = 0;    // how many PCs have our local tracks
const pendingCandidates = {}; // remoteId -> [candidate] (buffered before setRemoteDescription)
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function getLocalStream() {
  if (localStream) return localStream;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    const msg = 'getUserMedia not available. Serve over HTTPS or use a modern browser.';
    console.warn(msg, navigator.mediaDevices);
    throw new TypeError(msg);
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return localStream;
  } catch (err) {
    console.warn('Microphone access denied or unavailable', err);
    throw err;
  }
}

function ensureAudioElement(id) {
  if (audioElements[id]) return audioElements[id];
  const a = document.createElement('audio');
  a.autoplay = true;
  a.playsInline = true;
  a.id = `audio-${id}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  audioElements[id] = a;
  return a;
}

async function createPeerConnection(remoteId, shareLocal = false) {
  if (peerConnections[remoteId]) return peerConnections[remoteId];
  const pc = new RTCPeerConnection(pcConfig);
  // Store immediately so ICE candidates arriving during async getUserMedia are not dropped
  peerConnections[remoteId] = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('webrtc-ice-candidate', { to: remoteId, candidate: e.candidate });
    }
  };

  pc.ontrack = (e) => {
    const el = ensureAudioElement(remoteId);
    el.srcObject = e.streams[0];
    el.play().catch(() => {});
    const active = document.getElementById('active-calls');
    if (active) active.textContent = Object.keys(peerConnections).join(', ');
  };

  if (shareLocal) {
    try {
      const s = await getLocalStream();
      for (const t of s.getAudioTracks()) pc.addTrack(t, s);
      peersShareLocal[remoteId] = true;
      localSharedCount++;
    } catch (e) {
      console.warn('Unable to add local tracks', e);
    }
  }

  return pc;
}

async function flushPendingCandidates(remoteId) {
  const pc = peerConnections[remoteId];
  const queue = pendingCandidates[remoteId];
  if (!pc || !queue) return;
  delete pendingCandidates[remoteId];
  for (const c of queue) {
    try { await pc.addIceCandidate(c); } catch (e) {}
  }
}

function updateActiveCallsDisplay() {
  const active = document.getElementById('active-calls');
  if (!active) return;
  const ids = Object.keys(peerConnections);
  active.textContent = ids.length ? `Active: ${ids.map(i=>i.slice(0,6)).join(', ')}` : 'No active calls';
}

function hangupPeer(remoteId) {
  if (!remoteId) return;
  if (peerConnections[remoteId]) {
    try { peerConnections[remoteId].close(); } catch (e) {}
    delete peerConnections[remoteId];
  }
  if (audioElements[remoteId]) {
    try { audioElements[remoteId].srcObject = null; audioElements[remoteId].remove(); } catch(e){}
    delete audioElements[remoteId];
  }
  if (peersShareLocal[remoteId]) {
    delete peersShareLocal[remoteId];
    localSharedCount = Math.max(0, localSharedCount - 1);
  }
  // If no peers are using our mic, stop local tracks
  if (localSharedCount <= 0 && localStream) {
    try {
      for (const t of localStream.getTracks()) t.stop();
    } catch (e) {}
    localStream = null;
  }
  updateActiveCallsDisplay();
}

function hangupAll() {
  const ids = Object.keys(peerConnections);
  for (const id of ids) hangupPeer(id);
}

async function startCallToPeer(targetId) {
  if (!targetId) return;
  if (targetId === socket.id) return alert('Cannot call yourself');
  const pc = await createPeerConnection(targetId, true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { to: targetId, offer: pc.localDescription });
}

async function broadcastVoiceToAll() {
  const targets = Object.keys(remotes).filter(id => id !== socket.id);
  if (targets.length === 0) return alert('No other players to broadcast to');
  try {
    await getLocalStream();
  } catch (e) {
    return alert('Microphone access required to broadcast');
  }
  for (const t of targets) {
    // create pc and send offer (shareLocal true)
    const pc = await createPeerConnection(t, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { to: t, offer: pc.localDescription });
  }
}

// Signaling handlers
socket.on('webrtc-offer', async ({ from, offer }) => {
  // Incoming offer from another peer
  const short = from?.slice ? from.slice(0,6) : from;
  const accept = confirm(`Incoming audio call from ${short}. Accept and share mic? Cancel to receive-only.`);
  const share = accept; // if user accepts, also share mic; otherwise receive-only
  const pc = await createPeerConnection(from, share);
  try {
    await pc.setRemoteDescription(offer);
    await flushPendingCandidates(from);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { to: from, answer: pc.localDescription });
  } catch (e) {
    console.error('Error handling incoming offer', e);
  }
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  const pc = peerConnections[from];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(answer);
    await flushPendingCandidates(from);
  } catch (e) {
    console.warn('Failed to set remote description from answer', e);
  }
});

socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
  if (!candidate) return;
  const pc = peerConnections[from];
  if (!pc) return;
  // Buffer if remote description not yet set; flush happens after setRemoteDescription
  if (!pc.remoteDescription) {
    if (!pendingCandidates[from]) pendingCandidates[from] = [];
    pendingCandidates[from].push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn('Failed to add ICE candidate', e);
  }
});

// UI hooks
const callBtn = document.getElementById('call-peer');
const broadcastBtn = document.getElementById('broadcast-voice');
const hangupBtn = document.getElementById('hangup-peer');
const hangupAllBtn = document.getElementById('hangup-all');
if (callBtn) {
  callBtn.addEventListener('click', async () => {
    const sel = document.getElementById('player-select');
    if (!sel) return alert('Player list not available');
    const target = sel.value;
    if (!target) return alert('Select a player first');
    await startCallToPeer(target);
  });
}
if (broadcastBtn) {
  broadcastBtn.addEventListener('click', async () => {
    if (!confirm('Start broadcasting your microphone to all players?')) return;
    await broadcastVoiceToAll();
  });
}
if (hangupBtn) {
  hangupBtn.addEventListener('click', async () => {
    const sel = document.getElementById('player-select');
    if (!sel) return alert('Player list not available');
    const target = sel.value;
    if (!target) return alert('Select a player first');
    hangupPeer(target);
  });
}
if (hangupAllBtn) {
  hangupAllBtn.addEventListener('click', async () => {
    if (!confirm('Hang up all active calls?')) return;
    hangupAll();
  });
}

// ---------- Send movement updates at 20Hz ----------
let lastSent = 0;
const sendInterval = 1000 / 20;
function trySendState(now) {
  if (now - lastSent < sendInterval) return;
  lastSent = now;
  const state = {
    position: { x: local.mesh.position.x, y: local.mesh.position.y, z: local.mesh.position.z },
    rotation: { x: local.mesh.quaternion.x, y: local.mesh.quaternion.y, z: local.mesh.quaternion.z, w: local.mesh.quaternion.w }
  };
  socket.emit('playerMoved', state);
}

// ---------- WebXR Gamepad handling (called inside XR frame) ----------
/**
 * Read gamepad axes for a given XRInputSource.gamepad.
 * Oculus/most controllers often put thumbstick at axes[2]/axes[3] for WebXR,
 * but some environments use axes[0]/axes[1]. We detect the best pair:
 */
function readGamepadAxes(gp) {
  if (!gp || !gp.axes) return { x: 0, y: 0 };

  // if axes length >= 4, common mapping: [0,1] trigger, [2,3] thumbstick
  if (gp.axes.length >= 4) {
    return { x: gp.axes[2] || 0, y: gp.axes[3] || 0 };
  }
  // fallback to first pair
  return { x: gp.axes[0] || 0, y: gp.axes[1] || 0 };
}

/**
 * Build a movement vector reading all XR inputSources' gamepads.
 * frame is the XRFrame passed into setAnimationLoop; use renderer.xr.getSession() as well.
 */
function getXRMovementFromFrame(frame) {
  const session = renderer.xr.getSession();
  const move = new THREE.Vector3();
  if (!session || !frame) return move;

  for (const inputSource of session.inputSources) {
    if (!inputSource.gamepad) continue;
    // read axes robustly
    const gp = inputSource.gamepad;
    const axes = readGamepadAxes(gp);
    // Note: on many Oculus setups pushing forward gives negative y; invert if you prefer forward negative:
    // We'll interpret forward as negative Y axis (so z -= value), but many devs prefer invert; adjust as needed.
    move.x += axes.x;
    move.z += axes.y; // treat y-axis as forward/back (positive -> move forward in this code)
  }

  if (move.length() > 1) move.normalize();
  return move;
}

// ---------- Movement function (keyboard + XR joystick) ----------
function applyLocalMovement(dt, xrFrame = null) {
  const speed = 2.5; // m/s
  const dir = new THREE.Vector3();

  // Keyboard (PC) — camera-relative so W always moves toward where you're looking
  const forward = new THREE.Vector3(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
  const right   = new THREE.Vector3( Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
  if (keys['w']) dir.add(forward);
  if (keys['s']) dir.sub(forward);
  if (keys['a']) dir.sub(right);
  if (keys['d']) dir.add(right);

  // XR joystick (only if we're in an XR frame)
  if (xrFrame) {
    const xrMove = getXRMovementFromFrame(xrFrame);
    dir.add(xrMove);
  } else {
    // If renderer.xr.isPresenting is true but no frame passed, we can still try to read session inputSources (less ideal)
    if (renderer.xr.isPresenting) {
      const session = renderer.xr.getSession();
      if (session) {
        // sum axes (no frame context)
        for (const inputSource of session.inputSources) {
          if (!inputSource.gamepad) continue;
          const gp = inputSource.gamepad;
          const axes = readGamepadAxes(gp);
          dir.x += axes.x;
          dir.z += axes.y;
        }
      }
    }
  }

  if (dir.lengthSq() > 0) dir.normalize();

  // Apply world-relative movement (not camera-relative). To make camera-relative,
  // transform dir by the headset yaw (project camera forward onto XZ plane).
  const proposed = local.mesh.position.clone().addScaledVector(dir, speed * dt);

  // Resolve collisions before applying
  const resolved = resolveCollision(local.mesh.position, proposed);
  local.mesh.position.copy(resolved);

  // Rotate character to face movement direction
  if (dir.lengthSq() > 0) {
    local.mesh.rotation.y = Math.atan2(dir.x, dir.z);
  }

  // Only lock Y when not presenting in XR: in XR the headset controls view height.
  if (!renderer.xr.isPresenting) {
    local.mesh.position.y = 0;
  }

  return dir.lengthSq() > 0;
}

// ---------- Animation / render loop ----------
const clock = new THREE.Clock();

// Use Three.js renderer.setAnimationLoop which provides an XRFrame when in XR session.
// The callback receives (time, xrFrame) — pass xrFrame to movement so gamepads read correctly.
renderer.setAnimationLoop((time, xrFrame) => {
  const dt = clock.getDelta();

  // apply movement with xrFrame (if present)
  const moving = applyLocalMovement(dt, xrFrame);

  // local player animation
  if (local.mixer) {
    switchAnim(local, moving ? 'walk' : 'idel');
    local.mixer.update(dt);
  }

  updateCamera();
  trySendState(performance.now());
  interpolateRemotes(remotes, dt);

  renderer.render(scene, camera);
});

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
