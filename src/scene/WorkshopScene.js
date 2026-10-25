import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { asset } from '../paths.js';

// A small, fixed-camera workshop. Coordinates: +X right, +Y up, +Z front.
const COLORS = {
  lavender: 0xb9c1b5, violet: 0x607264, mint: 0xc7d0bf,
  white: 0xfffefb, wood: 0xcdbb9f, ink: 0x454942, pink: 0xd6c7b6,
};
const REACTIONS = { nod: '✨', clap: '👏', raise: '❓' };
const clamp = THREE.MathUtils.clamp;
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

export function createWorkshopScene(container, { onMove, onReady } = {}) {
  let disposed = false;
  let elapsed = 0;
  let raf = 0;
  let previousTime = performance.now();
  let modelTimer = 0;
  let modelLoaded = false;
  let playerName = 'You';
  let language = 'en';
  let meetingMode = false;
  let localParticipantId = null;
  let localSpawnAppliedFor = null;
  let viewMode = 'follow';
  let viewZoom = 1;
  let wasMoving = false;
  let moveNoticeAt = -1;
  const ownedTextures = new Set();
  const ownedMaterials = new Set();
  const ownedGeometries = new Set();
  const ownedSkeletons = new Set();
  const mixers = new Set();
  const remoteActors = new Map();
  const modelCache = new Map();
  const modelLoads = new Map();
  const keys = new Set();
  const abortController = new AbortController();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xefeee9);
  const camera = new THREE.OrthographicCamera(-6, 6, 5, -5, 0.1, 80);
  const cameraTarget = new THREE.Vector3(0.05, 1.0, 2.05);
  const cameraOffset = new THREE.Vector3(10, 11.45, 13);
  const desiredCameraTarget = new THREE.Vector3();
  camera.position.copy(cameraTarget).add(cameraOffset);
  camera.lookAt(cameraTarget);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D workshop. Click the floor or use WASD and arrow keys to move.');
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.cursor = 'crosshair';
  container.appendChild(renderer.domElement);

  const registerGeometry = (geometry) => { ownedGeometries.add(geometry); return geometry; };
  const material = (color, options = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.77, metalness: 0, ...options });
    ownedMaterials.add(value);
    return value;
  };
  const mats = Object.fromEntries(Object.entries(COLORS).map(([key, value]) => [key, material(value)]));
  const mesh = (geometry, mat, parent, x, y, z) => {
    const value = new THREE.Mesh(registerGeometry(geometry), mat);
    value.position.set(x, y, z);
    value.castShadow = true;
    value.receiveShadow = true;
    parent.add(value);
    return value;
  };
  const box = (parent, w, h, d, mat, x, y, z, radius = 0.07) => mesh(
    new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, w / 2, h / 2, d / 2)), mat, parent, x, y, z,
  );
  const sphere = (parent, radius, mat, x, y, z) => mesh(new THREE.SphereGeometry(radius, 20, 12), mat, parent, x, y, z);
  const cylinder = (parent, top, bottom, height, mat, x, y, z) => mesh(
    new THREE.CylinderGeometry(top, bottom, height, 32), mat, parent, x, y, z,
  );
  const canvasTexture = (width, height, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.add(texture);
    return texture;
  };
  const sprite = (texture, width, height) => {
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    ownedMaterials.add(mat);
    const value = new THREE.Sprite(mat);
    value.scale.set(width, height, 1);
    value.renderOrder = 9;
    return value;
  };
  const roundedPath = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d6cb, 2.1));
  const sun = new THREE.DirectionalLight(0xfff7e8, 3.1);
  sun.position.set(-5, 11, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 35 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xf0f2ec, 1.25);
  fill.position.set(7, 6, -4);
  scene.add(fill);
  const workshop = new THREE.Group();
  scene.add(workshop);

  // Open diorama: low edges keep every person and gesture visible.
  box(workshop, 9.25, 0.34, 7.25, material(0xd4cec1), 0, -0.24, 0, 0.22);
  box(workshop, 9.1, 0.16, 7.1, mats.white, 0, -0.045, 0, 0.18);
  box(workshop, 8.8, 0.04, 6.8, material(0xe6e0d4), 0, 0.045, 0, 0.15);
  // A few quiet inlaid floor seams give the room an architectural scale.
  const seamMat = material(0xd6d0c5);
  for (let x = -3.2; x <= 3.3; x += 1.1) box(workshop, 0.012, 0.003, 6.4, seamMat, x, 0.067, 0, 0.001);
  const rug = cylinder(workshop, 2.6, 2.6, 0.028, mats.mint, -0.35, 0.083, -0.05);
  rug.scale.z = 0.74;
  const rugEdge = cylinder(workshop, 2.67, 2.67, 0.015, material(0xdadfd3), -0.35, 0.075, -0.05);
  rugEdge.scale.z = 0.74;

  // The shared work table anchors the composition.
  const table = new THREE.Group();
  table.position.set(-0.45, 0, -0.45);
  workshop.add(table);
  box(table, 3.55, 0.18, 1.55, mats.white, 0, 0.94, 0, 0.15);
  box(table, 3.4, 0.075, 1.42, mats.wood, 0, 0.825, 0, 0.04);
  for (const x of [-1.35, 1.35]) {
    box(table, 0.17, 0.74, 1.1, mats.wood, x, 0.44, 0, 0.06);
    box(table, 0.56, 0.1, 1.25, mats.wood, x, 0.115, 0, 0.04);
  }
  function laptop(parent, x, z, rotation, color = 0xbbbfb8) {
    const group = new THREE.Group();
    group.position.set(x, 1.045, z);
    group.rotation.y = rotation;
    parent.add(group);
    box(group, 0.62, 0.035, 0.43, material(color), 0, 0, 0, 0.02);
    const screen = box(group, 0.62, 0.4, 0.035, material(color), 0, 0.2, -0.19, 0.025);
    screen.rotation.x = -0.13;
    const display = box(group, 0.54, 0.31, 0.012, material(0xe7f4ee, { emissive: 0xbcdacb, emissiveIntensity: 0.1 }), 0, 0.21, -0.165, 0.015);
    display.rotation.x = -0.13;
    box(group, 0.3, 0.022, 0.012, mats.mint, -0.05, 0.26, -0.137, 0.004);
    box(group, 0.2, 0.018, 0.012, mats.lavender, -0.1, 0.2, -0.145, 0.004);
    box(group, 0.46, 0.006, 0.19, material(0xd9dcd5), 0, 0.023, -0.03, 0.01);
  }
  laptop(table, -1.03, 0.16, 0.05);
  laptop(table, 0.96, -0.16, Math.PI, 0xb5cec5);
  box(table, 0.47, 0.04, 0.56, material(0xe8c596), 0.1, 1.06, 0.2, 0.025);
  box(table, 0.43, 0.008, 0.51, mats.white, 0.1, 1.085, 0.2, 0.018);
  for (let i = 0; i < 3; i++) box(table, 0.26, 0.004, 0.009, mats.mint, 0.08, 1.091, 0.09 + i * 0.065, 0.001);
  box(table, 0.055, 0.035, 0.37, mats.violet, 0.45, 1.06, 0.2, 0.018).rotation.y = 0.3;
  function mug(parent, x, y, z, color) {
    const mat = material(color);
    cylinder(parent, 0.105, 0.09, 0.2, mat, x, y + 0.1, z);
    cylinder(parent, 0.081, 0.081, 0.012, material(0x775443), x, y + 0.201, z);
    const handle = mesh(new THREE.TorusGeometry(0.07, 0.023, 8, 20), mat, parent, x + 0.12, y + 0.12, z);
    handle.rotation.y = 0;
  }
  mug(table, -0.52, 1.035, -0.28, 0xd4c5b6);
  mug(table, 1.45, 1.035, 0.35, 0xb3cebf);
  function stool(x, z, color) {
    cylinder(workshop, 0.34, 0.34, 0.15, material(color), x, 0.58, z);
    for (const [dx, dz] of [[-0.2, -0.15], [0.2, -0.15], [0, 0.21]]) {
      box(workshop, 0.07, 0.45, 0.07, mats.wood, x + dx, 0.3, z + dz, 0.025);
    }
  }
  stool(-1.6, -1.75, 0xa8b7a5);
  stool(0.75, 0.95, 0xb6c0ad);

  // A real drawing surface with notes, so the workshop reads at a glance.
  const board = new THREE.Group();
  board.position.set(-1.75, 0, -2.8);
  workshop.add(board);
  for (const x of [-1.1, 1.1]) {
    box(board, 0.07, 2.35, 0.08, mats.wood, x, 1.24, 0, 0.025);
    box(board, 0.38, 0.08, 0.55, mats.wood, x, 0.13, 0, 0.025);
  }
  box(board, 2.8, 1.56, 0.12, material(0xdcc8af), 0, 1.78, 0, 0.08);
  box(board, 2.65, 1.4, 0.05, mats.white, 0, 1.78, 0.075, 0.04);
  const makeBoardTexture = () => canvasTexture(1024, 512, (ctx, width, height) => {
    ctx.fillStyle = '#fffefb'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#586354'; ctx.font = '600 47px sans-serif'; ctx.fillText('Together Apart', 56, 78);
    ctx.strokeStyle = '#a5bcac'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(62, 106); ctx.lineTo(736, 106); ctx.stroke();
    const notes = [
      [64, 160, '#e6dfcf', language === 'zh' ? '会议记录' : 'Meeting notes'],
      [287, 178, '#dce4d5', language === 'zh' ? '想法' : 'Ideas'],
      [520, 154, '#e9dec8', language === 'zh' ? '下一步' : 'Next steps'],
    ];
    notes.forEach(([x, y, color, text]) => {
      ctx.save(); ctx.translate(x + 88, y + 83); ctx.rotate((x % 3 - 1) * 0.05);
      ctx.fillStyle = color; ctx.fillRect(-88, -83, 176, 166);
      ctx.fillStyle = '#606657'; ctx.font = '600 24px sans-serif'; ctx.fillText(text, -67, -29, 143);
      ctx.fillStyle = '#909482'; ctx.fillRect(-61, 3, 104, 5); ctx.fillRect(-61, 23, 78, 5); ctx.restore();
    });
    ctx.strokeStyle = '#9fb8a8'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(854, 233, 51, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(854, 240, 24, 0.1, Math.PI - 0.1); ctx.stroke();
    ctx.fillStyle = '#9fb8a8'; ctx.beginPath(); ctx.arc(837, 219, 5, 0, 7); ctx.arc(871, 219, 5, 0, 7); ctx.fill();
    ctx.fillStyle = '#929788'; ctx.font = '25px sans-serif'; ctx.fillText(language === 'zh' ? '共享工作坊' : 'Shared workspace', 60, 449);
  });
  const boardMat = new THREE.MeshBasicMaterial({ map: makeBoardTexture(), toneMapped: false });
  ownedMaterials.add(boardMat);
  mesh(new THREE.PlaneGeometry(2.55, 1.28), boardMat, board, 0, 1.78, 0.107);
  box(board, 2.5, 0.065, 0.22, mats.white, 0, 1.02, 0.14, 0.025);
  for (let i = 0; i < 3; i++) box(board, 0.2, 0.03, 0.035, [mats.lavender, mats.pink, mats.mint][i], -0.8 + i * 0.24, 1.07, 0.16, 0.01);

  // Coffee and books occupy the back corner, away from the walking space.
  const cabinet = new THREE.Group();
  cabinet.position.set(3.0, 0, -2.25);
  workshop.add(cabinet);
  box(cabinet, 1.8, 0.9, 0.7, mats.mint, 0, 0.58, 0, 0.08);
  box(cabinet, 1.92, 0.1, 0.78, mats.white, 0, 1.06, 0, 0.045);
  for (const x of [-0.65, 0.65]) box(cabinet, 0.1, 0.16, 0.1, mats.wood, x, 0.14, 0.22, 0.03);
  box(cabinet, 0.02, 0.65, 0.025, material(0xb4cdbd), 0, 0.58, 0.36, 0.005);
  for (const x of [-0.12, 0.12]) sphere(cabinet, 0.035, mats.wood, x, 0.65, 0.39);
  box(cabinet, 0.48, 0.61, 0.42, material(0xeee8df), -0.35, 1.4, -0.04, 0.07);
  box(cabinet, 0.35, 0.34, 0.035, material(0x8c8c8e), -0.35, 1.32, 0.19, 0.02);
  box(cabinet, 0.4, 0.04, 0.24, material(0x65646e), -0.35, 1.13, 0.23, 0.02);
  sphere(cabinet, 0.04, mats.mint, -0.22, 1.58, 0.19);
  mug(cabinet, -0.35, 1.15, 0.22, 0xfffefb);
  mug(cabinet, 0.28, 1.11, 0.09, 0xa5b49d);
  for (let i = 0; i < 3; i++) box(cabinet, 0.36, 0.055, 0.45, [mats.pink, mats.white, mats.lavender][i], 0.62, 1.14 + i * 0.055, -0.05, 0.018);

  function plant(x, z, scale = 1) {
    const group = new THREE.Group();
    group.position.set(x, 0.07, z); group.scale.setScalar(scale); workshop.add(group);
    cylinder(group, 0.29, 0.22, 0.45, material(0xf0dbc9), 0, 0.225, 0);
    cylinder(group, 0.26, 0.26, 0.025, material(0x8c7962), 0, 0.453, 0);
    const leafMats = [material(0x86b59b), material(0xa1c9a7), material(0x689d81)];
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4;
      const stalk = cylinder(group, 0.018, 0.025, 0.73 + (i % 3) * 0.13, leafMats[2], Math.sin(angle) * 0.1, 0.76, Math.cos(angle) * 0.1);
      stalk.rotation.z = Math.sin(angle) * 0.2;
      const leaf = sphere(group, 0.26, leafMats[i % 3], Math.sin(angle) * 0.27, 0.96 + (i % 3) * 0.18, Math.cos(angle) * 0.25);
      leaf.scale.set(0.65, 1.5, 0.4); leaf.rotation.set(0.35, angle, Math.sin(angle) * 0.6);
    }
  }
  plant(-3.65, -2.5, 1.13);
  plant(3.6, 1.9, 0.9);
  plant(1.6, -2.8, 0.65);

  const shadowTexture = canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 63);
    gradient.addColorStop(0, 'rgba(65,62,50,0.21)'); gradient.addColorStop(1, 'rgba(65,62,50,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  });
  const actors = [];
  function labelTexture(name, isPlayer, isDemo = false) {
    return canvasTexture(512, 120, (ctx) => {
      const suffix = isPlayer ? (language === 'zh' ? '你' : 'YOU') : isDemo ? (language === 'zh' ? '示例' : 'demo') : '';
      const label = suffix ? `${name} · ${suffix}` : name;
      ctx.font = `${isPlayer ? '600' : '500'} 34px sans-serif`;
      const width = Math.min(490, ctx.measureText(label).width + 58);
      const x = (512 - width) / 2;
      ctx.shadowColor = 'rgba(57,63,48,.1)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 5;
      roundedPath(ctx, x, 18, width, 72, 36); ctx.fillStyle = isPlayer ? '#61705b' : '#fffefb'; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.fillStyle = isPlayer ? '#ffffff' : '#68715f';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 256, 55, 450);
    });
  }
  function fallbackCharacter(color, skin) {
    const group = new THREE.Group();
    const shirt = material(color);
    const skinMat = material(skin);
    const pants = material(0x72758a);
    const hairMat = material(0x6f5146);
    const torso = box(group, 0.5, 0.5, 0.31, shirt, 0, 0.75, 0, 0.13);
    sphere(group, 0.29, skinMat, 0, 1.23, 0);
    const hair = sphere(group, 0.302, hairMat, 0, 1.31, -0.025); hair.scale.set(1, 0.65, 0.93);
    for (const side of [-1, 1]) {
      const leg = box(group, 0.17, 0.4, 0.18, pants, side * 0.13, 0.3, 0, 0.07);
      leg.userData.limb = 'leg'; leg.userData.side = side;
      box(group, 0.19, 0.12, 0.29, mats.white, side * 0.13, 0.12, 0.045, 0.05);
      const arm = box(group, 0.16, 0.43, 0.18, shirt, side * 0.31, 0.73, 0, 0.07);
      arm.userData.limb = 'arm'; arm.userData.side = side;
      sphere(group, 0.085, skinMat, side * 0.31, 0.51, 0);
      const eye = sphere(group, 0.028, mats.ink, side * 0.09, 1.25, 0.267); eye.scale.z = 0.35;
      sphere(group, 0.04, material(0xe7a39b), side * 0.16, 1.17, 0.25).scale.z = 0.25;
    }
    torso.userData.torso = true;
    return group;
  }
  const freeGeometry = (value) => { value?.dispose(); ownedGeometries.delete(value); };
  const freeMaterial = (value) => { value?.dispose(); ownedMaterials.delete(value); };
  const freeTexture = (value) => { value?.dispose(); ownedTextures.delete(value); };
  function actor(name, x, z, color, skin, isPlayer = false, isDemo = false, avatarId = 'alex') {
    const root = new THREE.Group(); root.position.set(x, 0.07, z); scene.add(root);
    const visual = new THREE.Group(); root.add(visual);
    const previousGeometries = new Set(ownedGeometries); const previousMaterials = new Set(ownedMaterials);
    const body = fallbackCharacter(color, skin); visual.add(body);
    const bodyResources = {
      geometries: [...ownedGeometries].filter((value) => !previousGeometries.has(value)),
      materials: [...ownedMaterials].filter((value) => !previousMaterials.has(value)),
    };
    const label = sprite(labelTexture(name, isPlayer, isDemo), 1.8, 0.422); root.add(label); label.position.y = 1.93;
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
    ownedMaterials.add(shadowMat);
    const shadow = mesh(new THREE.PlaneGeometry(1.25, 1.25), shadowMat, root, 0, 0.009, 0);
    shadow.rotation.x = -Math.PI / 2; shadow.castShadow = false;
    const value = { name, root, visual, body, bodyResources, shadow, label, isPlayer, isDemo, avatarId, modelId: null, skeletons: [], reaction: null, reactionVisual: null, pose: null, heading: isPlayer ? 0.55 : Math.PI * 0.14, speed: 0, phase: actors.length * 1.6, mixer: null, actions: null, currentAction: null, target: null, path: [] };
    visual.rotation.y = value.heading;
    actors.push(value);
    return value;
  }
  const player = actor(playerName, 0.05, 2.05, 0xb5a0df, 0xedc4a5, true);
  const demoActors = [
    actor('Maya', -2.7, -0.3, 0xd6adad, 0xd6a27a, false, true, 'maya'),
    actor('Jordan', 0.2, -1.95, 0xa4c6b3, 0xb9805b, false, true, 'jordan'),
    actor('Sam', 2.35, 0.15, 0xc6b6de, 0xe9be9a, false, true, 'sam'),
  ];

  // Floor feedback stays small; reaction bubbles carry the visible response.
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x75886a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  ownedMaterials.add(markerMat);
  const marker = mesh(new THREE.RingGeometry(0.16, 0.2, 48), markerMat, scene, 0, 0.098, 0);
  marker.rotation.x = -Math.PI / 2; marker.castShadow = false;
  let markerRemaining = 0;
  const reactionTextures = Object.fromEntries(Object.entries(REACTIONS).map(([type, emoji]) => [type, canvasTexture(256, 256, (ctx) => {
    ctx.shadowColor = 'rgba(63,72,53,.16)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 7;
    roundedPath(ctx, 27, 14, 202, 202, 58); ctx.fillStyle = '#fffefb'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(107, 208); ctx.lineTo(128, 239); ctx.lineTo(149, 208); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '112px "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx.fillText(emoji, 128, 119);
  })]));
  function ensureReactionVisual(person) {
    if (person.reactionVisual) return person.reactionVisual;
    const bubble = sprite(reactionTextures.nod, 0.9, 0.9); bubble.visible = false; person.root.add(bubble);
    const mat = new THREE.MeshBasicMaterial({ color: 0x9eaf8f, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    ownedMaterials.add(mat);
    const ring = mesh(new THREE.RingGeometry(0.34, 0.46, 64), mat, person.root, 0, 0.036, 0);
    ring.rotation.x = -Math.PI / 2; ring.castShadow = false;
    person.reactionVisual = { bubble, ring, mat };
    return person.reactionVisual;
  }
  ensureReactionVisual(player);

  const bounds = { minX: -4.05, maxX: 4.05, minZ: -3.05, maxZ: 3.05 };
  const obstacles = [
    { x: -0.45, z: -0.45, w: 3.55, d: 1.55 },
    { x: -1.75, z: -2.8, w: 2.8, d: 0.35 },
    { x: 3, z: -2.25, w: 1.85, d: 0.8 },
    { x: -3.65, z: -2.5, w: 0.65, d: 0.65 },
    { x: 3.6, z: 1.9, w: 0.6, d: 0.6 },
    { x: -1.6, z: -1.75, w: 0.55, d: 0.55 },
    { x: 0.75, z: 0.95, w: 0.55, d: 0.55 },
    { x: 1.6, z: -2.8, w: 0.4, d: 0.4 },
  ];
  const walkable = (x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ && !obstacles.some((o) => Math.abs(x - o.x) < o.w / 2 + 0.23 && Math.abs(z - o.z) < o.d / 2 + 0.23);
  function clearLine(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.12);
    for (let i = 1; i <= steps; i++) if (!walkable(a.x + (b.x - a.x) * i / steps, a.z + (b.z - a.z) * i / steps)) return false;
    return true;
  }
  // A compact A* grid makes a floor click useful even across the table.
  const grid = 0.25;
  const cellKey = (x, z) => `${x},${z}`;
  const toCell = (point) => ({ x: Math.round(point.x / grid), z: Math.round(point.z / grid) });
  function nearestCell(point) {
    const origin = toCell(point);
    for (let radius = 0; radius < 20; radius++) {
      const candidates = [];
      for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const x = origin.x + dx; const z = origin.z + dz;
        if (walkable(x * grid, z * grid)) candidates.push({ x, z });
      }
      if (candidates.length) return candidates.sort((a, b) => Math.hypot(a.x * grid - point.x, a.z * grid - point.z) - Math.hypot(b.x * grid - point.x, b.z * grid - point.z))[0];
    }
    return null;
  }
  function findPath(destination) {
    const startPos = { x: player.root.position.x, z: player.root.position.z };
    if (walkable(destination.x, destination.z) && clearLine(startPos, destination)) return [destination];
    const start = nearestCell(startPos); const goal = nearestCell(destination);
    if (!start || !goal) return [];
    const startKey = cellKey(start.x, start.z); const goalKey = cellKey(goal.x, goal.z);
    const open = [{ ...start, key: startKey, g: 0, f: 0 }];
    const visited = new Set(); const scores = new Map([[startKey, 0]]); const parents = new Map();
    while (open.length) {
      open.sort((a, b) => a.f - b.f);
      const current = open.shift();
      if (visited.has(current.key)) continue;
      if (current.key === goalKey) {
        const path = []; let cursor = current;
        while (cursor.key !== startKey) { path.unshift({ x: cursor.x * grid, z: cursor.z * grid }); cursor = parents.get(cursor.key); }
        const reduced = []; let from = startPos;
        for (let index = 0; index < path.length;) {
          let farthest = index;
          while (farthest + 1 < path.length && clearLine(from, path[farthest + 1])) farthest++;
          reduced.push(path[farthest]); from = path[farthest]; index = farthest + 1;
        }
        return reduced;
      }
      visited.add(current.key);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = current.x + dx; const z = current.z + dz; const key = cellKey(x, z);
        if (visited.has(key) || !walkable(x * grid, z * grid)) continue;
        if (dx && dz && (!walkable((current.x + dx) * grid, current.z * grid) || !walkable(current.x * grid, (current.z + dz) * grid))) continue;
        const g = current.g + Math.hypot(dx, dz);
        if (g >= (scores.get(key) ?? Infinity)) continue;
        scores.set(key, g); parents.set(key, current);
        open.push({ x, z, key, g, f: g + Math.hypot(goal.x - x, goal.z - z) });
      }
    }
    return [];
  }
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.07);
  const pointer = new THREE.Vector2();
  const intersection = new THREE.Vector3();
  let pointerStart = null;
  const hasModal = () => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
  function pointerDown(event) { pointerStart = hasModal() ? null : { x: event.clientX, y: event.clientY }; }
  function pointerUp(event) {
    if (hasModal()) { pointerStart = null; return; }
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) { pointerStart = null; return; }
    pointerStart = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, intersection)) return;
    if (intersection.x < -4.55 || intersection.x > 4.55 || intersection.z < -3.55 || intersection.z > 3.55) return;
    const destination = { x: clamp(intersection.x, bounds.minX, bounds.maxX), z: clamp(intersection.z, bounds.minZ, bounds.maxZ) };
    player.path = findPath(destination);
    player.target = player.path.length ? { ...player.path.at(-1) } : null;
    if (player.target) { marker.position.set(player.target.x, 0.11, player.target.z); markerRemaining = 1.4; }
  }
  const movementKeys = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright']);
  const isEditing = (target) => target instanceof Element && (target.closest('input, textarea, select, [contenteditable="true"]') || target.isContentEditable);
  function keyDown(event) {
    const key = event.key.toLowerCase();
    if (hasModal()) { keys.clear(); return; }
    if (!movementKeys.has(key) || isEditing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault(); keys.add(key); player.path = []; player.target = null;
  }
  function keyUp(event) { keys.delete(event.key.toLowerCase()); }
  function clearKeys() { keys.clear(); pointerStart = null; }
  function focusChanged(event) { if (isEditing(event.target)) keys.clear(); }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', clearKeys);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', clearKeys);
  window.addEventListener('focusin', focusChanged);

  function resize() {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth); const height = Math.max(1, container.clientHeight);
    const aspect = width / height;
    const halfHeight = viewMode === 'follow'
      ? Math.max(2.1, 2.5 / viewZoom, 1.65 / aspect)
      : Math.max(4.42, 6.1 / aspect) / viewZoom;
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  function updateCamera(delta) {
    if (viewMode === 'follow') desiredCameraTarget.set(player.root.position.x, 1.0, player.root.position.z);
    else desiredCameraTarget.set(0, 0.55, 0);
    cameraTarget.lerp(desiredCameraTarget, 1 - Math.exp(-delta * 7));
    camera.position.copy(cameraTarget).add(cameraOffset); camera.lookAt(cameraTarget); camera.updateMatrixWorld(true);
  }
  function setViewMode(mode) {
    if (disposed || !['follow', 'room'].includes(mode)) return false;
    viewMode = mode; viewZoom = 1; resize(); return true;
  }
  function focusLocalPlayer() { return setViewMode('follow'); }
  function zoomBy(delta) {
    if (disposed || !Number.isFinite(delta)) return;
    viewZoom = clamp(viewZoom + delta, 0.65, 1.65); resize();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container); resize();

  const loader = new GLTFLoader();
  function trackModelResources(object) {
    object.traverse((child) => {
      if (child.geometry) ownedGeometries.add(child.geometry);
      const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
      for (const mat of materials) {
        ownedMaterials.add(mat);
        for (const value of Object.values(mat)) if (value?.isTexture) ownedTextures.add(value);
      }
    });
  }
  function releaseObject(object) {
    object.traverse((child) => {
      child.geometry?.dispose();
      const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
      for (const mat of materials) { for (const value of Object.values(mat)) if (value?.isTexture) value.dispose(); mat.dispose(); }
    });
  }
  function clearActorBody(person) {
    if (person.mixer) {
      person.mixer.stopAllAction(); person.mixer.uncacheRoot(person.body); mixers.delete(person.mixer);
      person.mixer = null; person.actions = null; person.currentAction = null;
    }
    for (const skeleton of person.skeletons) { skeleton.dispose(); ownedSkeletons.delete(skeleton); }
    person.skeletons = [];
    person.bodyResources?.geometries.forEach(freeGeometry);
    person.bodyResources?.materials.forEach(freeMaterial);
    person.bodyResources = null;
    person.visual.remove(person.body);
  }
  function applyAvatar(person) {
    const record = modelCache.get(person.avatarId);
    if (!record || person.modelId === person.avatarId) return;
    const { entry, gltf } = record;
    const body = cloneSkeleton(gltf.scene);
    body.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(body);
    const size = bbox.getSize(new THREE.Vector3()); const center = bbox.getCenter(new THREE.Vector3());
    const scale = 1.5 / Math.max(size.y, 0.01);
    body.scale.multiplyScalar(scale);
    body.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);
    body.rotation.y = entry.rotationY || 0;
    clearActorBody(person);
    body.traverse((child) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; child.frustumCulled = false; }
      if (child.skeleton && !person.skeletons.includes(child.skeleton)) { ownedSkeletons.add(child.skeleton); person.skeletons.push(child.skeleton); }
    });
    person.visual.add(body); person.body = body; person.modelId = person.avatarId;
    if (gltf.animations?.length) {
      const mixer = new THREE.AnimationMixer(body); person.mixer = mixer; mixers.add(mixer);
      const idleClip = gltf.animations.find((clip) => /idle|stand|breath/i.test(clip.name));
      const walkClip = gltf.animations.find((clip) => /walk/i.test(clip.name)) || gltf.animations.find((clip) => /run/i.test(clip.name));
      person.actions = { idle: idleClip ? mixer.clipAction(idleClip) : null, walk: walkClip ? mixer.clipAction(walkClip) : null };
      const initial = person.actions.idle || person.actions.walk;
      if (initial) { initial.play(); if (!person.actions.idle) initial.timeScale = 0; person.currentAction = initial; }
    }
  }
  function removeActor(person) {
    clearActorBody(person);
    freeTexture(person.label.material.map); freeMaterial(person.label.material);
    freeGeometry(person.shadow.geometry); freeMaterial(person.shadow.material);
    if (person.reactionVisual) {
      freeMaterial(person.reactionVisual.bubble.material);
      freeGeometry(person.reactionVisual.ring.geometry); freeMaterial(person.reactionVisual.mat);
    }
    scene.remove(person.root); person.root.clear();
    const index = actors.indexOf(person); if (index !== -1) actors.splice(index, 1);
  }
  async function loadCharacters() {
    try {
      const response = await fetch(asset('models/characters.json'), { signal: abortController.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error('Character models are not available yet.');
      const manifest = await response.json();
      if (!Array.isArray(manifest.characters) || !manifest.characters.length) throw new Error('No characters in manifest.');
      await Promise.all(manifest.characters.map(async (entry) => {
        if (!modelLoads.has(entry.url)) {
          const promise = loader.loadAsync(asset(entry.url)).then((gltf) => {
            if (disposed) { releaseObject(gltf.scene); throw new DOMException('Scene disposed', 'AbortError'); }
            trackModelResources(gltf.scene); return gltf;
          }).catch((error) => { modelLoads.delete(entry.url); throw error; });
          modelLoads.set(entry.url, promise);
        }
        const gltf = await modelLoads.get(entry.url);
        if (!disposed) modelCache.set(entry.id, { entry, gltf });
      }));
      if (disposed) return;
      actors.forEach(applyAvatar);
      modelLoaded = true;
      onReady?.({ modelLoaded: true, npcCount: meetingMode ? 0 : 3 });
    } catch (error) {
      if (!disposed && error.name !== 'AbortError') modelTimer = window.setTimeout(loadCharacters, 4000);
    }
  }

  function reactPerson(person, type, source) {
    if (disposed || !REACTIONS[type]) return false;
    person.reaction = { type, source, remaining: 3.5, started: elapsed };
    const { bubble } = ensureReactionVisual(person);
    bubble.material.map = reactionTextures[type]; bubble.material.needsUpdate = true; bubble.visible = true;
    bubble.material.opacity = 1; bubble.position.set(0, 2.67, 0);
    return true;
  }
  function react(type, { source = 'manual' } = {}) { return reactPerson(player, type, source); }
  function reactRemote(id, type, { source = 'remote' } = {}) {
    const person = remoteActors.get(String(id));
    return person ? reactPerson(person, type, source) : false;
  }
  function refreshLabel(person) {
    const old = person.label.material.map;
    person.label.material.map = labelTexture(person.name, person.isPlayer, person.isDemo);
    freeTexture(old); person.label.material.needsUpdate = true;
  }
  function setName(name) {
    if (disposed) return;
    playerName = String(name || 'You').trim().slice(0, 24) || 'You'; player.name = playerName;
    refreshLabel(player);
  }
  function setLanguage(value) {
    if (disposed) return;
    const next = value === 'zh' ? 'zh' : 'en';
    if (language === next) return;
    language = next; actors.forEach(refreshLabel);
    const previous = boardMat.map; boardMat.map = makeBoardTexture(); boardMat.needsUpdate = true; freeTexture(previous);
    renderer.domElement.setAttribute('aria-label', language === 'zh' ? '可交互三维工作坊。点击地面或使用 WASD 和方向键移动。' : 'Interactive 3D workshop. Click the floor or use WASD and arrow keys to move.');
  }
  const validAvatars = new Set(['alex', 'maya', 'jordan', 'sam']);
  function setAvatar(id) {
    if (disposed || !validAvatars.has(id)) return false;
    player.avatarId = id; applyAvatar(player); return true;
  }
  function setMeetingMode(value) {
    if (disposed) return;
    meetingMode = Boolean(value); demoActors.forEach((person) => { person.root.visible = !meetingMode; });
    if (!meetingMode) { remoteActors.forEach(removeActor); remoteActors.clear(); localParticipantId = null; localSpawnAppliedFor = null; }
  }
  function updateRemotePose(id, pose) {
    if (disposed || !pose) return false;
    const person = remoteActors.get(String(id));
    if (!person || !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) return false;
    const dx = pose.x - person.root.position.x; const dz = pose.z - person.root.position.z;
    person.pose = { x: pose.x, z: pose.z, rotation: Number.isFinite(pose.rotation) ? pose.rotation : Math.hypot(dx, dz) > 0.01 ? Math.atan2(dx, dz) : person.heading };
    return true;
  }
  function setParticipants(participants = [], localId = localParticipantId) {
    if (disposed || !Array.isArray(participants)) return;
    setMeetingMode(true); localParticipantId = localId == null ? null : String(localId);
    const present = new Set();
    for (const participant of participants) {
      if (participant?.id == null) continue;
      const id = String(participant.id);
      if (id === localParticipantId) {
        const pose = participant.pose || participant.position || participant;
        if (localSpawnAppliedFor !== id && Number.isFinite(pose.x) && Number.isFinite(pose.z)) {
          let x = clamp(pose.x, bounds.minX, bounds.maxX); let z = clamp(pose.z, bounds.minZ, bounds.maxZ);
          if (!walkable(x, z)) {
            const nearest = nearestCell({ x, z });
            if (nearest) { x = nearest.x * grid; z = nearest.z * grid; }
          }
          player.root.position.set(x, 0.07, z); player.path = []; player.target = null; player.speed = 0;
          if (Number.isFinite(pose.rotation)) { player.heading = pose.rotation; player.visual.rotation.y = pose.rotation; }
          keys.clear(); wasMoving = false; localSpawnAppliedFor = id;
        }
        continue;
      }
      if (present.has(id)) continue;
      present.add(id);
      const name = String(participant.name || (language === 'zh' ? '参与者' : 'Guest')).trim().slice(0, 24);
      const requestedAvatar = participant.avatarId || participant.avatar || 'alex';
      const avatarId = validAvatars.has(requestedAvatar) ? requestedAvatar : 'alex';
      const pose = participant.pose || participant.position || participant;
      let person = remoteActors.get(id);
      if (!person) {
        const spots = [[-2.7, -0.3], [0.2, -1.95], [2.35, 0.15], [-2.7, 1.7], [2.4, 2.3]];
        const [fallbackX, fallbackZ] = spots[remoteActors.size % spots.length];
        const x = Number.isFinite(pose.x) ? pose.x : fallbackX; const z = Number.isFinite(pose.z) ? pose.z : fallbackZ;
        person = actor(name, x, z, 0xa4b6a3, 0xe9be9a, false, false, avatarId);
        person.id = id;
        if (Number.isFinite(pose.rotation)) { person.heading = pose.rotation; person.visual.rotation.y = pose.rotation; }
        remoteActors.set(id, person);
      } else {
        if (person.name !== name) { person.name = name; refreshLabel(person); }
        person.avatarId = avatarId;
      }
      applyAvatar(person); updateRemotePose(id, pose);
    }
    for (const [id, person] of remoteActors) if (!present.has(id)) { removeActor(person); remoteActors.delete(id); }
  }
  function reset() {
    if (disposed) return;
    keys.clear(); player.root.position.set(0.05, 0.07, 2.05); player.path = []; player.target = null; player.speed = 0;
    player.heading = 0.55; player.visual.rotation.y = 0.55;
    player.reaction = null; player.reactionVisual.bubble.visible = false; player.reactionVisual.mat.opacity = 0; markerRemaining = 0; markerMat.opacity = 0; wasMoving = false;
    onMove?.({ x: player.root.position.x, z: player.root.position.z, rotation: player.heading, moving: false });
  }
  function update(dt = 1 / 60) {
    if (disposed) return;
    const delta = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    elapsed += delta;
    const movementPaused = hasModal();
    if (movementPaused) { keys.clear(); pointerStart = null; }
    let dx = 0; let dz = 0; let waypointDistance = Infinity;
    const wasX = player.root.position.x; const wasZ = player.root.position.z;
    if (!movementPaused && keys.size && !isEditing(document.activeElement)) {
      const horizontal = Number(keys.has('d') || keys.has('arrowright')) - Number(keys.has('a') || keys.has('arrowleft'));
      const vertical = Number(keys.has('s') || keys.has('arrowdown')) - Number(keys.has('w') || keys.has('arrowup'));
      dx = horizontal * 0.793 + vertical * 0.61; dz = horizontal * -0.61 + vertical * 0.793;
      const length = Math.hypot(dx, dz) || 1; dx /= length; dz /= length;
    } else if (!movementPaused && player.path.length) {
      const destination = player.path[0]; dx = destination.x - wasX; dz = destination.z - wasZ;
      const length = Math.hypot(dx, dz);
      waypointDistance = length;
      if (length < 0.05) { player.path.shift(); dx = 0; dz = 0; if (!player.path.length) player.target = null; }
      else { dx /= length; dz /= length; }
    }
    if (dx || dz) {
      const step = Math.min(1.8 * delta, waypointDistance);
      const nextX = clamp(wasX + dx * step, bounds.minX, bounds.maxX);
      const nextZ = clamp(wasZ + dz * step, bounds.minZ, bounds.maxZ);
      if (walkable(nextX, nextZ)) player.root.position.set(nextX, 0.07, nextZ);
      else if (walkable(nextX, wasZ)) player.root.position.x = nextX;
      else if (walkable(wasX, nextZ)) player.root.position.z = nextZ;
    }
    const moved = Math.hypot(player.root.position.x - wasX, player.root.position.z - wasZ);
    const moving = moved > 0.0001;
    player.speed = THREE.MathUtils.damp(player.speed, moving ? 1 : 0, 11, delta);
    if (moving) {
      const heading = Math.atan2(player.root.position.x - wasX, player.root.position.z - wasZ);
      player.heading += wrapAngle(heading - player.heading) * Math.min(1, delta * 12);
    }
    if ((moving && elapsed - moveNoticeAt >= 0.1) || (!moving && wasMoving)) {
      onMove?.({ x: player.root.position.x, z: player.root.position.z, rotation: player.heading, moving }); moveNoticeAt = elapsed;
    }
    wasMoving = moving;
    player.visual.rotation.y = player.heading;
    actors.forEach((person) => {
      if (!person.root.visible) return;
      if (!person.isPlayer && !person.isDemo && person.pose) {
        const beforeX = person.root.position.x; const beforeZ = person.root.position.z;
        const blend = 1 - Math.exp(-delta * 14);
        person.root.position.x = THREE.MathUtils.lerp(beforeX, person.pose.x, blend);
        person.root.position.z = THREE.MathUtils.lerp(beforeZ, person.pose.z, blend);
        if (Math.hypot(person.root.position.x - person.pose.x, person.root.position.z - person.pose.z) < 0.003) {
          person.root.position.x = person.pose.x; person.root.position.z = person.pose.z;
        }
        const remoteMoved = Math.hypot(person.root.position.x - beforeX, person.root.position.z - beforeZ);
        person.speed = THREE.MathUtils.damp(person.speed, delta > 0 && remoteMoved / delta > 0.08 ? 1 : 0, 11, delta);
        person.heading += wrapAngle(person.pose.rotation - person.heading) * blend;
        person.visual.rotation.y = person.heading;
      }
      if (person.mixer) {
        const next = person.speed > 0.15 && person.actions.walk ? person.actions.walk : person.actions.idle;
        if (next && next !== person.currentAction) { person.currentAction?.fadeOut(0.18); next.reset().fadeIn(0.18).play(); next.timeScale = 1; person.currentAction = next; }
        person.mixer.update(delta);
        person.visual.position.y = 0;
      } else {
        person.visual.position.y = !person.isDemo ? Math.abs(Math.sin(elapsed * 10)) * 0.045 * person.speed : Math.sin(elapsed * 1.8 + person.phase) * 0.012;
        person.body.traverse((part) => { if (part.userData.limb) part.rotation.x = Math.sin(elapsed * 10 + (part.userData.side > 0 ? Math.PI : 0)) * person.speed * (part.userData.limb === 'leg' ? 0.35 : -0.3); });
      }
      if (person.reaction) {
        const reaction = person.reaction; const { bubble, ring, mat } = person.reactionVisual;
        reaction.remaining = Math.max(0, reaction.remaining - delta);
        const age = elapsed - reaction.started;
        const pop = 1 + Math.sin(Math.min(1, age / 0.32) * Math.PI) * 0.13;
        const fade = Math.min(1, reaction.remaining / 0.3);
        bubble.scale.setScalar(0.9 * pop); bubble.material.opacity = fade;
        bubble.position.set(0, 2.67 + Math.sin(age * 2.4) * 0.035, 0);
        if (reaction.type === 'nod') { ring.scale.setScalar(1 + Math.sin(age * 3) * 0.15); mat.opacity = 0.23 * fade; }
        else if (reaction.type === 'clap') { ring.scale.setScalar(1 + Math.min(1, age * 1.8)); mat.opacity = Math.max(0, 0.5 - age * 0.5) * fade; }
        else mat.opacity = 0;
        if (reaction.remaining <= 0) { person.reaction = null; bubble.visible = false; mat.opacity = 0; }
      }
    });
    if (markerRemaining > 0) {
      markerRemaining = Math.max(0, markerRemaining - delta); markerMat.opacity = markerRemaining / 1.4 * 0.6;
      marker.scale.setScalar(1 + (1.4 - markerRemaining) * 0.5);
    }
    updateCamera(delta);
  }
  function render() { if (!disposed) renderer.render(scene, camera); }
  function frame(time) {
    if (disposed) return;
    update((time - previousTime) / 1000); previousTime = time; render(); raf = requestAnimationFrame(frame);
  }
  function getState() {
    const reactionState = (person) => person.reaction ? { type: person.reaction.type, source: person.reaction.source, remaining: Number(person.reaction.remaining.toFixed(3)) } : null;
    return {
      player: { x: Number(player.root.position.x.toFixed(3)), z: Number(player.root.position.z.toFixed(3)), rotation: Number(player.heading.toFixed(3)), name: playerName, target: player.target ? { ...player.target } : null },
      npcCount: meetingMode ? 0 : 3,
      reaction: reactionState(player),
      modelLoaded, meetingMode, language, localId: localParticipantId, localAvatar: player.avatarId,
      remoteIds: [...remoteActors.keys()], remoteCount: remoteActors.size,
      remotes: [...remoteActors].map(([id, person]) => ({ id, name: person.name, avatar: person.avatarId, x: Number(person.root.position.x.toFixed(3)), z: Number(person.root.position.z.toFixed(3)), rotation: Number(person.heading.toFixed(3)), reaction: reactionState(person) })),
      viewMode, zoom: viewZoom,
      coordinates: '+X right, +Y up, +Z front; ground bounds X -4.05..4.05, Z -3.05..3.05. Isometric camera follows the local player unless room view is selected.',
    };
  }
  function dispose() {
    if (disposed) return;
    disposed = true; cancelAnimationFrame(raf); clearTimeout(modelTimer); abortController.abort(); resizeObserver.disconnect();
    renderer.domElement.removeEventListener('pointerdown', pointerDown);
    renderer.domElement.removeEventListener('pointerup', pointerUp);
    renderer.domElement.removeEventListener('pointercancel', clearKeys);
    window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', clearKeys); window.removeEventListener('focusin', focusChanged);
    mixers.forEach((mixer) => { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); });
    ownedGeometries.forEach((geometry) => geometry.dispose()); ownedMaterials.forEach((mat) => mat.dispose()); ownedTextures.forEach((texture) => texture.dispose());
    ownedSkeletons.forEach((skeleton) => skeleton.dispose()); sun.shadow.dispose();
    scene.clear(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); keys.clear();
    actors.length = 0; remoteActors.clear(); modelCache.clear(); modelLoads.clear(); mixers.clear();
  }
  render(); raf = requestAnimationFrame(frame); loadCharacters();
  onReady?.({ modelLoaded: false, npcCount: 3 });
  return { react, reactRemote, setName, setAvatar, setLanguage, setParticipants, updateRemotePose, setMeetingMode, setViewMode, zoomBy, focusLocalPlayer, reset, update, render, getState, dispose };
}
