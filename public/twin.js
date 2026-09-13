/**
 * Bharati, in three dimensions.
 *
 * The building is generated from `src/facility.ts` — column grid, elevation
 * datums, room spans and service routes — not modelled by hand. Change a bay
 * range there and the model moves here, which is the only reason this stays
 * honest to the drawings.
 *
 * Look: a physical architectural model on a table. Paper ground, white shell,
 * grey rooms. Colour is reserved for rooms that are actually in trouble, the
 * same rule the console follows.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const host = document.getElementById('viewport');
const fallback = document.getElementById('twin-fallback');
const MODEL = JSON.parse(document.getElementById('facility-model').textContent);
let STATE = JSON.parse(document.getElementById('facility-state').textContent);

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const POLL_MS = 5000;

/* ── Palette, read from the stylesheet so the model cannot drift from the console ── */
const css = getComputedStyle(document.documentElement);
const token = (name, fallbackHex) => css.getPropertyValue(name).trim() || fallbackHex;

const COLOR = {
  room: new THREE.Color('#DCE3E7'),
  roomOpen: new THREE.Color('#EBF0F3'),
  shell: new THREE.Color('#FFFFFF'),
  frame: new THREE.Color('#9FAAB2'),
  edge: new THREE.Color('#5E6E79'),
  warn: new THREE.Color(token('--warn-solid', '#BC8724')),
  crit: new THREE.Color(token('--crit-solid', '#C2402B')),
  accent: new THREE.Color(token('--accent', '#0E6F68')),
};

// Service hues follow the BIM model's own coding — muted, so severity still wins.
const SERVICE_COLOR = { diesel: '#9A6B2F', water: '#2E6F7A', hvac: '#5B6E8C' };

/* ── Geometry helpers, all in metres on the drawings' own grid ───────────── */
const { bayM, datum } = MODEL;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Column line `bay` as an x coordinate, with bay 11 at the origin. */
const bayX = (bay) => (bay - 11) * bayM;

/** The shell tapers inward going down; this is its half-width at height y. */
function halfAt(y) {
  const t = clamp((y - datum.h1) / (datum.h3 - datum.h1), 0, 1);
  return lerp(MODEL.halfWidthBottomM, MODEL.halfWidthM, t);
}

/** Half-width available to a room on each deck, inset inside the shell. */
const DECK_HALF = {
  under: 4.6,
  lower: halfAt(datum.h1 + 1.5) - 1.1,
  main: halfAt(datum.h2 + 1.5) - 0.9,
  roof: 4.2,
};

/** How far each deck lifts in the exploded view. */
const EXPLODE = { under: -3.5, lower: 0, main: 5, roof: 11 };

/* ── Scene ────────────────────────────────────────────────────────────────── */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  renderer = null;
}
if (!renderer || !renderer.getContext()) {
  fallback.hidden = false;
  host.setAttribute('aria-hidden', 'true');
  throw new Error('WebGL unavailable');
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(host.clientWidth, host.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
host.appendChild(renderer.domElement);
host.tabIndex = 0;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.5, 900);
// Filled in by fitView() once the geometry exists — see below.
const HOME = { pos: new THREE.Vector3(50, 31, 56), target: new THREE.Vector3(0, 7, 0) };
camera.position.copy(HOME.pos);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = !REDUCED;
controls.dampingFactor = 0.07;
controls.minDistance = 28;
controls.maxDistance = 220;
// Stop the camera dropping below the rock — you never view a building from beneath.
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

// Kept under 1.0 on purpose: brighter than this and MeshStandardMaterial clips
// to white, flattening every face of the model into one paper-coloured mass.
scene.add(new THREE.HemisphereLight(0xffffff, 0xa8b4bc, 0.72));

const key = new THREE.DirectionalLight(0xfff8ef, 1.35);
key.position.set(48, 66, 40);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 220;
Object.assign(key.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70 });
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.04;
scene.add(key);

const fill = new THREE.DirectionalLight(0xdce8f2, 0.22);
fill.position.set(-52, 26, -34);
scene.add(fill);

/* ── Ground ───────────────────────────────────────────────────────────────── */
// Shadow only. The stage's own paper gradient is the ground; painting a second
// one over it just added a hard circular edge across the frame.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.ShadowMaterial({ opacity: 0.13 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.raycast = () => {};
scene.add(ground);

/* ── Materials ────────────────────────────────────────────────────────────── */
const shellMat = new THREE.MeshStandardMaterial({
  color: COLOR.shell,
  roughness: 0.42,
  metalness: 0.02,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const frameMat = new THREE.MeshStandardMaterial({ color: COLOR.frame, roughness: 0.62, metalness: 0.1 });
const edgeMat = new THREE.LineBasicMaterial({ color: COLOR.edge, transparent: true, opacity: 0.55 });

/** Wireframe outline for a mesh — what gives the model its drawn, drafted feel. */
function outline(geometry, opacity = 0.5) {
  const line = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    opacity === 0.5 ? edgeMat : new THREE.LineBasicMaterial({ color: COLOR.edge, transparent: true, opacity }),
  );
  line.raycast = () => {}; // outlines are decoration; never hit-test them
  return line;
}

/* ── The shell: two extruded segments, stepped like the section ───────────── */
const building = new THREE.Group();
scene.add(building);

function shellSegment(fromBay, toBay, bottomY, topY) {
  const topHalf = MODEL.halfWidthM;
  const botHalf = halfAt(bottomY);
  const eaveY = topY - 0.8;
  const roofHalf = topHalf - 1.1;

  const shape = new THREE.Shape();
  shape.moveTo(-roofHalf, topY);
  shape.lineTo(-topHalf, eaveY);
  shape.lineTo(-botHalf, bottomY);
  shape.lineTo(botHalf, bottomY);
  shape.lineTo(topHalf, eaveY);
  shape.lineTo(roofHalf, topY);
  shape.closePath();

  const length = bayX(toBay) - bayX(fromBay);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  // ExtrudeGeometry pushes along +Z; the building runs along +X.
  geometry.rotateY(Math.PI / 2);
  geometry.translate(bayX(fromBay), 0, 0);

  const mesh = new THREE.Mesh(geometry, shellMat);
  mesh.renderOrder = 2;
  mesh.raycast = () => {}; // clicks belong to the rooms inside
  building.add(mesh, outline(geometry, 0.62));
}

// Deep to the left (two decks), shallow to the right (main deck on stilts).
shellSegment(0.5, 15.8, datum.h1, datum.h3);
shellSegment(15.8, 21.3, datum.h2, datum.h3);

/* ── Stilts: V-columns under the deep half, posts under the cantilever ───── */
function post(bay, z, fromY, toY, radius = 0.42) {
  const height = toY - fromY;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12), frameMat);
  mesh.position.set(bayX(bay), fromY + height / 2, z);
  mesh.castShadow = true;
  return mesh;
}

/** The station's signature splayed legs, drawn as a V from the elevation. */
function vColumn(bay, z, fromY, toY, spread) {
  const group = new THREE.Group();
  for (const sign of [-1, 1]) {
    const top = new THREE.Vector3(bayX(bay) + sign * spread, toY, z);
    const foot = new THREE.Vector3(bayX(bay), fromY, z);
    const leg = post(bay, z, fromY, toY, 0.38);
    leg.position.copy(foot.clone().lerp(top, 0.5));
    leg.scale.y = foot.distanceTo(top) / (toY - fromY);
    leg.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      top.clone().sub(foot).normalize(),
    );
    group.add(leg);
  }
  return group;
}

const frame = new THREE.Group();
frame.name = MODEL.structureId;
building.add(frame);

for (const bay of [3, 7.5, 12]) {
  for (const z of [-5.4, 5.4]) frame.add(vColumn(bay, z, 0, datum.h1, 2.3));
}
for (const bay of [16.5, 18.2, 19.9, 21.1]) {
  for (const z of [-5.8, 0, 5.8]) {
    const p = post(bay, z, 0, datum.h2, 0.36);
    frame.add(p);
  }
}
// Stairs at both ends, as annotated on the elevations.
for (const [bay, z] of [[0.9, 8.6], [21.2, -8.6]]) {
  const flight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 9), frameMat);
  flight.position.set(bayX(bay), datum.h2 - 1.9, z);
  flight.rotation.x = 0.34;
  flight.castShadow = true;
  frame.add(flight);
}

/* ── Rooms, one box per zone, grouped by deck so they can explode ─────────── */
const deckGroups = {};
for (const level of Object.keys(MODEL.levels)) {
  deckGroups[level] = new THREE.Group();
  building.add(deckGroups[level]);
}

/** zone id -> { mesh, material, base colour } so recolouring stays O(1). */
const zoneMeshes = new Map();

for (const zone of MODEL.zones) {
  const band = MODEL.levels[zone.level];
  const [fromBay, toBay] = zone.bays;
  const length = Math.max(0.6, bayX(toBay) - bayX(fromBay) - 0.25);
  const half = DECK_HALF[zone.level];
  // An open zone (terrace, balcony) is a deck, not a room: draw the slab only.
  const height = zone.open ? 0.45 : band.to - band.from - 0.55;
  const y = zone.open ? band.from + 0.22 : band.from + (band.to - band.from) / 2;

  const geometry = new THREE.BoxGeometry(length, height, half * 2);
  const material = new THREE.MeshStandardMaterial({
    color: zone.open ? COLOR.roomOpen : COLOR.room,
    roughness: 0.74,
    metalness: 0.03,
    transparent: true,
    // Solid. At 0.9 every room behind bled through and the model read as a pile of
    // glass boxes; the translucent shell alone is what makes it a sectional view.
    opacity: zone.open ? 0.98 : 1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((bayX(fromBay) + bayX(toBay)) / 2, y, 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.zoneId = zone.id;

  const group = deckGroups[zone.level];
  group.add(mesh);
  const edges = outline(geometry, 0.46);
  edges.position.copy(mesh.position);
  group.add(edges);

  zoneMeshes.set(zone.id, { mesh, material, base: material.color.clone() });
}

// The radome stands apart from the building in every photograph; it carries the
// comms zone so a dropped uplink is visible from any angle.
const radome = new THREE.Mesh(
  new THREE.SphereGeometry(3, 28, 20),
  new THREE.MeshStandardMaterial({ color: COLOR.room, roughness: 0.8, transparent: true, opacity: 0.95 }),
);
radome.position.set(bayX(23.6), 3.2, 9.5);
radome.castShadow = true;
radome.userData.zoneId = 'comms';
scene.add(radome);
scene.add(post(23.6, 9.5, 0, 1.6, 2.1));

/* ── Service network ──────────────────────────────────────────────────────── */
const services = new THREE.Group();
services.visible = false;
scene.add(services);
const runs = [];

for (const line of MODEL.services) {
  const points = line.points.map((p) => new THREE.Vector3(bayX(p.bay), p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.06);
  const color = new THREE.Color(SERVICE_COLOR[line.id] ?? '#6B7A85');

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 140, 0.38, 8, false),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, transparent: true, opacity: 0.85 }),
  );
  tube.raycast = () => {};
  services.add(tube);

  // Flow reads as movement along the run; the marker count is the visual "rate".
  const markers = [];
  const markerGeo = new THREE.SphereGeometry(0.62, 14, 10);
  const markerMat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });
  for (let i = 0; i < 5; i += 1) {
    const dot = new THREE.Mesh(markerGeo, markerMat);
    dot.raycast = () => {};
    services.add(dot);
    markers.push(dot);
  }
  runs.push({ line, curve, markers, phase: 0, rate: 0.25 });
}

/* ── Hover tooltip, in DOM rather than 3D text so it stays crisp ─────────── */
const tip = document.createElement('div');
tip.className = 'twin-tip';
tip.setAttribute('aria-hidden', 'true');
Object.assign(tip.style, {
  position: 'absolute', zIndex: '4', pointerEvents: 'none', opacity: '0',
  padding: '5px 9px', borderRadius: '7px', fontSize: '10.5px', fontWeight: '600',
  background: 'rgba(11,16,22,.88)', color: '#fff', transform: 'translate(-50%,-140%)',
  transition: 'opacity .18s var(--ease)', whiteSpace: 'nowrap',
});
host.parentElement.appendChild(tip);

/* ── Selection ────────────────────────────────────────────────────────────── */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selectedId = null;
let hoveredId = null;

const pickables = () => [...zoneMeshes.values()].map((entry) => entry.mesh).concat(radome);

function pickAt(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables(), false);
  return hits.length ? hits[0].object.userData.zoneId : null;
}

const zoneById = (id) => MODEL.zones.find((z) => z.id === id);

function selectZone(id) {
  selectedId = id;
  paintZones();
  renderZonePanel();
  for (const button of document.querySelectorAll('.zbtn')) {
    button.setAttribute('aria-pressed', String(button.dataset.zone === id));
  }
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  const hit = pickAt(event);
  if (hit) selectZone(hit);
});

renderer.domElement.addEventListener('pointermove', (event) => {
  const hit = pickAt(event);
  if (hit === hoveredId) {
    if (hit) {
      tip.style.left = `${event.clientX - host.getBoundingClientRect().left}px`;
      tip.style.top = `${event.clientY - host.getBoundingClientRect().top}px`;
    }
    return;
  }
  hoveredId = hit;
  renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
  if (!hit) {
    tip.style.opacity = '0';
    return;
  }
  tip.textContent = zoneById(hit)?.name ?? hit;
  tip.style.opacity = '1';
});

renderer.domElement.addEventListener('pointerleave', () => {
  hoveredId = null;
  tip.style.opacity = '0';
});

// Keyboard orbit, so the model is not mouse-only. The room list is still the
// full non-visual path; this just stops the canvas being a dead focus stop.
host.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 0.16 : 0.06;
  const offset = camera.position.clone().sub(controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  if (event.key === 'ArrowLeft') spherical.theta -= step;
  else if (event.key === 'ArrowRight') spherical.theta += step;
  else if (event.key === 'ArrowUp') spherical.phi = clamp(spherical.phi - step, 0.12, Math.PI * 0.495);
  else if (event.key === 'ArrowDown') spherical.phi = clamp(spherical.phi + step, 0.12, Math.PI * 0.495);
  else return;
  event.preventDefault();
  camera.position.copy(controls.target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
  controls.update();
});

/* ── Painting zones from live severity ────────────────────────────────────── */
function paintZones() {
  const severities = STATE.zones ?? {};
  for (const [id, entry] of zoneMeshes) {
    const severity = severities[id];
    const target = severity === 'critical' ? COLOR.crit : severity === 'warning' ? COLOR.warn : entry.base;
    entry.material.color.copy(target);
    entry.material.emissive.copy(severity ? target : new THREE.Color(0x000000));
    entry.material.emissiveIntensity = severity === 'critical' ? 0.34 : severity === 'warning' ? 0.2 : 0;
    const solid = zoneById(id)?.open ? 0.98 : 1;
    entry.material.opacity = id === selectedId ? Math.max(0.62, solid) : services.visible ? 0.2 : solid;

    if (id === selectedId) {
      entry.material.emissive.copy(severity ? target : COLOR.accent);
      entry.material.emissiveIntensity = 0.42;
    }
  }

  const commsSeverity = severities.comms;
  radome.material.color.copy(
    commsSeverity === 'critical' ? COLOR.crit : commsSeverity === 'warning' ? COLOR.warn : COLOR.room,
  );

  // Structural alerts have no room of their own; they tint the frame instead.
  const structural = severities[MODEL.structureId];
  frameMat.color.copy(
    structural === 'critical' ? COLOR.crit : structural === 'warning' ? COLOR.warn : COLOR.frame,
  );

  for (const button of document.querySelectorAll('.zbtn')) {
    const severity = severities[button.dataset.zone];
    if (severity) button.dataset.sev = severity;
    else delete button.dataset.sev;
  }
}

/* ── Zone panel ───────────────────────────────────────────────────────────── */
const panel = document.getElementById('zone-panel');

/** Resolve a dotted metric path against the last reading we were sent. */
function readMetric(path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), STATE.reading);
}

function formatMetric(instrument) {
  const value = readMetric(instrument.metric);
  if (value == null) return '--';
  if (typeof value === 'string') return value.toUpperCase();
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (!Number.isFinite(value)) return '--';
  const text = instrument.dp === 0 ? Math.round(value).toLocaleString('en-IN') : value.toFixed(instrument.dp ?? 1);
  return instrument.unit ? `${text} ${instrument.unit}` : text;
}

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function renderZonePanel() {
  if (!selectedId) return;
  const zone = zoneById(selectedId);
  if (!zone) return;

  const severity = (STATE.zones ?? {})[zone.id];
  const related = (STATE.alerts ?? []).filter((alert) => alert.pillar === zone.pillar);

  const rows = zone.instruments.length
    ? zone.instruments
        .map(
          (instrument) => `<div class="mrow">
            <span class="ml">${escapeHtml(instrument.label)}</span>
            <span class="mv">${escapeHtml(formatMetric(instrument))}</span>
          </div>`,
        )
        .join('')
    : '<p class="sub" style="margin-top:10px">No instrumentation in this space.</p>';

  const alertBlock =
    severity && related.length
      ? `<div class="zp-alert" data-sev="${escapeHtml(severity)}">${escapeHtml(related[0].message)}</div>`
      : '';

  panel.innerHTML = `
    <p class="eyebrow">Selected zone</p>
    <div class="zp-head"><span class="zp-name">${escapeHtml(zone.name)}</span></div>
    <p class="zp-meta mono">${escapeHtml(MODEL.levels[zone.level].label)} &middot; bays ${zone.bays[0]}&ndash;${zone.bays[1]} &middot; ${escapeHtml(zone.pillar)}</p>
    <div style="margin-top:12px;border-top:1px solid var(--hair-soft);padding-top:4px">${rows}</div>
    ${alertBlock}`;
}

for (const button of document.querySelectorAll('.zbtn')) {
  button.addEventListener('click', () => selectZone(button.dataset.zone));
}

/* ── Deck visibility and the exploded view ────────────────────────────────── */
let exploded = false;

for (const box of document.querySelectorAll('[data-deck]')) {
  box.addEventListener('change', () => {
    deckGroups[box.dataset.deck].visible = box.checked;
  });
}

const tools = document.querySelector('.twin-tools');
tools.addEventListener('click', (event) => {
  const button = event.target.closest('.tbtn');
  if (!button) return;

  if (button.dataset.action === 'reset') {
    fitView();
    camera.position.copy(HOME.pos);
    controls.target.copy(HOME.target);
    controls.update();
  } else if (button.dataset.action === 'explode') {
    exploded = !exploded;
    button.setAttribute('aria-pressed', String(exploded));
  } else if (button.dataset.action === 'services') {
    // Pipes run inside rooms, so showing them means x-raying the rooms too.
    services.visible = !services.visible;
    button.setAttribute('aria-pressed', String(services.visible));
    shellMat.opacity = services.visible ? 0.07 : 0.16;
    paintZones();
  }
});

/* ── Live data ────────────────────────────────────────────────────────────── */
const statusPill = document.getElementById('twin-status');
const contactEl = document.getElementById('twin-contact');

function applyState() {
  paintZones();
  renderZonePanel();

  if (statusPill) {
    statusPill.className = `pill ${STATE.status}`;
    const label = statusPill.querySelector('[data-role="status-label"]');
    if (label) label.textContent = String(STATE.status).toUpperCase();
  }
  if (contactEl && STATE.recordedAt) {
    contactEl.textContent = new Date(STATE.recordedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  }

  for (const run of runs) {
    const value = readMetric(run.line.rateMetric);
    const ratio = Number.isFinite(value) ? clamp(value / run.line.rateFull, 0, 1.4) : 0;
    run.rate = 0.03 + ratio * 0.22;
  }
}

async function poll() {
  try {
    const response = await fetch('/api/facility', { headers: { accept: 'application/json' } });
    if (!response.ok) return;
    const body = await response.json();
    if (!body?.ok || !body.data) return;
    STATE = body.data;
    applyState();
  } catch {
    // A dropped poll is not fatal: the model keeps the last good state and the
    // next tick recovers. The station itself goes offline sometimes too.
  }
}

function tickClock() {
  const el = document.getElementById('utc-clock');
  if (el) el.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
}

/* ── Frame loop ───────────────────────────────────────────────────────────── */
const clock = new THREE.Clock();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.1);

  for (const level of Object.keys(deckGroups)) {
    const targetY = exploded ? EXPLODE[level] : 0;
    const group = deckGroups[level];
    group.position.y = REDUCED ? targetY : lerp(group.position.y, targetY, 1 - Math.pow(0.002, delta));
  }

  if (!REDUCED) {
    for (const run of runs) {
      run.phase = (run.phase + run.rate * delta) % 1;
      run.markers.forEach((dot, i) => {
        const t = (run.phase + i / run.markers.length) % 1;
        dot.position.copy(run.curve.getPointAt(t));
      });
    }
  } else {
    for (const run of runs) {
      run.markers.forEach((dot, i) => dot.position.copy(run.curve.getPointAt(i / run.markers.length)));
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

/**
 * Point the camera at the model's real bounding box instead of numbers tuned by
 * hand. One pass is exact: sliding the camera along its own view direction
 * shifts every corner's depth by the same amount and leaves x/y alone, so the
 * worst-offending corner tells us exactly how far back to stand.
 *
 * `pad` leaves room for the overlays that sit on top of the canvas.
 */
function fitView(pad = 1.03) {
  const box = new THREE.Box3().setFromObject(building).expandByObject(radome);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  // Mostly side-on, lightly raised: the architectural three-quarter. Looking
  // down harder foreshortens the 66 m length and wastes the wide stage.
  const dir = new THREE.Vector3(0.34, 0.34, 0.88).normalize();
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanH = tanV * camera.aspect;

  let dist = box.getBoundingSphere(new THREE.Sphere()).radius;
  camera.position.copy(center).addScaledVector(dir, dist);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);

  let push = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        push = Math.max(push, Math.abs(v.x) / tanH + v.z, Math.abs(v.y) / tanV + v.z);
      }
    }
  }
  dist = (dist + Math.max(0, push)) * pad;

  HOME.target.copy(center);
  HOME.pos.copy(center).addScaledVector(dir, dist);
  controls.minDistance = dist * 0.3;
  controls.maxDistance = dist * 3;
}

function resize() {
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener('resize', resize);
resize();

// Aspect must be right before the fit, and the fit before the first frame.
fitView();
camera.position.copy(HOME.pos);
controls.target.copy(HOME.target);
controls.update();

applyState();
selectZone('electrical');
tickClock();
setInterval(tickClock, 1000);
setInterval(poll, POLL_MS);
animate();
