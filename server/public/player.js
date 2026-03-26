// client/player.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";

console.log("player.js module loaded");

// ---------- Shared GLTF cache ----------
const loader = new GLTFLoader();
let cachedGLTF = null;
const pendingCallbacks = [];

loader.load(
  "./character.glb",
  (gltf) => {
    cachedGLTF = gltf;
    console.log(
      "character.glb loaded. Animations:",
      gltf.animations.map((a) => a.name),
    );
    pendingCallbacks.splice(0).forEach((cb) => cb(gltf));
  },
  undefined,
  (err) => {
    console.error(
      "Failed to load character.glb — make sure it is in server/public/",
      err,
    );
  },
);

function whenLoaded(cb) {
  if (cachedGLTF) cb(cachedGLTF);
  else pendingCallbacks.push(cb);
}

// Clone model, attach to pivot, set up AnimationMixer
function attachModel(gltf, pivot) {
  const model = skeletonClone(gltf.scene);
  model.traverse((n) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });

  // Force matrix update so bounding box measurements are accurate
  model.updateMatrixWorld(true);

  // Measure only mesh geometry (bones inflate Box3 if included)
  const rawBox = new THREE.Box3();
  model.traverse((n) => {
    if (n.isMesh || n.isSkinnedMesh) rawBox.expandByObject(n);
  });
  const rawSize = rawBox.getSize(new THREE.Vector3());
  console.log("Model mesh size:", rawSize);

  // Scale to 1.75 m and derive foot offset from the same raw box
  const TARGET_HEIGHT = 1.75;
  const scaleFactor = rawSize.y > 0 ? TARGET_HEIGHT / rawSize.y : 1;
  model.scale.setScalar(scaleFactor);
  // Shift feet to y=0 using the scaled min position
  model.position.y = -rawBox.min.y * scaleFactor;

  // Fix forward direction: rotate model so it faces -Z (Three.js forward).
  // Try Math.PI, Math.PI/2, or -Math.PI/2 if still sideways or backwards.
  model.rotation.y = -Math.PI / 2;

  pivot.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};

  // Enable all actions at weight 0 so there is never a gap that shows T-pose
  gltf.animations.forEach((clip) => {
    const action = mixer.clipAction(clip, model);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.weight = 0;
    action.play();
    actions[clip.name] = action;
  });

  // Start idle at full weight
  if (actions["idel"]) actions["idel"].weight = 1;

  return { mixer, actions };
}

// Cross-fade to a named animation; no-op if already playing
export function switchAnim(player, name, fadeDuration = 0.2) {
  if (!player.actions[name] || player.currentAnim === name) return;
  console.log("switchAnim:", player.currentAnim, "->", name);
  // Set all weights to 0 then target to 1 (direct switch, no fade)
  Object.entries(player.actions).forEach(([n, a]) => {
    a.weight = n === name ? 1 : 0;
  });
  player.currentAnim = name;
}

// ---------- Local player ----------
export function createLocalPlayer(scene, _color) {
  const pivot = new THREE.Object3D();
  pivot.position.set(0, 0, 0);
  scene.add(pivot);

  const player = { mesh: pivot, mixer: null, actions: {}, currentAnim: "idel" };

  whenLoaded((gltf) => {
    const { mixer, actions } = attachModel(gltf, pivot);
    player.mixer = mixer;
    player.actions = actions;
  });

  return player;
}

// ---------- Remote player ----------
export function createRemotePlayer(
  scene,
  id,
  _color,
  position = { x: 0, y: 1.0, z: 0 },
) {
  const pivot = new THREE.Object3D();
  pivot.position.set(position.x, position.y, position.z);
  scene.add(pivot);

  const remote = {
    id,
    mesh: pivot,
    mixer: null,
    actions: {},
    currentAnim: "idel",
    targetPosition: new THREE.Vector3(position.x, position.y, position.z),
    targetQuaternion: new THREE.Quaternion(),
    isMoving: false,
  };

  whenLoaded((gltf) => {
    const { mixer, actions } = attachModel(gltf, pivot);
    remote.mixer = mixer;
    remote.actions = actions;
  });

  return remote;
}

// Called when a socket update is received
export function updateRemoteTarget(remote, state) {
  if (!remote || !state || !state.position) return;
  const newPos = new THREE.Vector3(
    state.position.x,
    state.position.y,
    state.position.z,
  );
  remote.isMoving = remote.targetPosition.distanceTo(newPos) > 0.01;
  remote.targetPosition.copy(newPos);
  if (state.rotation) {
    remote.targetQuaternion.set(
      state.rotation.x,
      state.rotation.y,
      state.rotation.z,
      state.rotation.w,
    );
  }
}

// Smooth interpolation + animation update for all remote players
export function interpolateRemotes(remotes, dt) {
  const smoothing = Math.min(10 * dt, 1.0);
  for (const id in remotes) {
    const r = remotes[id];
    if (!r.mesh || !r.targetPosition) continue;
    r.mesh.position.lerp(r.targetPosition, smoothing);
    if (r.targetQuaternion)
      r.mesh.quaternion.slerp(r.targetQuaternion, smoothing);
    if (r.mixer) {
      switchAnim(r, r.isMoving ? "walk" : "idel");
      r.mixer.update(dt);
    }
  }
}
