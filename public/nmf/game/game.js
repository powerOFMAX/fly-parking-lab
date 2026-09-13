// The NeuroMechFly Live game with MaleCNS 3D Brain & Bio-Inspired Parking Lab.
// Real physics with MuJoCo WASM, 3D Drosophila Connectome visualizer on the left,
// speed controls (1x to 8x Turbo), 6 diverse puzzles, and continuous adaptive learning.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ALL_PUZZLES, cargoHitsObstacle, flyHitsObstacle, isNearBorder, planAutopilot } from './autopilot.mjs';
import { loadScene, makeFailOverlay, makeStepper, makeStatsMeter, buildMeshes, syncMeshes } from '../shared/scene.js';
import {
  createRoadSurface,
  createCurb,
  createLawn,
  createParkingBay,
  createDashedRoute,
  createLaneDashes,
  createSuburbanHouse,
  createTree,
  createStreetLamp,
  createParkedCar,
  createTrafficCone,
  createRoadworkBarrier,
  createDumpster,
} from './track-props.mjs';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const ASSETS = './assets';
const TAU = Math.PI * 2;
const overlayEl = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');

const BASE_PLAYBACK_SPEED = 0.28;
const MAX_SUBSTEPS = 90;

/**
 * Prueba de intersección 2D de un rayo contra una caja alineada con los ejes (AABB).
 * Implementa el método de losas (slab method) optimizado para evitar divisiones por cero.
 * @param {number} ox Origen X del rayo
 * @param {number} oy Origen Y del rayo
 * @param {number} dx Dirección normalizada X
 * @param {number} dy Dirección normalizada Y
 * @param {number} minX Límite inferior X de la caja
 * @param {number} maxX Límite superior X de la caja
 * @param {number} minY Límite inferior Y de la caja
 * @param {number} maxY Límite superior Y de la caja
 * @param {number} maxD Distancia máxima del rayo
 * @returns {number} Distancia t al punto de impacto o maxD si no intersecta
 */
function intersectRayAABB(ox, oy, dx, dy, minX, maxX, minY, maxY, maxD) {
  let tmin = 0.0;
  let tmax = maxD;

  if (Math.abs(dx) < 1e-6) {
    if (ox < minX || ox > maxX) return maxD;
  } else {
    const inv = 1.0 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return maxD;
  }

  if (Math.abs(dy) < 1e-6) {
    if (oy < minY || oy > maxY) return maxD;
  } else {
    const inv = 1.0 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return maxD;
  }

  return tmin >= 0 ? tmin : tmax >= 0 ? 0 : maxD;
}

/**
 * Prueba de intersección 2D de un rayo contra un círculo (ej. isla ajardinada central de rotonda).
 * Resuelve algebraicamente ||(o + t*d) - c||^2 = r^2.
 */
function intersectRayCircle(ox, oy, dx, dy, cx, cy, rad, maxD) {
  const ex = ox - cx,
    ey = oy - cy;
  const b = 2 * (ex * dx + ey * dy);
  const c = ex * ex + ey * ey - rad * rad;
  const disc = b * b - 4 * c;
  if (disc < 0) return maxD;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2;
  if (t1 >= 0 && t1 < maxD) return t1;
  const t2 = (-b + sq) / 2;
  if (t2 >= 0 && t2 < maxD) return t2;
  return maxD;
}

const fail = makeFailOverlay(overlayEl, 'game', 'p');

main().catch((e) => fail('Unexpected error while starting up.', e));

async function main() {
  const { mj, model, data, meta } = await loadScene({
    assetsDir: ASSETS,
    xmlName: 'fly.xml',
    onStage: (msg) => {
      overlayMsg.textContent = msg;
    },
  });
  const game = new Game(mj, model, data, meta);
  window.__flyParkingGame = game;
  game.start();
}

// ============================================================================
// BRAIN 3D VIEWER (MaleCNS Drosophila Connectome on the Left)
// ============================================================================
class Brain3DViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 12, 36);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.camera.position.set(0, 1.3, 7.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.container.prepend(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3.2;
    this.controls.maxDistance = 14;
    this.controls.target.set(0, -0.15, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 1.25);
    const key = new THREE.DirectionalLight(0x55ddd5, 1.45);
    key.position.set(4, 5, 6);
    const fill = new THREE.DirectionalLight(0xff9e3d, 1.1);
    fill.position.set(-4, -3, 3);
    this.scene.add(ambient, key, fill);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.neurons = {};
    this.synapses = [];
    this.tracts = [];
    this.plasticityFlash = 0;

    this._buildBrainAnatomy();
    this._buildNeurons();
    this._buildSynapses();
    this._wireInteractivity();
    this.resize();
  }

  _buildBrainAnatomy() {
    // Drosophila bilateral cephalic brain lobes (transparent glass with wireframe)
    const lobeMat = new THREE.MeshPhysicalMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.12,
      roughness: 0.35,
      metalness: 0.1,
      clearcoat: 0.3,
      depthWrite: false,
    });
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });

    const leftLobe = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 18), lobeMat);
    leftLobe.scale.set(1.15, 0.92, 0.82);
    leftLobe.position.set(-0.95, 0.35, 0);

    const leftLobeWire = new THREE.Mesh(new THREE.SphereGeometry(1.26, 16, 12), wireMat);
    leftLobeWire.scale.copy(leftLobe.scale);
    leftLobeWire.position.copy(leftLobe.position);

    const rightLobe = leftLobe.clone();
    rightLobe.position.x = 0.95;
    const rightLobeWire = leftLobeWire.clone();
    rightLobeWire.position.x = 0.95;

    // Central Complex / Protocerebrum bridge
    const centralLobe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.45, 16), lobeMat);
    centralLobe.rotation.z = Math.PI / 2;
    centralLobe.position.set(0, 0.3, 0);

    // Ventral Nerve Cord trunk (connection to thoracic motor centers)
    const vnc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.18, 1.6, 14), lobeMat);
    vnc.position.set(0, -1.0, -0.1);

    this.group.add(leftLobe, leftLobeWire, rightLobe, rightLobeWire, centralLobe, vnc);

    // Haces de tractos neuronales MaleCNS auténticos (azul y naranja brillantes en vivo)
    const tractDefs = [
      // Tractos descendentes centrales (azul cian)
      {
        pts: [
          [-0.4, 0.8, 0.2],
          [-0.25, 0.2, 0.1],
          [-0.1, -0.6, 0.0],
          [-0.15, -1.5, 0.0],
        ],
        color: 0x38bdf8,
      },
      {
        pts: [
          [0.4, 0.8, 0.2],
          [0.25, 0.2, 0.1],
          [0.1, -0.6, 0.0],
          [0.15, -1.5, 0.0],
        ],
        color: 0x38bdf8,
      },
      {
        pts: [
          [0.0, 1.1, 0.3],
          [0.0, 0.3, 0.1],
          [0.0, -0.8, 0.0],
          [0.0, -1.6, -0.05],
        ],
        color: 0x0ea5e9,
      },
      {
        pts: [
          [-0.8, 0.5, -0.1],
          [-0.4, 0.0, 0.0],
          [-0.2, -0.9, 0.05],
          [-0.25, -1.4, 0.0],
        ],
        color: 0x38bdf8,
      },
      {
        pts: [
          [0.8, 0.5, -0.1],
          [0.4, 0.0, 0.0],
          [0.2, -0.9, 0.05],
          [0.25, -1.4, 0.0],
        ],
        color: 0x38bdf8,
      },
      // Tractos premotores y MDN (naranja / ámbar connectome)
      {
        pts: [
          [-1.1, 0.6, 0.1],
          [-0.6, 0.1, 0.2],
          [-0.1, -0.2, 0.25],
          [-0.3, -0.9, 0.1],
        ],
        color: 0xf97316,
      },
      {
        pts: [
          [1.1, 0.6, 0.1],
          [0.6, 0.1, 0.2],
          [0.1, -0.2, 0.25],
          [0.3, -0.9, 0.1],
        ],
        color: 0xf97316,
      },
      {
        pts: [
          [0.0, -0.2, 0.25],
          [-0.4, -0.7, 0.15],
          [-0.6, -1.2, 0.05],
          [-0.85, -1.6, 0.0],
        ],
        color: 0xfb923c,
      },
      {
        pts: [
          [0.0, -0.2, 0.25],
          [0.4, -0.7, 0.15],
          [0.6, -1.2, 0.05],
          [0.85, -1.6, 0.0],
        ],
        color: 0xfb923c,
      },
      {
        pts: [
          [-0.7, 0.9, 0.3],
          [-0.3, 0.4, 0.1],
          [0.0, 0.1, -0.1],
          [0.3, -0.5, 0.05],
        ],
        color: 0xf59e0b,
      },
      {
        pts: [
          [0.7, 0.9, 0.3],
          [0.3, 0.4, 0.1],
          [0.0, 0.1, -0.1],
          [-0.3, -0.5, 0.05],
        ],
        color: 0xf59e0b,
      },
    ];

    for (const def of tractDefs) {
      const vPts = def.pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      const curve = new THREE.CatmullRomCurve3(vPts);
      const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.024, 6, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: 0.6,
        roughness: 0.3,
        metalness: 0.2,
      });
      const tube = new THREE.Mesh(tubeGeo, tubeMat);
      this.group.add(tube);
      this.tracts.push({ mesh: tube, baseIntensity: 0.6, color: def.color });
    }
  }

  _buildNeurons() {
    // Anatomical positions of functional & MaleCNS identified neurons
    const neuronDefs = [
      {
        id: 'visual_left',
        name: 'Left Vision',
        kind: 'Optical Sensor',
        desc: 'Detects obstacles and cues in the left hemifield.',
        pos: [-1.4, 0.75, 0.35],
        color: 0x42d5d0,
        size: 0.16,
      },
      {
        id: 'visual_right',
        name: 'Right Vision',
        kind: 'Optical Sensor',
        desc: 'Detects obstacles and cues in the right hemifield.',
        pos: [1.4, 0.75, 0.35],
        color: 0x42d5d0,
        size: 0.16,
      },
      {
        id: 'odor',
        name: 'Antennal Receptor',
        kind: 'Chemical Sensor',
        desc: 'Proximity gradient toward the target parking zone.',
        pos: [0.0, 1.2, 0.55],
        color: 0x55e08b,
        size: 0.15,
      },
      {
        id: 'touch',
        name: 'Mechanoreceptor',
        kind: 'Tactile Contact',
        desc: 'Body tactile feedback when driving the vehicle or brushing obstacles.',
        pos: [0.0, 0.5, 0.7],
        color: 0xffaa44,
        size: 0.16,
      },
      {
        id: 'steer_left',
        name: 'Left Turn DN',
        kind: 'Motor Decoder',
        desc: 'Descending neuron modulating right stride amplitude.',
        pos: [-0.85, 0.15, 0.15],
        color: 0x49a7ff,
        size: 0.17,
      },
      {
        id: 'steer_right',
        name: 'Right Turn DN',
        kind: 'Motor Decoder',
        desc: 'Descending neuron modulating left stride amplitude.',
        pos: [0.85, 0.15, 0.15],
        color: 0x49a7ff,
        size: 0.17,
      },
      {
        id: 'forward_drive',
        name: 'Forward Drive',
        kind: 'Central Integrator',
        desc: 'Commands baseline oscillation frequency across both CPGs.',
        pos: [0.0, 0.25, -0.1],
        color: 0xffbb44,
        size: 0.18,
      },
      {
        id: 'mdn',
        name: 'MDN (Moonwalker)',
        kind: 'MaleCNS Descending Neuron',
        desc: 'Biological descending neuron triggering backward locomotion and unstuck maneuvers.',
        pos: [0.0, -0.2, 0.25],
        color: 0xff8b2c,
        size: 0.24,
      },
      {
        id: 'lbl40',
        name: 'LBL40 Premotor',
        kind: 'MaleCNS Premotor',
        desc: 'Direct synaptic target of MDN in the ventral nerve cord.',
        pos: [-0.6, -0.85, 0.15],
        color: 0x42d5d0,
        size: 0.16,
      },
      {
        id: 'in07b010',
        name: 'IN07B010',
        kind: 'MaleCNS Interneuron',
        desc: 'Postsynaptic interneuron with 119 synapses from MDN.',
        pos: [0.0, -0.95, -0.1],
        color: 0x42d5d0,
        size: 0.15,
      },
      {
        id: 'in12b003',
        name: 'IN12B003 (GABA)',
        kind: 'Inhibitory Interneuron',
        desc: 'Reciprocal premotor inhibition during reverse drive.',
        pos: [0.6, -0.85, 0.15],
        color: 0xbf77ff,
        size: 0.16,
      },
      {
        id: 'cpg_left',
        name: 'Left Tripod CPG',
        kind: 'Central Pattern Generator',
        desc: 'Coordinates LF, LH, and RM legs with oscillatory coupling.',
        pos: [-0.95, -1.6, 0.0],
        color: 0x8ace00,
        size: 0.18,
      },
      {
        id: 'cpg_right',
        name: 'Right Tripod CPG',
        kind: 'Central Pattern Generator',
        desc: 'Coordinates RF, RH, and LM legs with oscillatory coupling.',
        pos: [0.95, -1.6, 0.0],
        color: 0x8ace00,
        size: 0.18,
      },
    ];

    const sphereGeo = new THREE.SphereGeometry(1, 20, 16);
    for (const def of neuronDefs) {
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: 0.4,
        roughness: 0.3,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.scale.setScalar(def.size);
      mesh.position.set(...def.pos);
      mesh.userData = def;
      this.group.add(mesh);
      this.neurons[def.id] = { mesh, mat, baseColor: def.color, def };
    }
  }

  _buildSynapses() {
    const connections = [
      { from: 'visual_left', to: 'steer_left', color: 0x42d5d0, weight: 1.4 },
      { from: 'visual_right', to: 'steer_right', color: 0x42d5d0, weight: 1.4 },
      { from: 'odor', to: 'forward_drive', color: 0x55e08b, weight: 1.5 },
      { from: 'touch', to: 'mdn', color: 0xffaa44, weight: 2.2 },
      { from: 'steer_left', to: 'cpg_left', color: 0x49a7ff, weight: 1.2 },
      { from: 'steer_right', to: 'cpg_right', color: 0x49a7ff, weight: 1.2 },
      { from: 'forward_drive', to: 'cpg_left', color: 0xffbb44, weight: 1.0 },
      { from: 'forward_drive', to: 'cpg_right', color: 0xffbb44, weight: 1.0 },
      { from: 'mdn', to: 'lbl40', color: 0xff8b2c, weight: 1.6 },
      { from: 'mdn', to: 'in07b010', color: 0xff8b2c, weight: 1.5 },
      { from: 'mdn', to: 'in12b003', color: 0xff8b2c, weight: 1.5 },
      { from: 'lbl40', to: 'cpg_left', color: 0xbf77ff, weight: 1.3 },
      { from: 'lbl40', to: 'cpg_right', color: 0xbf77ff, weight: 1.3 },
    ];

    const pulseGeo = new THREE.SphereGeometry(0.042, 12, 10);

    for (const c of connections) {
      const n1 = this.neurons[c.from];
      const n2 = this.neurons[c.to];
      if (!n1 || !n2) continue;

      const p1 = n1.mesh.position;
      const p2 = n2.mesh.position;
      const mid = p1.clone().lerp(p2, 0.5);
      mid.z += 0.22 * (Math.random() * 0.4 + 0.8);
      mid.y += (Math.random() - 0.5) * 0.15;

      const curve = new THREE.CatmullRomCurve3([p1.clone(), mid, p2.clone()]);
      const points = curve.getPoints(36);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: c.color,
        transparent: true,
        opacity: 0.35,
        linewidth: 2,
      });
      const lineMesh = new THREE.Line(lineGeo, lineMat);
      this.group.add(lineMesh);

      const pulseMat = new THREE.MeshBasicMaterial({ color: c.color });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      pulseMesh.visible = false;
      this.group.add(pulseMesh);

      this.synapses.push({
        from: c.from,
        to: c.to,
        curve,
        lineMat,
        pulseMesh,
        baseColor: c.color,
        progress: Math.random(),
      });
    }
  }

  _wireInteractivity() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const card = document.getElementById('brain-hover-card');
    const nameEl = document.getElementById('bhc-name');
    const typeEl = document.getElementById('bhc-type');
    const descEl = document.getElementById('bhc-desc');

    const onMove = (e) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, this.camera);
      const meshes = Object.values(this.neurons).map((n) => n.mesh);
      const hits = raycaster.intersectObjects(meshes);

      if (hits.length > 0) {
        const def = hits[0].object.userData;
        if (card && nameEl && typeEl && descEl) {
          card.classList.remove('hidden');
          nameEl.textContent = def.name;
          typeEl.textContent = def.kind;
          descEl.textContent = def.desc;
        }
      } else {
        if (card) card.classList.add('hidden');
      }
    };

    this.renderer.domElement.addEventListener('pointermove', onMove);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  flashPlasticity() {
    this.plasticityFlash = 1.0;
  }

  update(signals, dt) {
    if (!this.controls.state || this.controls.state === -1) {
      this.group.rotation.y += 0.0035;
    }
    this.controls.update();

    if (this.plasticityFlash > 0) {
      this.plasticityFlash = Math.max(0, this.plasticityFlash - dt * 2.2);
    }

    const act = {
      visual_left: Math.max(
        0.1,
        signals.visLeft && signals.visLeft > 0.08
          ? Math.min(1.0, signals.visLeft * 1.35)
          : signals.turn > 0
            ? signals.turn * 1.2
            : 0.1,
      ),
      visual_right: Math.max(
        0.1,
        signals.visRight && signals.visRight > 0.08
          ? Math.min(1.0, signals.visRight * 1.35)
          : signals.turn < 0
            ? Math.abs(signals.turn) * 1.2
            : 0.1,
      ),
      odor: Math.max(0.2, signals.forward),
      touch: signals.contact,
      steer_left: Math.max(0.08, signals.driveL < signals.driveR ? 0.9 : 0.1),
      steer_right: Math.max(0.08, signals.driveR < signals.driveL ? 0.9 : 0.1),
      forward_drive: signals.forward,
      mdn: signals.mdn,
      lbl40: signals.mdn * 0.92,
      in07b010: signals.mdn * 0.88,
      in12b003: signals.mdn * 0.82,
      cpg_left: Math.max(0.15, Math.abs(signals.driveL)),
      cpg_right: Math.max(0.15, Math.abs(signals.driveR)),
    };

    for (const [id, value] of Object.entries(act)) {
      const n = this.neurons[id];
      if (!n) continue;
      const intensity = 0.35 + value * 1.65 + this.plasticityFlash * 0.65;
      n.mat.emissiveIntensity = intensity;
      const s = n.def.size * (1 + value * 0.38);
      n.mesh.scale.setScalar(s);
    }

    for (const syn of this.synapses) {
      const sourceAct = act[syn.from] || 0;
      const isFiring = sourceAct > 0.3 || syn.from === 'touch' || syn.from === 'mdn';

      syn.lineMat.opacity = Math.min(1.0, 0.22 + sourceAct * 0.72 + this.plasticityFlash * 0.45);
      if (this.plasticityFlash > 0.08) {
        syn.lineMat.color.setHex(0x55ddd5);
      } else {
        syn.lineMat.color.setHex(syn.baseColor);
      }

      if (isFiring) {
        syn.pulseMesh.visible = true;
        syn.progress = (syn.progress + dt * (1.3 + sourceAct * 2.6)) % 1.0;
        const point = syn.curve.getPoint(syn.progress);
        syn.pulseMesh.position.copy(point);
      } else {
        syn.pulseMesh.visible = false;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// ============================================================================
// CONTROLLER & INPUT
// ============================================================================
class Controller {
  constructor(meta) {
    this.dt = meta.timestep;
    this.legs = meta.control.leg_order;
    this.cmap = meta.ctrl_index_by_leg_dof;
    this.adh = meta.adhesion;
    this.tripodMap = meta.control.tripod_map;
    const cpg = meta.control.cpg;
    this.freqs0 = cpg.intrinsic_freqs.slice();
    this.W = cpg.coupling_weights;
    this.PB = cpg.phase_biases;
    this.conv = cpg.convergence_coefs;
    this.phaseInc = (this.dt / meta.control.leg_step_time) * TAU;

    const pp = meta.preprogrammed;
    this.N = pp.n_samples;
    this.tab = this.legs.map((l) => pp.legs[l]);

    this._cpgAmps = new Float64Array(6);
    this._cpgFreqs = new Float64Array(6);
    this._d6 = new Float64Array(6);
    this._a7 = new Float64Array(7);
    this.reset();
  }

  reset() {
    this.phases = new Float64Array(6).map(() => Math.random() * TAU);
    this.mags = new Float64Array(6);
    this.legPhases = new Float64Array(6);
    this.stepDir = new Float64Array(6);
    this.tripodPhases = new Float64Array(2);
    this.tripodDir = new Float64Array(2);
  }

  _anglesInto(li, phase, mag, out) {
    const t = this.tab[li],
      N = this.N;
    let x = ((((phase % TAU) + TAU) % TAU) / TAU) * N;
    const i0 = Math.floor(x) % N,
      i1 = (i0 + 1) % N,
      f = x - Math.floor(x);
    const a0 = t.angles[i0],
      a1 = t.angles[i1],
      nu = t.neutral;
    for (let d = 0; d < 7; d++) {
      const samp = a0[d] * (1 - f) + a1[d] * f;
      out[d] = nu[d] + mag * (samp - nu[d]);
    }
  }

  _adhesionOn(li, phase) {
    const [s, e] = this.tab[li].swing;
    const p = ((phase % TAU) + TAU) % TAU;
    return !(p > s && p < e);
  }

  _writeLeg(ctrl, li, phase, mag) {
    this._anglesInto(li, phase, mag, this._a7);
    const row = this.cmap[li];
    for (let d = 0; d < 7; d++) ctrl[row[d]] = this._a7[d];
    ctrl[this.adh[li]] = this._adhesionOn(li, phase) ? 1 : 0;
  }

  /**
   * Actualiza el patrón generador central (CPG) neuromotor de las 6 extremidades de Carla.
   *
   * Mapeo biomecánico en la cabina del vehículo:
   * - Patas delanteras (lf li=0, rf li=3): Manos en el volante (9 y 3 en punto), con
   *   cinemática activa proporcional al comando de dirección (steer).
   * - Patas medias (lm li=1, rm li=4): Actuación enérgica de los pedales deportivos; la
   *   izquierda acciona el pedal de freno (al frenar/retroceder) y la derecha el acelerador.
   * - Patas traseras (lh li=2, rh li=5): Soporte postural firme y anclaje al habitáculo.
   * - Respuesta háptica: Oscilación sinusoidal de alta frecuencia (24 rad/s) simulando
   *   la vibración del motor transmitida al cuerpo según la velocidad.
   *
   * @param {Float64Array} ctrl Buffer de actuadores MuJoCo
   * @param {number} gainL Ganancia motora del lado izquierdo
   * @param {number} gainR Ganancia motora del lado derecho
   * @param {number} stepScale Factor de escala para substepping adaptativo
   */
  stepCPG(ctrl, gainL, gainR, stepScale = 1.0) {
    const aL = Math.abs(gainL),
      aR = Math.abs(gainR);
    for (let i = 0; i < 3; i++) this.mags[i] = aL;
    for (let i = 3; i < 6; i++) this.mags[i] = aR;

    const steer = Math.max(-1.25, Math.min(1.25, (gainR - gainL) * 0.85));
    const forwardDrive = Math.max(0, (gainL + gainR) / 2);
    const isReversing = Boolean(gainL < 0 && gainR < 0);
    const gasPress = isReversing ? 0.0 : Math.min(1.0, forwardDrive * 1.15);
    const brakePress = isReversing ? 1.0 : forwardDrive < 0.05 && aL + aR > 0.1 ? 0.65 : 0.0;

    // Micro-vibración y respuesta háptica de motor en el chasis/volante proporcional a la velocidad
    const speed = (aL + aR) / 2;
    this.simTime = (this.simTime || 0) + this.dt * stepScale;
    const vibe = speed > 0.04 ? Math.sin(this.simTime * 24) * 0.012 * Math.min(1, speed) : 0;

    for (let li = 0; li < 6; li++) {
      const nu = this.tab[li].neutral;
      const row = this.cmap[li];

      for (let d = 0; d < 7; d++) {
        let val = nu[d];

        // Pata delantera izquierda (lf, li=0): mano izquierda en el volante a las 9 en punto
        // Movimiento activo de empuje/tracción acompañando la rotación del volante
        if (li === 0) {
          if (d === 0) val += 0.28 - steer * 0.55;
          else if (d === 1) val += 0.22 - steer * 0.38;
          else if (d === 2) val += -0.12 - steer * 0.58;
          else if (d === 3) val += 0.35 - steer * 0.46;
          else if (d === 4) val += 0.15 - steer * 0.25;
          else if (d === 5) val += -0.26 + steer * 0.44;
          else if (d === 6) val += 0.14;
          if (d === 3 || d === 5) val += vibe * 0.5;
        }

        // Pata delantera derecha (rf, li=3): mano derecha en el volante a las 3 en punto
        // Movimiento activo en contra-fase acompañando la rotación del volante
        else if (li === 3) {
          if (d === 0) val += 0.28 + steer * 0.55;
          else if (d === 1) val += -0.22 + steer * 0.38;
          else if (d === 2) val += -0.12 + steer * 0.58;
          else if (d === 3) val += 0.35 + steer * 0.46;
          else if (d === 4) val += -0.15 + steer * 0.25;
          else if (d === 5) val += -0.26 - steer * 0.44;
          else if (d === 6) val += 0.14;
          if (d === 3 || d === 5) val += vibe * 0.5;
        }

        // Pata media izquierda (lm, li=1): pedal de freno deportivo en el piso
        // Se extiende hacia abajo y pisa enérgicamente el pedal de freno al frenar o retroceder
        else if (li === 1) {
          if (d === 0) val += 0.28 + brakePress * 0.52;
          else if (d === 1) val += 0.16;
          else if (d === 2) val += -0.14 + brakePress * 0.6;
          else if (d === 3) val += 0.36 + brakePress * 0.52;
          else if (d === 4) val += -0.18 - brakePress * 0.28;
          else if (d === 5) val += 0.2 - brakePress * 0.48;
          if (d === 3 || d === 4) val += vibe * 0.3;
        }

        // Pata media derecha (rm, li=4): pedal de acelerador deportivo en el piso
        // Se extiende hacia abajo y pisa enérgicamente el pedal de acelerador al dar gas
        else if (li === 4) {
          if (d === 0) val += 0.28 + gasPress * 0.52;
          else if (d === 1) val += -0.16;
          else if (d === 2) val += -0.14 + gasPress * 0.6;
          else if (d === 3) val += 0.36 + gasPress * 0.52;
          else if (d === 4) val += 0.18 + gasPress * 0.28;
          else if (d === 5) val += 0.2 - gasPress * 0.48;
          if (d === 3 || d === 4) val += vibe * 0.3;
        }

        // Patas traseras (lh=2, rh=5): postura plantada de apoyo firme en el chasis
        else {
          if (d === 0) val += 0.16;
          if (d === 3 || d === 4) val += vibe * 0.4;
          if (d === 1) val += (li === 2 ? -1 : 1) * steer * 0.08;
        }

        ctrl[row[d]] = val;
      }

      // Adhesión activa firme a los controles y piso de cabina
      ctrl[this.adh[li]] = 1;
    }
  }
}

class Input {
  constructor(onRestart, onMove) {
    this.held = new Set();
    this.gainL = 0;
    this.gainR = 0;
    const MOVE = 'wsadq';
    const ARROW = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };
    addEventListener('keydown', (e) => {
      const k = ARROW[e.key.toLowerCase()] || e.key.toLowerCase();
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      if (k === ' ') {
        e.preventDefault();
        return onRestart();
      }
      this.held.add(k);
      this._cpgKey(k);
      if (MOVE.includes(k)) {
        e.preventDefault();
        onMove();
      }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      this.held.delete(ARROW[k] || k);
    });
    addEventListener('blur', () => {
      this.held.clear();
    });
  }

  _cpgKey(k) {
    const back = this.gainL < 0 || this.gainR < 0;
    if (k === 'w') {
      this.gainL = 1;
      this.gainR = 1;
    } else if (k === 's') {
      this.gainL = -1;
      this.gainR = -1;
    } else if (k === 'q') {
      this.gainL = 0;
      this.gainR = 0;
    } else if (k === 'a') {
      if (back) {
        this.gainR = -0.6;
        this.gainL = -1.2;
      } else {
        this.gainL = 0.4;
        this.gainR = 1.2;
      }
    } else if (k === 'd') {
      if (back) {
        this.gainL = -0.6;
        this.gainR = -1.2;
      } else {
        this.gainR = 0.4;
        this.gainL = 1.2;
      }
    }
  }

  resetGains() {
    this.gainL = 0;
    this.gainR = 0;
  }
}

class Gamepad {
  constructor(onChange) {
    this.index = null;
    this._disconnected = false;
    addEventListener('gamepadconnected', (e) => {
      this.index = e.gamepad.index;
      this._disconnected = false;
      onChange?.();
    });
    addEventListener('gamepaddisconnected', (e) => {
      if (this.index === e.gamepad.index) {
        this.index = null;
        this._disconnected = true;
      }
      onChange?.();
    });
  }

  _pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.index != null && pads[this.index]) return pads[this.index];
    if (!this._disconnected) {
      for (const p of pads)
        if (p) {
          this.index = p.index;
          return p;
        }
    }
    return null;
  }

  _axis(pad, i) {
    const v = pad.axes[i] || 0;
    return Math.abs(v) < 0.15 ? 0 : v;
  }

  sample() {
    const pad = this._pad();
    if (!pad) return null;
    const ax = this._axis(pad, 0),
      ay = this._axis(pad, 1);
    const norm = (Math.hypot(ax, ay) / Math.SQRT2) * 1.2;
    const sy = ay > 0 ? 1 : ay < 0 ? -1 : 0;
    let gainL = norm * -1 * sy;
    let gainR = gainL;
    const off = Math.abs(ax) * 0.6;
    if (ax > 0) gainR -= off;
    else if (ax < 0) gainL -= off;
    const active = ax !== 0 || ay !== 0;
    return { active, gainL, gainR };
  }
}

const _vDir = new THREE.Vector3();
const _vProj = new THREE.Vector3();
const _vBendDir = new THREE.Vector3();
const _vMid = new THREE.Vector3();
const _vSegDir = new THREE.Vector3();
const _vUp = new THREE.Vector3(0, 1, 0);
const _vTarget = new THREE.Vector3();
const _vJoint = new THREE.Vector3();

/**
 * Resolvedor analítico de cinemática inversa (IK de 2 huesos en forma cerrada).
 * Calcula la posición del punto de articulación outJoint dados el origen, objetivo,
 * longitudes l1 y l2, y el vector de polo para definir el plano y sentido de flexión.
 */
function solve2BoneIK(origin, target, l1, l2, pole, outJoint) {
  _vDir.subVectors(target, origin);
  let d = _vDir.length();
  const maxD = l1 + l2 - 0.001;
  const minD = Math.abs(l1 - l2) + 0.001;
  d = Math.max(minD, Math.min(maxD, d));
  _vDir.normalize();

  const cosAlpha = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

  _vProj.copy(_vDir).multiplyScalar(pole.dot(_vDir));
  _vBendDir.subVectors(pole, _vProj);
  if (_vBendDir.lengthSq() < 1e-6) _vBendDir.set(0, 1, 0).cross(_vDir);
  _vBendDir.normalize();

  outJoint
    .copy(origin)
    .addScaledVector(_vDir, l1 * cosAlpha)
    .addScaledVector(_vBendDir, l1 * sinAlpha);
  return outJoint;
}

/**
 * Posiciona y orienta un segmento cilíndrico para conectar con precisión milimétrica pA con pB.
 */
function positionSegment(mesh, pA, pB) {
  _vMid.addVectors(pA, pB).multiplyScalar(0.5);
  _vSegDir.subVectors(pB, pA);
  const len = _vSegDir.length();
  mesh.position.copy(_vMid);
  mesh.scale.set(1, Math.max(0.001, len), 1);
  if (len > 1e-6) {
    _vSegDir.normalize();
    mesh.quaternion.setFromUnitVectors(_vUp, _vSegDir);
  }
}

// ============================================================================
// MAIN GAME CLASS
// ============================================================================
class Game {
  constructor(mj, model, data, meta) {
    this.mj = mj;
    this.model = model;
    this.data = data;
    this.meta = meta;
    this.dt = meta.timestep;
    this.level = 'CPG';
    this.controller = new Controller(meta);
    this.input = new Input(
      () => this.restart(),
      () => {
        if (this.phase === 'ready') this._startCountdown();
      },
    );
    this.pad = new Gamepad(() => {});
    this._padState = null;

    this.phase = 'ready';
    this.simTime = 0;
    this.bodyId = this._findFlyRootBody();

    this.puzzles = ALL_PUZZLES;
    const savedPuzzle = Number(localStorage.getItem('nmf-selected-puzzle'));
    this.puzzleIndex = !isNaN(savedPuzzle) && savedPuzzle >= 0 && savedPuzzle < this.puzzles.length ? savedPuzzle : 0;

    this.routeIndex = 0;
    const currentP = this.puzzles[this.puzzleIndex];
    this.cargoStart = new THREE.Vector3(currentP.cargo[0], currentP.cargo[1], 0.75);
    this.target = new THREE.Vector2(currentP.target[0], currentP.target[1]);
    this.autopilot = true;
    this.driveL = 0;
    this.driveR = 0;
    this.touches = 0;
    this.wasTouching = false;
    this.currentPolicy = this._loadPolicy(currentP.name);

    // Acceleration and speed multiplier (inicia en 1x Normal)
    this.speedMultiplier = 1.0;

    // Adaptive Learning & Training State (persistido en localStorage para no perder el progreso)
    this.isTraining = true;
    const savedEp = Number(localStorage.getItem('nmf-learning-episode'));
    const savedRew = Number(localStorage.getItem('nmf-learning-reward'));
    this.episode = Number.isFinite(savedEp) && savedEp > 0 ? savedEp : 1;
    this.reward = Number.isFinite(savedRew) ? savedRew : 0.0;
    this.rewardHistory = [];
    try {
      const savedHist = localStorage.getItem('nmf-learning-history');
      if (savedHist) {
        const arr = JSON.parse(savedHist);
        if (Array.isArray(arr)) this.rewardHistory = arr;
      }
    } catch {}
    if (this.rewardHistory.length === 0) this.rewardHistory.push(this.reward);

    this.domainRandomization = false;
    this.latestVisionRays = [];
    this.unstuckState = {
      active: false,
      phase: 'none',
      timer: 0,
      stuckFrames: 0,
      lastFly: [0, 0],
      stuckTurnDir: 1,
    };

    // Watchdog anti-atasco y límites de episodio (garantía de nunca quedar trabado para siempre)
    this.maxEpisodeTime = 45.0; // Tiempo generoso de simulación para circuitos y rotondas viales
    this.stagnantTime = 0; // Tiempo acumulado sin avance apreciable
    this._lastWatchdogCarPos = null;

    // Entrenamiento automatizado por lotes (10, 20, 40 o infinitas iteraciones en sandbox)
    this.batchActive = false;
    this.batchTotal = 20;
    this.batchCurrent = 0;
    this.batchSuccesses = 0;
    this.pauseOnSuccess = false;
    this._simAcc = 0;

    this._stepper = makeStepper(this.dt, MAX_SUBSTEPS);
    this._statsMeter = makeStatsMeter(this.dt, ({ fps, rtf }) => {
      const mult = Math.max(1, Math.round(rtf / BASE_PLAYBACK_SPEED));
      document.getElementById('stats').innerHTML = `${fps.toFixed(0)} fps · ${mult}× (${rtf.toFixed(2)}× physics)`;
    });

    this._buildScene();
    this._wireUi();
  }

  _findFlyRootBody() {
    const m = this.model;
    for (let j = 0; j < m.njnt; j++) if (m.jnt_type[j] === 0) return m.jnt_bodyid[j];
    return 1;
  }

  start() {
    this._resetSim();
    overlayEl.classList.add('hidden');
    this._showReady();
    setTimeout(() => {
      if (this.phase === 'ready' && this.autopilot) this._startCountdown();
    }, 650);
    requestAnimationFrame((t) => this._frame(t));
  }

  _buildScene() {
    // 1. Brain 3D Viewer on the left
    this.brainViewer = new Brain3DViewer('brain-view');

    // 2. Physics Simulation view in center
    const gameView = document.getElementById('game-view');
    const bodyView = document.getElementById('body-view');
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x14161b, 1);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    gameView.prepend(this.renderer.domElement);

    // 3. Body Response view on the right (pure black background)
    this.bodyRenderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.bodyRenderer.setClearColor(0x000000, 1);
    this.bodyRenderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    bodyView.prepend(this.bodyRenderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x14161b, 45, 140);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.05, 500);
    this.camera.up.set(0, 0, 1);
    this.bodyCamera = new THREE.PerspectiveCamera(46, 1, 0.05, 80);
    this.bodyCamera.up.set(0, 0, 1);
    this.bodyCamera.layers.set(1);

    const ambient = new THREE.AmbientLight(0xffffff, 1.15);
    ambient.layers.enable(1);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(8, -10, 16);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-8, 6, 6);
    key.layers.enable(1);
    fill.layers.enable(1);
    this.scene.add(ambient, key, fill);

    this._buildGround();
    this._buildParkingCourse();
    this._buildCockpitRig();
    this.meshGroup = buildMeshes(this.model, this.meta);
    this.tarsusGeoms = {};
    for (const item of this.meshGroup.userData.items) {
      const name = item.mesh.userData.name || '';
      // La mosca conduce el auto desde la cabina: solo es visible en el panel de cabina (capa 1),
      // no en la arena del laberinto (capa 0), donde el usuario ve el Mini Auto conduciendo.
      if (name.startsWith('nmf/')) {
        // En la cabina de conducción, las patas delanteras y medias de caminata se reemplazan por
        // extremidades cinemáticas articuladas al volante y pedales para evitar patas flotantes en el aire.
        const isWalkingLimb =
          name.includes('lf_') || name.includes('rf_') || name.includes('lm_') || name.includes('rm_');
        if (isWalkingLimb) {
          item.mesh.visible = false;
        } else {
          item.mesh.layers.set(1);
        }
        if (name === 'nmf/rf_tarsus5') this.tarsusGeoms.rf = item.g;
        else if (name === 'nmf/lf_tarsus5') this.tarsusGeoms.lf = item.g;
        else if (name === 'nmf/rm_tarsus5') this.tarsusGeoms.rm = item.g;
        else if (name === 'nmf/lm_tarsus5') this.tarsusGeoms.lm = item.g;
        else if (name === 'nmf/rh_tarsus5') this.tarsusGeoms.rh = item.g;
        else if (name === 'nmf/lh_tarsus5') this.tarsusGeoms.lh = item.g;
        else if (name === 'nmf/c_rostrum') this.tarsusGeoms.rostrum = item.g;
      } else {
        item.mesh.visible = false;
      }
    }
    this.scene.add(this.meshGroup);

    addEventListener('resize', () => this._resize());
    this._resize();
  }

  _buildCockpitRig() {
    this.cockpitGroup = new THREE.Group();

    // 1. Piso del habitáculo de conducción (Cockpit floor platform)
    const floorGeo = new THREE.BoxGeometry(2.6, 2.2, 0.08);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x181c24, roughness: 0.9, metalness: 0.2 });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0.65, 0.0, -1.24);
    this.cockpitGroup.add(floorMesh);

    // 2. Base de pedalera fija en el piso (Titanium pedal bracket)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.25 });
    const pedalBase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.85, 0.05), baseMat);
    pedalBase.position.set(0.65, 0.0, -1.2);
    this.cockpitGroup.add(pedalBase);

    // 3. Columna de dirección y Volante 3D de competición
    this.steeringColumn = new THREE.Group();
    const columnGeo = new THREE.CylinderGeometry(0.024, 0.034, 0.48, 14);
    const colMesh = new THREE.Mesh(columnGeo, baseMat);
    colMesh.rotation.z = Math.PI / 2;
    colMesh.position.set(-0.2, 0, 0);
    this.steeringColumn.add(colMesh);

    // Volante 3D Vertical (aro en plano vertical Y-Z frente al piloto)
    const wheelRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.024, 20, 56),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.28, metalness: 0.85 }),
    );
    wheelRim.rotation.y = Math.PI / 2;

    const hub = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 16, 14),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.25, metalness: 0.9 }),
    );

    // Rayos del volante GT
    const spokeGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.36, 10);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.2 });

    const spokeBottom = new THREE.Mesh(spokeGeo, spokeMat);
    spokeBottom.rotation.x = Math.PI / 2;
    spokeBottom.position.set(0, 0, -0.18);

    const spokeLeft = new THREE.Mesh(spokeGeo, spokeMat);
    spokeLeft.rotation.x = Math.PI / 2 + Math.PI / 3;
    spokeLeft.position.set(0, 0.18 * Math.sin(Math.PI / 3), 0.18 * Math.cos(Math.PI / 3));

    const spokeRight = new THREE.Mesh(spokeGeo, spokeMat);
    spokeRight.rotation.x = Math.PI / 2 - Math.PI / 3;
    spokeRight.position.set(0, -0.18 * Math.sin(Math.PI / 3), 0.18 * Math.cos(Math.PI / 3));

    // Franja de centrado a las 12 en punto
    const topStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.046, 0.046, 0.026),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.2, metalness: 0.6 }),
    );
    topStripe.position.set(0, 0, 0.38);

    // Bloques de agarre a las 9 y a las 3 en punto (contacto directo con las patas delanteras)
    const gripGeo = new THREE.BoxGeometry(0.09, 0.07, 0.12);
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0xff7a00,
      roughness: 0.25,
      metalness: 0.2,
      emissive: new THREE.Color(0xff6600),
      emissiveIntensity: 0.25,
    });

    const gripBlockL = new THREE.Mesh(gripGeo, gripMat);
    gripBlockL.position.set(0, 0.38, 0.0);
    this.orangeGripL = gripBlockL;

    const gripBlockR = new THREE.Mesh(gripGeo, gripMat);
    gripBlockR.position.set(0, -0.38, 0.0);
    this.orangeGripR = gripBlockR;
    this.orangeGrip = gripBlockR;

    this.steeringWheel = new THREE.Group();
    this.steeringWheel.add(wheelRim, hub, spokeBottom, spokeLeft, spokeRight, topStripe, gripBlockL, gripBlockR);
    this.steeringColumn.add(this.steeringWheel);

    this.steeringColumn.position.set(0.98, 0.0, -0.7);
    this.steeringColumn.rotation.y = -0.15;
    this.cockpitGroup.add(this.steeringColumn);

    // 4. Pedales de competición prominentes con feedback lumínico y reactivo
    this.brakePedalMat = new THREE.MeshStandardMaterial({
      color: 0xef233c,
      roughness: 0.25,
      metalness: 0.4,
      emissive: new THREE.Color(0xff1e40),
      emissiveIntensity: 0.0,
    });
    this.gasPedalMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.25,
      metalness: 0.4,
      emissive: new THREE.Color(0x22c55e),
      emissiveIntensity: 0.0,
    });
    const treadMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.95 });
    const armMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.3 });

    // Pedal de FRENO ROJO (lateral izquierdo, accionado por la pata media izquierda)
    this.brakePedal = new THREE.Group();
    const brakeArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.16), armMat);
    brakeArm.position.set(-0.04, 0, -0.06);
    const brakePad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.06), this.brakePedalMat);
    this.brakePedal.add(brakeArm, brakePad);
    for (let i = -2; i <= 2; i++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.16, 0.018), treadMat);
      tread.position.set(i * 0.048, 0, 0.034);
      this.brakePedal.add(tread);
    }
    this.brakePedal.position.set(0.68, 0.26, -1.12);
    this.brakePedal.rotation.y = 0.35;
    this.cockpitGroup.add(this.brakePedal);

    // Pedal de ACELERADOR VERDE (lateral derecho, accionado por la pata media derecha)
    this.gasPedal = new THREE.Group();
    const gasArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.16), armMat);
    gasArm.position.set(-0.04, 0, -0.06);
    const gasPad = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.06), this.gasPedalMat);
    this.gasPedal.add(gasArm, gasPad);
    for (let i = -2; i <= 2; i++) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.14, 0.018), treadMat);
      tread.position.set(i * 0.052, 0, 0.034);
      this.gasPedal.add(tread);
    }
    this.gasPedal.position.set(0.68, -0.26, -1.12);
    this.gasPedal.rotation.y = 0.35;
    this.cockpitGroup.add(this.gasPedal);

    // 5. Sensor bucal / arnés CIAN
    const cyanGeo = new THREE.BoxGeometry(0.045, 0.045, 0.045);
    const cyanMat = new THREE.MeshStandardMaterial({ color: 0x55ddd5, roughness: 0.2, metalness: 0.6 });
    this.cyanBit = new THREE.Mesh(cyanGeo, cyanMat);
    this.cyanBit.position.set(0.76, 0.0, -0.28);
    this.cockpitGroup.add(this.cyanBit);

    // 6. Iluminación propia de la cabina (garantiza máxima visibilidad de pedales y volante)
    const cockpitLight = new THREE.DirectionalLight(0xffffff, 2.2);
    cockpitLight.position.set(2.2, 1.6, 1.8);
    this.cockpitGroup.add(cockpitLight);

    const pedalLight = new THREE.PointLight(0x38bdf8, 2.4, 5.0);
    pedalLight.position.set(0.9, 0.0, -0.7);
    this.cockpitGroup.add(pedalLight);
    this.pedalLight = pedalLight;

    // 7. Extremidades cinemáticas articuladas al volante y a los pedales
    const chitinMat = new THREE.MeshStandardMaterial({
      color: 0xc88f38,
      roughness: 0.65,
      metalness: 0.15,
    });
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x8a5a22,
      roughness: 0.45,
      metalness: 0.25,
    });
    const clawMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.4,
    });

    const createLimbMeshes = (rUpper, rLower) => {
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(rUpper * 0.8, rUpper, 1, 14), chitinMat);
      const joint = new THREE.Mesh(new THREE.SphereGeometry(rUpper * 1.25, 14, 12), jointMat);
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(rLower * 0.75, rLower, 1, 14), chitinMat);
      this.cockpitGroup.add(upper, joint, lower);
      return { upper, joint, lower };
    };

    // Garras tarsales envolventes ancladas a los bloques de agarre del volante
    const attachClawsToGrip = (gripGroup) => {
      const clawGroup = new THREE.Group();
      const clawTop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), clawMat);
      clawTop.position.set(0.02, 0.0, 0.065);
      clawTop.rotation.y = 0.25;
      const clawBot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.08), clawMat);
      clawBot.position.set(0.02, 0.0, -0.065);
      clawBot.rotation.y = -0.25;
      const clawOuter = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.1), clawMat);
      clawOuter.position.set(0.04, 0.0, 0.0);
      const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), jointMat);
      wrist.position.set(0.045, 0.0, 0.0);
      clawGroup.add(clawTop, clawBot, clawOuter, wrist);
      gripGroup.add(clawGroup);
      return wrist;
    };

    const wristL = attachClawsToGrip(this.orangeGripL);
    const wristR = attachClawsToGrip(this.orangeGripR);

    // Pies tarsales sobre los pedales de freno y acelerador
    const attachFootToPedal = (pedalGroup) => {
      const footGroup = new THREE.Group();
      const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), jointMat);
      ankle.position.set(-0.02, 0.0, 0.06);
      const footSole = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.035), clawMat);
      footSole.position.set(0.04, 0.0, 0.045);
      const claw1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.025), clawMat);
      claw1.position.set(0.14, 0.035, 0.04);
      claw1.rotation.y = 0.3;
      const claw2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.025), clawMat);
      claw2.position.set(0.14, -0.035, 0.04);
      claw2.rotation.y = -0.3;
      footGroup.add(ankle, footSole, claw1, claw2);
      pedalGroup.add(footGroup);
      return ankle;
    };

    const ankleBrake = attachFootToPedal(this.brakePedal);
    const ankleGas = attachFootToPedal(this.gasPedal);

    this.cockpitLimbs = {
      armL: {
        shoulder: new THREE.Vector3(0.22, 0.18, -0.16),
        pole: new THREE.Vector3(0.2, 1.0, 0.4),
        l1: 0.68,
        l2: 0.68,
        targetAnchor: wristL,
        meshes: createLimbMeshes(0.028, 0.022),
      },
      armR: {
        shoulder: new THREE.Vector3(0.22, -0.18, -0.16),
        pole: new THREE.Vector3(0.2, -1.0, 0.4),
        l1: 0.68,
        l2: 0.68,
        targetAnchor: wristR,
        meshes: createLimbMeshes(0.028, 0.022),
      },
      legL: {
        hip: new THREE.Vector3(-0.15, 0.22, -0.35),
        pole: new THREE.Vector3(0.0, 1.0, 0.5),
        l1: 0.65,
        l2: 0.65,
        targetAnchor: ankleBrake,
        meshes: createLimbMeshes(0.032, 0.024),
      },
      legR: {
        hip: new THREE.Vector3(-0.15, -0.22, -0.35),
        pole: new THREE.Vector3(0.0, -1.0, 0.5),
        l1: 0.65,
        l2: 0.65,
        targetAnchor: ankleGas,
        meshes: createLimbMeshes(0.032, 0.024),
      },
    };

    // Todo el conjunto pertenece exclusivamente a la capa 1 (vista de cabina)
    this.cockpitGroup.traverse((child) => {
      child.layers.set(1);
    });

    this.scene.add(this.cockpitGroup);
  }

  _buildMiniCar() {
    const car = new THREE.Group();

    // Materiales de alta fidelidad automotriz estilo Mini Cooper
    const paintMat = new THREE.MeshStandardMaterial({
      color: 0x2e7d48, // British Racing Green / verde esmeralda icónico
      roughness: 0.28,
      metalness: 0.45,
    });
    const blackTrimMat = new THREE.MeshStandardMaterial({
      color: 0x141416,
      roughness: 0.85,
      metalness: 0.15,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.12,
      metalness: 0.92,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9,
    });
    const whiteRoofMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.2,
      metalness: 0.15,
    });

    // 1. Zócalo y chasis inferior oscuro con faldones aerodinámicos
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.68, 1.04, 0.08), blackTrimMat);
    skirt.position.set(0, 0, 0.16);
    car.add(skirt);

    // 2. Pasos de rueda / cantoneras ensanchadas (molduras negras características de Mini)
    const flareGeo = new THREE.BoxGeometry(0.48, 0.07, 0.13);
    for (const [fx, fy] of [
      [0.52, 0.53],
      [0.52, -0.53],
      [-0.52, 0.53],
      [-0.52, -0.53],
    ]) {
      const flare = new THREE.Mesh(flareGeo, blackTrimMat);
      flare.position.set(fx, fy, 0.33);
      car.add(flare);
    }

    // 3. Carrocería principal con curvas y hombros proporcionados
    const bodyLower = new THREE.Mesh(new THREE.BoxGeometry(1.64, 1.02, 0.38), paintMat);
    bodyLower.position.set(0, 0, 0.37);

    // Capó abovedado frontal
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.98, 0.1), paintMat);
    hood.position.set(0.52, 0, 0.58);
    car.add(bodyLower, hood);

    // 4. Paragolpes delantero cromado clásico con protectores verticales y toma de aire
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.06, 0.1), chromeMat);
    frontBumper.position.set(0.85, 0, 0.25);
    const guardGeo = new THREE.BoxGeometry(0.08, 0.06, 0.16);
    const guardFL = new THREE.Mesh(guardGeo, chromeMat);
    guardFL.position.set(0.87, 0.26, 0.27);
    const guardFR = guardFL.clone();
    guardFR.position.y = -0.26;
    const lowerIntake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.62, 0.07), blackTrimMat);
    lowerIntake.position.set(0.84, 0, 0.22);
    car.add(frontBumper, guardFL, guardFR, lowerIntake);

    // 5. Parrilla hexagonal cromada frontal y emblema Mini alado
    const grilleFrame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.64, 0.24), chromeMat);
    grilleFrame.position.set(0.83, 0, 0.43);
    const grilleMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.6, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }),
    );
    grilleMesh.position.set(0.832, 0, 0.43);
    for (let gz = -0.06; gz <= 0.06; gz += 0.04) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.58, 0.014), chromeMat);
      slat.position.set(0.834, 0, 0.43 + gz);
      car.add(slat);
    }
    const wings = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.04), chromeMat);
    wings.position.set(0.7, 0, 0.64);
    const badgeCenter = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 12), blackTrimMat);
    badgeCenter.rotation.x = Math.PI / 2;
    badgeCenter.position.set(0.705, 0, 0.64);
    car.add(grilleFrame, grilleMesh, wings, badgeCenter);

    // 6. Faros redondos icónicos con bisel cromado y óptica luminosa de cristal
    const bezelGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.05, 20);
    const lensGeo = new THREE.CylinderGeometry(0.098, 0.098, 0.06, 20);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xfffbe8,
      emissive: 0xfff4c2,
      emissiveIntensity: 0.65,
      roughness: 0.1,
    });
    for (const ly of [0.34, -0.34]) {
      const bezel = new THREE.Mesh(bezelGeo, chromeMat);
      bezel.rotation.z = Math.PI / 2;
      bezel.position.set(0.825, ly, 0.48);
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.rotation.z = Math.PI / 2;
      lens.position.set(0.832, ly, 0.48);
      const turnLight = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 0.45 }),
      );
      turnLight.rotation.z = Math.PI / 2;
      turnLight.position.set(0.835, ly, 0.33);
      car.add(bezel, lens, turnLight);
    }

    // 7. Franjas deportivas dobles en el capó (bonnet stripes)
    const stripeGeo = new THREE.PlaneGeometry(0.54, 0.1);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stripeL = new THREE.Mesh(stripeGeo, stripeMat);
    stripeL.rotation.x = -Math.PI / 2;
    stripeL.position.set(0.5, 0.18, 0.635);
    const stripeR = stripeL.clone();
    stripeR.position.y = -0.18;
    car.add(stripeL, stripeR);

    // 8. Espejos retrovisores deportivos y manijas cromadas
    for (const my of [0.55, -0.55]) {
      const mirrorStem = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.03), blackTrimMat);
      mirrorStem.position.set(0.32, my > 0 ? 0.52 : -0.52, 0.65);
      const mirrorCap = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.08), whiteRoofMat);
      mirrorCap.position.set(0.32, my, 0.66);
      const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.06), chromeMat);
      mirrorGlass.rotation.y = -Math.PI / 2;
      mirrorGlass.position.set(0.264, my, 0.66);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.024, 0.032), chromeMat);
      handle.position.set(0.02, my > 0 ? 0.525 : -0.525, 0.46);
      car.add(mirrorStem, mirrorCap, mirrorGlass, handle);
    }

    // Tapa de combustible cromada
    const fuelCap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 14), chromeMat);
    fuelCap.rotation.x = Math.PI / 2;
    fuelCap.position.set(-0.55, 0.525, 0.51);
    car.add(fuelCap);

    // 9. Habitáculo con cristales tintados y pilares negros flotantes (Floating Roof)
    const greenhouse = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.94, 0.38), glassMat);
    greenhouse.position.set(-0.1, 0, 0.75);
    car.add(greenhouse);

    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.4), glassMat);
    windshield.rotation.y = Math.PI / 4.4;
    windshield.position.set(0.4, 0, 0.74);
    car.add(windshield);

    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.98, 0.07), whiteRoofMat);
    roofPanel.position.set(-0.1, 0, 0.95);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.94, 0.04), whiteRoofMat);
    spoiler.position.set(-0.64, 0, 0.98);
    car.add(roofPanel, spoiler);

    // 10. Techo Mini Cooper limpio y aerodinámico (sin carteles voluminosos)
    const antennaGeo = new THREE.BoxGeometry(0.06, 0.024, 0.045);
    const sharkAntenna = new THREE.Mesh(antennaGeo, blackTrimMat);
    sharkAntenna.position.set(-0.48, 0, 1.0);
    car.add(sharkAntenna);

    // 11. Gráfica lateral de la mosca en las puertas
    const decalCanvas = document.createElement('canvas');
    decalCanvas.width = 128;
    decalCanvas.height = 64;
    const dctx = decalCanvas.getContext('2d');
    dctx.fillStyle = '#6366f1';
    dctx.fillRect(0, 0, 128, 64);
    dctx.fillStyle = '#ffffff';
    dctx.font = 'bold 22px sans-serif';
    dctx.fillText('🪰 PILOT', 14, 40);
    const decalTex = new THREE.CanvasTexture(decalCanvas);
    const decalGeo = new THREE.PlaneGeometry(0.38, 0.18);
    const decalMat = new THREE.MeshBasicMaterial({ map: decalTex });
    const decalL = new THREE.Mesh(decalGeo, decalMat);
    decalL.position.set(0.05, 0.525, 0.46);
    const decalR = new THREE.Mesh(decalGeo, decalMat);
    decalR.position.set(0.05, -0.525, 0.46);
    decalR.rotation.y = Math.PI;
    car.add(decalL, decalR);

    // 12. Parte trasera: Paragolpes cromado, luces traseras verticales y escape doble central
    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.06, 0.1), chromeMat);
    rearBumper.position.set(-0.85, 0, 0.25);
    const guardRL = new THREE.Mesh(guardGeo, chromeMat);
    guardRL.position.set(-0.87, 0.26, 0.27);
    const guardRR = guardRL.clone();
    guardRR.position.y = -0.26;
    car.add(rearBumper, guardRL, guardRR);

    const tailLensMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.6,
      roughness: 0.1,
    });
    for (const ty of [0.38, -0.38]) {
      const tailBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16), chromeMat);
      tailBezel.rotation.z = Math.PI / 2;
      tailBezel.position.set(-0.83, ty, 0.48);
      const tailLens = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 16), tailLensMat);
      tailLens.rotation.z = Math.PI / 2;
      tailLens.position.set(-0.835, ty, 0.48);
      car.add(tailBezel, tailLens);
    }

    for (const ey of [0.06, -0.06]) {
      const exhaustOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.12, 14), chromeMat);
      exhaustOuter.rotation.z = Math.PI / 2;
      exhaustOuter.position.set(-0.89, ey, 0.19);
      const exhaustBore = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.125, 12), blackTrimMat);
      exhaustBore.rotation.z = Math.PI / 2;
      exhaustBore.position.set(-0.895, ey, 0.19);
      car.add(exhaustOuter, exhaustBore);
    }

    // 13. Ruedas deportivas de aleación de 5 rayos con cálipers rojos y discos de freno
    const tireGeo = new THREE.CylinderGeometry(0.205, 0.205, 0.13, 22);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.88 });
    const rimLipGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.135, 18);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xdce3ea, metalness: 0.88, roughness: 0.18 });
    const brakeDiscGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14);
    const brakeDiscMat = new THREE.MeshStandardMaterial({ color: 0x71717a, metalness: 0.85, roughness: 0.3 });
    const caliperMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, metalness: 0.5 });

    const makeSportWheel = (isLeft) => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const rimLip = new THREE.Mesh(rimLipGeo, rimMat);
      const disc = new THREE.Mesh(brakeDiscGeo, brakeDiscMat);
      disc.position.y = isLeft ? -0.03 : 0.03;
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.08), caliperMat);
      caliper.position.set(0, isLeft ? -0.03 : 0.03, 0.06);

      const spokeGroup = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.138, 0.11), rimMat);
        spoke.rotation.y = (i * Math.PI * 2) / 5;
        spokeGroup.add(spoke);
      }
      const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 12), blackTrimMat);

      g.add(tire, rimLip, disc, caliper, spokeGroup, hubCap);
      return g;
    };

    this.carWheels = [];

    this.frontLeftPivot = new THREE.Group();
    this.frontLeftPivot.position.set(0.52, 0.54, 0.205);
    const wFL = makeSportWheel(true);
    this.frontLeftPivot.add(wFL);
    this.carWheels.push(wFL);

    this.frontRightPivot = new THREE.Group();
    this.frontRightPivot.position.set(0.52, -0.54, 0.205);
    const wFR = makeSportWheel(false);
    this.frontRightPivot.add(wFR);
    this.carWheels.push(wFR);

    const wRL = makeSportWheel(true);
    wRL.position.set(-0.52, 0.54, 0.205);
    this.carWheels.push(wRL);

    const wRR = makeSportWheel(false);
    wRR.position.set(-0.52, -0.54, 0.205);
    this.carWheels.push(wRR);

    // Haz de luz de los faros iluminando hacia adelante
    const beamGeo = new THREE.ConeGeometry(0.42, 3.2, 16);
    beamGeo.rotateZ(-Math.PI / 2);
    beamGeo.translate(1.6, 0, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfffae0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const beamL = new THREE.Mesh(beamGeo, beamMat);
    beamL.position.set(0.83, 0.34, 0.48);
    const beamR = beamL.clone();
    beamR.position.y = -0.34;
    car.add(beamL, beamR);

    car.add(this.frontLeftPivot, this.frontRightPivot, wRL, wRR);

    return car;
  }

  /**
   * Construye un vehículo estacionado delegando en el generador modular de track-props.
   */
  _buildParkedCar(type) {
    return createParkedCar(type);
  }

  /**
   * Construye un cono reflectante de obras delegando en track-props.
   */
  _buildTrafficCone() {
    return createTrafficCone();
  }

  /**
   * Construye una valla de obra con baliza delegando en track-props.
   */
  _buildRoadworkBarrier() {
    return createRoadworkBarrier();
  }

  /**
   * Construye un contenedor de residuos delegando en track-props.
   */
  _buildDumpster() {
    return createDumpster();
  }

  _drawStreetScene(puzzle) {
    // 1. Asfalto de avenida amplia y carril central discontinuo
    this.courseGroup.add(createRoadSurface(5.8, 0.3, 38, 16, 0x333842));
    createLaneDashes(this.courseGroup, -8, 22, 3.2, 0.9);

    // 2. Cordón y vereda derecha junto a la hilera de estacionamiento
    this.courseGroup.add(createCurb(5.8, -2.6, 38), createLawn(5.8, -4.9, 38, 4.5, 0.2, 0xc8d0d8));

    // 3. Cordón, vereda izquierda y césped con casas suburbanas decorativas
    this.courseGroup.add(createCurb(5.8, 3.2, 38), createLawn(5.8, 7.5, 38, 8.5, 0.2, 0x4a7c2a));
    const houseColors = [0xf8fafc, 0xf1f5f9, 0xfef3c7, 0xe2e8f0];
    const roofColors = [0x7f1d1d, 0x334155, 0x9a3412, 0x475569];
    for (let i = 0; i < 4; i++) {
      const hx = -3 + i * 5.8;
      this.courseGroup.add(
        createSuburbanHouse(hx, 8.2, houseColors[i % houseColors.length], roofColors[i % roofColors.length]),
        createTree(hx + 2.5, 4.5),
      );
    }

    // 4. Autos estacionados alineados contra el cordón derecho
    const obs1 = puzzle.obstacles && puzzle.obstacles[0];
    const obs2 = puzzle.obstacles && puzzle.obstacles[1];
    const car1 = this._buildParkedCar('coral_mini');
    car1.position.set(obs1 ? obs1.position[0] : 1.4, obs1 ? obs1.position[1] : -1.4, 0.02);
    const car2 = this._buildParkedCar('grey_sedan');
    car2.position.set(obs2 ? obs2.position[0] : 10.8, obs2 ? obs2.position[1] : -1.4, 0.02);
    this.courseGroup.add(car1, car2);

    // 5. Bahía delimitada de estacionamiento y guía de aproximación
    this.courseGroup.add(
      createParkingBay(this.target.x, this.target.y, 2.8, 0.8),
      createDashedRoute(this.cargoStart, puzzle.route, this.target),
    );
  }

  _drawPerpendicularParkingScene(puzzle) {
    // 1. Asfalto de playa comercial y cordones perimetrales
    this.courseGroup.add(
      createRoadSurface(5.8, 0, 38, 14, 0x272b34),
      createCurb(5.8, 3.8, 38),
      createCurb(5.8, -3.8, 38),
      createLawn(5.8, -6.4, 38, 5.0, 0.18, 0x3d6824),
    );

    // 2. Líneas de demarcación de boxes en batería (90°)
    const stallLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const sx of [0.4, 3.4, 6.4, 9.4, 12.4]) {
      const stallDivider = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 3.4), stallLineMat);
      stallDivider.position.set(sx - 1.5, -2.0, 0.02);
      this.courseGroup.add(stallDivider);
    }
    const backLine = new THREE.Mesh(new THREE.PlaneGeometry(12.0, 0.14), stallLineMat);
    backLine.position.set(6.4, -3.7, 0.02);
    this.courseGroup.add(backLine);

    // 3. Postes de iluminación LED comercial
    this.courseGroup.add(createStreetLamp(1.8, 3.2), createStreetLamp(11.2, 3.2));

    // 4. Autos estacionados en batería (separación de más de 3.5m)
    const car1 = this._buildParkedCar('urban_pickup');
    car1.position.set(3.4, -2.0, 0.02);
    car1.rotation.z = Math.PI / 2;
    const car2 = this._buildParkedCar('blue_hatchback');
    car2.position.set(9.4, -2.0, 0.02);
    car2.rotation.z = Math.PI / 2;
    this.courseGroup.add(car1, car2);

    // 5. Flechas viales de sentido
    for (const ax of [3.6, 7.8]) {
      const arrowShaft = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.16), stallLineMat);
      arrowShaft.position.set(ax, 1.1, 0.02);
      const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.45, 3), stallLineMat);
      arrowHead.rotation.z = -Math.PI / 2;
      arrowHead.position.set(ax + 0.48, 1.1, 0.02);
      this.courseGroup.add(arrowShaft, arrowHead);
    }

    // 6. Bahía delimitada y guía de aproximación
    this.courseGroup.add(
      createParkingBay(this.target.x, this.target.y, 1.3, 1.6),
      createDashedRoute(this.cargoStart, puzzle.route, this.target),
    );
  }

  _drawSlalomScene(puzzle) {
    // 1. Asfalto de avenida en obras con líneas delimitadoras laterales
    this.courseGroup.add(createRoadSurface(5.8, 0, 38, 14, 0x2e3440));
    const edgeLineMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const edgeTop = new THREE.Mesh(new THREE.PlaneGeometry(38, 0.14), edgeLineMat);
    edgeTop.position.set(7.0, 4.5, 0.02);
    const edgeBottom = new THREE.Mesh(new THREE.PlaneGeometry(38, 0.14), edgeLineMat);
    edgeBottom.position.set(7.0, -4.5, 0.02);
    this.courseGroup.add(edgeTop, edgeBottom);

    // 2. Conos reflectantes y vallas viales según puzzle.obstacles
    for (const obs of puzzle.obstacles) {
      if (obs.type === 'cone') {
        const cone = this._buildTrafficCone();
        cone.position.set(obs.position[0], obs.position[1], 0.01);
        this.courseGroup.add(cone);
      } else if (obs.type === 'barrier') {
        const barrier = this._buildRoadworkBarrier();
        barrier.position.set(obs.position[0], obs.position[1], 0.01);
        this.courseGroup.add(barrier);
      }
    }

    // 3. Señalética y vallas decorativas exteriores
    const signPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8 }),
    );
    signPost.rotation.x = Math.PI / 2;
    signPost.position.set(2.0, 5.2, 1.0);
    const signBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.08, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.3 }),
    );
    signBoard.position.set(2.0, 5.2, 1.7);
    this.courseGroup.add(signPost, signBoard);

    const decorBarrier1 = this._buildRoadworkBarrier();
    decorBarrier1.position.set(4.8, 5.2, 0.01);
    const decorBarrier2 = this._buildRoadworkBarrier();
    decorBarrier2.position.set(8.4, -5.2, 0.01);
    this.courseGroup.add(decorBarrier1, decorBarrier2);

    // 4. Cordones, banquina y bahía de meta
    this.courseGroup.add(
      createCurb(5.8, 4.8, 38),
      createCurb(5.8, -4.8, 38),
      createLawn(5.8, 7.5, 38, 5.0, 0.18, 0x3d6824),
      createLawn(5.8, -7.5, 38, 5.0, 0.18, 0x3d6824),
      createParkingBay(this.target.x, this.target.y, 2.0, 1.4),
      createDashedRoute(this.cargoStart, puzzle.route, this.target),
    );
  }

  _drawAlleyScene(puzzle) {
    // 1. Pavimento de callejón amplio (8.4m libres)
    this.courseGroup.add(createRoadSurface(5.8, 0, 38, 12, 0x1f232b));

    // 2. Muros perimetrales industriales con remates
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.85 });
    const wallCapMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6 });
    const wallTop = new THREE.Mesh(new THREE.BoxGeometry(38, 0.5, 1.6), wallMat);
    wallTop.position.set(5.8, 4.2, 0.8);
    const capTop = new THREE.Mesh(new THREE.BoxGeometry(38, 0.6, 0.12), wallCapMat);
    capTop.position.set(5.8, 4.2, 1.66);
    const wallBottom = new THREE.Mesh(new THREE.BoxGeometry(38, 0.5, 1.6), wallMat);
    wallBottom.position.set(5.8, -4.2, 0.8);
    const capBottom = new THREE.Mesh(new THREE.BoxGeometry(38, 0.6, 0.12), wallCapMat);
    capBottom.position.set(5.8, -4.2, 1.66);
    this.courseGroup.add(wallTop, capTop, wallBottom, capBottom);

    // 3. Furgoneta de reparto y contenedor industrial de residuos
    const vanObs = puzzle.obstacles.find((o) => o.type === 'car' || o.model === 'delivery_van') || {
      position: [5.2, 2.6],
    };
    const van = this._buildParkedCar('delivery_van');
    van.position.set(vanObs.position[0], vanObs.position[1], 0.02);
    van.rotation.z = 0.02;

    const dumpsterObs = puzzle.obstacles.find((o) => o.type === 'dumpster') || { position: [8.6, -2.6] };
    const dumpster = this._buildDumpster();
    dumpster.position.set(dumpsterObs.position[0], dumpsterObs.position[1], 0.02);
    dumpster.rotation.z = -0.04;
    this.courseGroup.add(van, dumpster);

    // Pallets de madera
    const palletMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    for (const px of [3.2, 4.0]) {
      const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.15), palletMat);
      pallet.position.set(px, 3.4, 0.08);
      this.courseGroup.add(pallet);
    }

    // 4. Bahía delimitada de carga y guía de aproximación
    this.courseGroup.add(
      createParkingBay(this.target.x, this.target.y, 1.3, 0.8),
      createDashedRoute(this.cargoStart, puzzle.route, this.target),
    );
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(320, 320);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Asfalto oscuro de alta tecnología para el suelo del laberinto
    ctx.fillStyle = '#0d1219';
    ctx.fillRect(0, 0, 1024, 1024);

    // Losas modulares del laberinto (cuadrícula fina)
    ctx.strokeStyle = 'rgba(25, 38, 52, 0.65)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 1024; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1024);
      ctx.stroke();
    }
    for (let y = 0; y <= 1024; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // Cuadrícula mayor con remaches estructurales
    ctx.strokeStyle = 'rgba(42, 60, 82, 0.8)';
    ctx.lineWidth = 4;
    for (let x = 0; x <= 1024; x += 256) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1024);
      ctx.stroke();
    }
    for (let y = 0; y <= 1024; y += 256) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1024, y);
      ctx.stroke();
    }

    // Guías de carril luminosas con patrón discontínuo
    ctx.strokeStyle = 'rgba(85, 221, 213, 0.35)';
    ctx.lineWidth = 6;
    ctx.setLineDash([36, 32]);
    ctx.beginPath();
    ctx.moveTo(0, 512);
    ctx.lineTo(1024, 512);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(12, 12);
    this.groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88, metalness: 0.2 });
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.position.z = -0.02;
    this.scene.add(ground);
  }

  _buildParkingCourse() {
    // Bahía de estacionamiento amarilla con contorno luminoso (idéntica a la imagen de referencia)
    const hw = 1.65,
      hh = 1.15;
    const pts = [
      new THREE.Vector3(-hw, -hh, 0.04),
      new THREE.Vector3(hw, -hh, 0.04),
      new THREE.Vector3(hw, hh, 0.04),
      new THREE.Vector3(-hw, hh, 0.04),
      new THREE.Vector3(-hw, -hh, 0.04),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffd700, linewidth: 3 });
    const outline = new THREE.Line(lineGeo, lineMat);
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(hw * 2, hh * 2),
      new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    fill.position.z = 0.02;

    const zoneGroup = new THREE.Group();
    zoneGroup.add(outline, fill);

    // 4 postes luminosos de esquina en la bahía de estacionamiento
    const bGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.85, 12);
    const bMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
    const capGeo = new THREE.SphereGeometry(0.1, 12, 8);
    const capMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    const makeBollard = (bx, by) => {
      const bg = new THREE.Group();
      const post = new THREE.Mesh(bGeo, bMat);
      post.rotation.x = Math.PI / 2;
      post.position.z = 0.42;
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.z = 0.85;
      bg.add(post, cap);
      bg.position.set(bx, by, 0);
      return bg;
    };
    zoneGroup.add(makeBollard(-hw, -hh), makeBollard(hw, -hh), makeBollard(hw, hh), makeBollard(-hw, hh));

    // Franjas diagonales de advertencia en el piso de la bahía
    for (let i = -hw + 0.4; i < hw; i += 0.55) {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, hh * 1.6),
        new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.28, depthWrite: false }),
      );
      stripe.rotation.z = Math.PI / 4;
      stripe.position.set(i, 0, 0.025);
      zoneGroup.add(stripe);
    }

    zoneGroup.position.set(this.target.x, this.target.y, 0.03);
    this.zone = zoneGroup;
    this.scene.add(zoneGroup);

    // Mini Auto 3D controlado por la mosca en los circuitos viales urbanos
    this.cargo = this._buildMiniCar();
    this.cargo.position.copy(this.cargoStart);
    this.scene.add(this.cargo);

    this.courseGroup = new THREE.Group();
    this.scene.add(this.courseGroup);

    // Sensores de visión 3D por raycasting (Lidar / Ojos de la mosca MaleCNS)
    this.visionRaysGroup = new THREE.Group();
    this.scene.add(this.visionRaysGroup);
    this._initVisionRayMeshes();

    this._drawPuzzle();

    const marker = new THREE.PointLight(0xffd700, 2.2, 12);
    marker.position.set(this.target.x, this.target.y, 1.4);
    this.goalLight = marker;
    this.scene.add(marker);
  }

  _initVisionRayMeshes() {
    this.visionRayLines = [];
    // Ocultar el cono azul en la arena para mantener visuales realistas y limpios
    this.visionRaysGroup.visible = false;
    const angles = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];
    for (let i = 0; i < angles.length; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array([0, 0, 0, 0, 0, 0]);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.55,
        linewidth: 2,
      });
      const line = new THREE.Line(geo, mat);
      this.visionRaysGroup.add(line);
      this.visionRayLines.push(line);
    }
  }

  _updateVisionSensors() {
    if (!this.cargo || !this.visionRayLines) return [];

    const carX = this.cargo.position.x;
    const carY = this.cargo.position.y;
    // Orientación fija al frente del auto (nunca hacia atrás por maniobras de la mosca)
    const carYaw = this.cargo.rotation.z;

    const originX = carX + Math.cos(carYaw) * 0.85;
    const originY = carY + Math.sin(carYaw) * 0.85;
    const originZ = 0.28;

    const MAX_RANGE = 3.8;
    const angles = [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3];
    const puzzle = this.puzzles[this.puzzleIndex];
    const obstacles = puzzle?.obstacles || [];

    const rayResults = [];

    for (let i = 0; i < angles.length; i++) {
      const angleOffset = angles[i];
      const rayAngle = carYaw + angleOffset;
      const dirX = Math.cos(rayAngle);
      const dirY = Math.sin(rayAngle);

      let closestDist = MAX_RANGE;

      for (const obs of obstacles) {
        if (obs.type === 'roundabout_island') {
          const d = intersectRayCircle(
            originX,
            originY,
            dirX,
            dirY,
            obs.position[0],
            obs.position[1],
            obs.size[0] / 2 + 0.15,
            closestDist,
          );
          if (d < closestDist) closestDist = d;
        } else {
          const hw = obs.size[0] / 2 + 0.15;
          const hh = obs.size[1] / 2 + 0.15;
          const d = intersectRayAABB(
            originX,
            originY,
            dirX,
            dirY,
            obs.position[0] - hw,
            obs.position[0] + hw,
            obs.position[1] - hh,
            obs.position[1] + hh,
            closestDist,
          );
          if (d < closestDist) closestDist = d;
        }
      }

      const dBound = intersectRayAABB(originX, originY, dirX, dirY, -4.0, 24.0, -5.2, 5.2, closestDist);
      if (dBound < closestDist) closestDist = dBound;

      const hitX = originX + dirX * closestDist;
      const hitY = originY + dirY * closestDist;
      const proximity = Math.max(0, 1 - closestDist / MAX_RANGE);

      rayResults.push({
        angleOffset,
        distance: closestDist,
        maxRange: MAX_RANGE,
        proximity,
      });

      if (this.visionRaysGroup.visible && this.visionRayLines[i]) {
        const line = this.visionRayLines[i];
        const positions = line.geometry.attributes.position.array;
        positions[0] = originX;
        positions[1] = originY;
        positions[2] = originZ;
        positions[3] = hitX;
        positions[4] = hitY;
        positions[5] = originZ;
        line.geometry.attributes.position.needsUpdate = true;

        if (proximity > 0.65) {
          line.material.color.setHex(0xef4444);
          line.material.opacity = 0.85;
        } else if (proximity > 0.35) {
          line.material.color.setHex(0xf59e0b);
          line.material.opacity = 0.7;
        } else {
          line.material.color.setHex(0x06b6d4);
          line.material.opacity = 0.45;
        }
      }
    }

    this.latestVisionRays = rayResults;
    return rayResults;
  }

  _drawRoundaboutScene(puzzle) {
    // 1. Asfalto de calzada urbana amplia con rotonda y cordones
    this.courseGroup.add(
      createRoadSurface(6.8, 0, 38, 16, 0x2e3440),
      createCurb(6.8, 5.2, 38),
      createCurb(6.8, -5.2, 38),
      createLawn(6.8, 7.8, 38, 5.0, 0.18, 0x2d6a2e),
      createLawn(6.8, -7.8, 38, 5.0, 0.18, 0x2d6a2e),
    );

    // 2. Isla central circular ajardinada en [7.2, 0.0]
    const islandCenter = puzzle.obstacles && puzzle.obstacles[0] ? puzzle.obstacles[0].position : [7.2, 0.0];
    const islandGroup = new THREE.Group();
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.7 });

    const curbCircle = new THREE.Mesh(new THREE.CylinderGeometry(1.22, 1.25, 0.24, 36), curbMat);
    curbCircle.rotation.x = Math.PI / 2;
    curbCircle.position.z = 0.12;

    const grassCircle = new THREE.Mesh(
      new THREE.CylinderGeometry(1.16, 1.16, 0.06, 36),
      new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.9 }),
    );
    grassCircle.rotation.x = Math.PI / 2;
    grassCircle.position.z = 0.25;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 1.8, 10),
      new THREE.MeshStandardMaterial({ color: 0x543d2b, roughness: 0.9 }),
    );
    trunk.rotation.x = Math.PI / 2;
    trunk.position.z = 1.1;

    const foliage1 = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.4, 12),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 }),
    );
    foliage1.rotation.x = Math.PI / 2;
    foliage1.position.z = 1.95;

    const foliage2 = new THREE.Mesh(
      new THREE.ConeGeometry(0.68, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 }),
    );
    foliage2.rotation.x = Math.PI / 2;
    foliage2.position.z = 2.65;

    islandGroup.add(curbCircle, grassCircle, trunk, foliage1, foliage2);

    const flowerColors = [0xec4899, 0xf59e0b, 0x3b82f6, 0xa855f7];
    for (let f = 0; f < 4; f++) {
      const fa = (f * Math.PI) / 2;
      const bush = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 10, 8),
        new THREE.MeshStandardMaterial({ color: flowerColors[f], roughness: 0.6 }),
      );
      bush.position.set(Math.cos(fa) * 0.72, Math.sin(fa) * 0.72, 0.32);
      islandGroup.add(bush);
    }
    islandGroup.position.set(islandCenter[0], islandCenter[1], 0);
    this.courseGroup.add(islandGroup);

    // 3. Señal azul circular de rotonda en el ingreso y farolas perimetrales
    const signGroup = new THREE.Group();
    const signPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 }),
    );
    signPost.rotation.x = Math.PI / 2;
    signPost.position.z = 0.75;
    const signDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.04, 24),
      new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.3 }),
    );
    signDisc.rotation.z = Math.PI / 2;
    signDisc.position.z = 1.45;
    signGroup.add(signPost, signDisc);
    signGroup.position.set(4.8, -1.8, 0.01);
    this.courseGroup.add(signGroup, createStreetLamp(1.6, 4.8), createStreetLamp(12.8, 4.8));

    // 4. Marcas circulares viales en el asfalto (anillo de guía)
    const ringSegments = 24;
    for (let s = 0; s < ringSegments; s++) {
      if (s % 2 === 0) {
        const a1 = (s * 2 * Math.PI) / ringSegments;
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(0.55, 0.12),
          new THREE.MeshBasicMaterial({ color: 0xffffff }),
        );
        dash.position.set(islandCenter[0] + Math.cos(a1) * 3.2, islandCenter[1] + Math.sin(a1) * 3.2, 0.02);
        dash.rotation.z = a1 + Math.PI / 2;
        this.courseGroup.add(dash);
      }
    }

    // 5. Dársena de salida y guía de aproximación
    this.courseGroup.add(
      createParkingBay(this.target.x, this.target.y, 1.3, 1.0),
      createDashedRoute(this.cargoStart, puzzle.route, this.target),
    );
  }

  _drawTJunctionScene(puzzle) {
    // 1. Calzada principal y ramal norte en T
    const mainRoad = createRoadSurface(6.8, 0, 38, 14, 0x272b34);
    const northBranch = createRoadSurface(7.5, 6.0, 8, 12, 0x272b34);
    this.courseGroup.add(mainRoad, northBranch);

    // 2. Cordones perimetrales y banquinas
    this.courseGroup.add(
      createCurb(6.8, -4.2, 38),
      createCurb(0.0, 3.8, 10.5),
      createCurb(15.0, 3.8, 10.5),
      createLawn(6.8, -6.6, 38, 4.5, 0.18, 0x3d6824),
    );

    // 3. Camión / Pickup obstáculo al fondo este con conos
    const obs = (puzzle.obstacles && puzzle.obstacles[0]) || { position: [10.8, 0.0] };
    const truck = this._buildParkedCar('urban_pickup');
    truck.position.set(obs.position[0], obs.position[1], 0.02);
    truck.rotation.z = 0;
    this.courseGroup.add(truck);

    const c1 = this._buildTrafficCone();
    c1.position.set(obs.position[0] - 1.5, obs.position[1] - 0.7, 0.01);
    const c2 = this._buildTrafficCone();
    c2.position.set(obs.position[0] - 1.5, obs.position[1] + 0.7, 0.01);
    this.courseGroup.add(c1, c2);

    // 4. Cartel de cruce en T y flechas de giro
    const signGroup = new THREE.Group();
    const signPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8 }),
    );
    signPost.rotation.x = Math.PI / 2;
    signPost.position.z = 1.1;
    const signBoard = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.08, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 }),
    );
    signBoard.rotation.y = Math.PI / 4;
    signBoard.position.z = 1.9;
    signGroup.add(signPost, signBoard);
    signGroup.position.set(4.2, 3.8, 0.01);
    this.courseGroup.add(signGroup);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.9), lineMat);
    shaft.position.set(7.5, 0.6, 0.02);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.4, 3), lineMat);
    head.position.set(7.5, 1.2, 0.02);
    this.courseGroup.add(shaft, head);

    // 5. Dársena de retorno y guía de aproximación
    this.courseGroup.add(
      createParkingBay(this.target.x, this.target.y, 1.3, 1.0),
      createDashedRoute(this.cargoStart, puzzle.route, this.target),
    );
  }

  _drawPuzzle() {
    this.courseGroup.clear();
    const puzzle = this.puzzles[this.puzzleIndex];
    if (this.zone) this.zone.visible = false;
    if (this.groundMat) this.groundMat.visible = false;

    if (puzzle.type === 'street_perpendicular') {
      this._drawPerpendicularParkingScene(puzzle);
    } else if (puzzle.type === 'street_slalom') {
      this._drawSlalomScene(puzzle);
    } else if (puzzle.type === 'street_alley') {
      this._drawAlleyScene(puzzle);
    } else if (puzzle.type === 'street_roundabout') {
      this._drawRoundaboutScene(puzzle);
    } else if (puzzle.type === 'street_tjunction') {
      this._drawTJunctionScene(puzzle);
    } else {
      this._drawStreetScene(puzzle);
    }

    const hudLevelName = document.getElementById('hud-level-name');
    if (hudLevelName) {
      hudLevelName.textContent = puzzle.displayName || puzzle.name.toLowerCase();
    }
    const mTitle = document.getElementById('mission-title');
    const mDesc = document.getElementById('mission-desc');
    if (mTitle) {
      mTitle.textContent = `NeuroMechFly | ${puzzle.displayName || puzzle.name}`;
    }
    if (mDesc) {
      mDesc.textContent = puzzle.desc || 'Drive the mini car to the target parking bay.';
    }
  }

  _currentGoal() {
    const puzzle = this.puzzles[this.puzzleIndex];
    return puzzle.route[this.routeIndex] || puzzle.target;
  }

  _resize() {
    this.brainViewer?.resize();
    for (const [renderer, camera, id] of [
      [this.renderer, this.camera, 'game-view'],
      [this.bodyRenderer, this.bodyCamera, 'body-view'],
    ]) {
      const host = document.getElementById(id);
      if (!host) continue;
      const w = host.clientWidth,
        h = host.clientHeight;
      if (!w || !h) continue;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
  }

  _updateCamera(init) {
    const { height, distance } = this.meta.camera;
    const smoothing = 0.85;
    const d = this.data,
      b = this.bodyId;
    const fx = d.xpos[3 * b],
      fy = d.xpos[3 * b + 1],
      fz = d.xpos[3 * b + 2];
    const xm = d.xmat;
    const newYaw = Math.atan2(xm[9 * b + 3], xm[9 * b]);
    if (init || this._yaw === undefined) this._yaw = newYaw;
    this._yaw = Math.atan2(
      smoothing * Math.sin(this._yaw) + (1 - smoothing) * Math.sin(newYaw),
      smoothing * Math.cos(this._yaw) + (1 - smoothing) * Math.cos(newYaw),
    );
    const puzzle = this.puzzles[this.puzzleIndex];

    // Cámara de simulación principal (pantalla izquierda)
    const carX = this.cargo ? this.cargo.position.x : fx;
    const carY = this.cargo ? this.cargo.position.y : fy;

    const isStreet = puzzle && puzzle.type && puzzle.type.startsWith('street');
    if (isStreet) {
      // Perspectiva isométrica elevada para misiones de conducción con encuadre amplio de la avenida
      this.camera.position.set(carX - 4.8, carY - 6.8, 6.2);
      this.camera.lookAt(carX + 1.2, carY + 0.6, 0.45);
    } else {
      // Seguimiento dinámico en corredores del laberinto
      const carYaw = this.cargo ? this.cargo.rotation.z : this._yaw;
      if (init || this._carCamYaw === undefined) this._carCamYaw = carYaw;
      this._carCamYaw = Math.atan2(
        0.88 * Math.sin(this._carCamYaw) + 0.12 * Math.sin(carYaw),
        0.88 * Math.cos(this._carCamYaw) + 0.12 * Math.cos(carYaw),
      );
      const ccy = Math.cos(this._carCamYaw),
        csy = Math.sin(this._carCamYaw);
      this.camera.position.set(carX - ccy * (distance + 3.2), carY - csy * (distance + 3.2), height + 4.8);
      this.camera.lookAt(carX + ccy * 1.5, carY + csy * 1.5, 0.5);
    }

    // Orientación instantánea exacta de Carla en MuJoCo (sin desfase de filtrado)
    // Esto garantiza que Carla quede 100% ESTÁTICA en su eje dentro de la cabina
    const flyYaw = newYaw;
    // prettier-ignore
    const cFly = Math.cos(flyYaw), sFly = Math.sin(flyYaw);

    // Actualizar controles de cabina (volante y pedales) anclados con precisión milimétrica al cuerpo
    if (this.cockpitGroup) {
      this.cockpitGroup.position.set(fx, fy, fz);
      this.cockpitGroup.rotation.z = flyYaw;

      const steer = clamp((this.driveR - this.driveL) * 1.6, -1.25, 1.25);
      this.steeringWheel.rotation.x = steer * 1.45;

      const forwardDrive = Math.max(0, (this.driveL + this.driveR) / 2);
      const isReversing = Boolean(this.unstuckState?.active || (this.driveL < 0 && this.driveR < 0));
      const gasPress = isReversing ? 0.0 : Math.min(1.0, forwardDrive * 1.15);
      const isBraking = isReversing || (forwardDrive < 0.05 && Math.abs(this.driveL) + Math.abs(this.driveR) > 0.1);
      const brakePress = isReversing ? 1.0 : isBraking ? 0.75 : 0.0;
      const gx = this.data?.geom_xpos;

      // 1. Pedales mecánicos de competición en el piso del habitáculo con feedback lumínico y hundimiento
      if (this.brakePedal) {
        this.brakePedal.rotation.y = 0.35 + brakePress * 0.55;
        this.brakePedal.position.set(0.68, 0.26, -1.12 - brakePress * 0.1);
        if (this.brakePedalMat) {
          this.brakePedalMat.emissiveIntensity = brakePress * 2.5;
        }
      }
      if (this.gasPedal) {
        this.gasPedal.rotation.y = 0.35 + gasPress * 0.55;
        this.gasPedal.position.set(0.68, -0.26, -1.12 - gasPress * 0.1);
        if (this.gasPedalMat) {
          this.gasPedalMat.emissiveIntensity = gasPress * 2.2;
        }
      }

      // Iluminación dinámica de la pedalera
      if (this.pedalLight) {
        const activeIntensity = Math.max(brakePress, gasPress);
        this.pedalLight.intensity = 2.0 + activeIntensity * 3.5;
        if (brakePress > gasPress) {
          this.pedalLight.color.setHex(0xff2244);
        } else if (gasPress > 0.1) {
          this.pedalLight.color.setHex(0x10b981);
        } else {
          this.pedalLight.color.setHex(0x38bdf8);
        }
      }

      // Sincronización analítica de brazos al volante y patas a pedales (IK de 2 huesos a 60 FPS)
      if (this.cockpitLimbs) {
        this.cockpitGroup.updateMatrixWorld(true);

        const updateLimb = (limb, origin) => {
          limb.targetAnchor.getWorldPosition(_vTarget);
          this.cockpitGroup.worldToLocal(_vTarget);
          solve2BoneIK(origin, _vTarget, limb.l1, limb.l2, limb.pole, _vJoint);
          limb.meshes.joint.position.copy(_vJoint);
          positionSegment(limb.meshes.upper, origin, _vJoint);
          positionSegment(limb.meshes.lower, _vJoint, _vTarget);
        };

        updateLimb(this.cockpitLimbs.armL, this.cockpitLimbs.armL.shoulder);
        updateLimb(this.cockpitLimbs.armR, this.cockpitLimbs.armR.shoulder);
        updateLimb(this.cockpitLimbs.legL, this.cockpitLimbs.legL.hip);
        updateLimb(this.cockpitLimbs.legR, this.cockpitLimbs.legR.hip);
      }

      // 2. Sensor bucal bajo la probóscide (c_rostrum)
      if (gx && this.tarsusGeoms?.rostrum !== undefined && this.cyanBit) {
        const wx = gx[3 * this.tarsusGeoms.rostrum],
          wy = gx[3 * this.tarsusGeoms.rostrum + 1],
          wz = gx[3 * this.tarsusGeoms.rostrum + 2];
        const dx = wx - fx,
          dy = wy - fy,
          dz = wz - fz;
        const lx = cFly * dx + sFly * dy;
        const ly = -sFly * dx + cFly * dy;
        this.cyanBit.position.set(lx, ly, dz - 0.025);
      }
    }

    // Cámara de cabina: encuadre 3/4 amplio y elevado para apreciar a Carla completa (cabeza, ojos, tórax, alas y patas)
    // junto con el volante y la pedalera iluminada sin recortes
    const camX = 1.65,
      camY = -3.25,
      camZ = 1.15;
    this.bodyCamera.position.set(fx + cFly * camX - sFly * camY, fy + sFly * camX + cFly * camY, fz + camZ);
    const lookX = 0.28,
      lookY = -0.05,
      lookZ = -0.32;
    this.bodyCamera.lookAt(fx + cFly * lookX - sFly * lookY, fy + sFly * lookX + cFly * lookY, fz + lookZ);
  }

  _resetSim() {
    this.mj.mj_resetDataKeyframe(this.model, this.data, 0);
    this.controller.reset();
    this.input.resetGains();

    let startX = this.cargoStart.x;
    let startY = this.cargoStart.y;
    let startYaw = 0;

    if (this.domainRandomization) {
      // Perturbaciones moderadas para evaluar generalización de soluciones
      startX += (Math.random() - 0.5) * 0.35;
      startY += (Math.random() - 0.5) * 0.25;
      startYaw = (Math.random() - 0.5) * 0.22;
    }

    // Posicionar la mosca conductora en el asiento del Mini Auto para inicio instantáneo
    if (this.data.qpos && this.data.qpos.length >= 7) {
      const seatDist = 0.95;
      this.data.qpos[0] = startX - seatDist * Math.cos(startYaw);
      this.data.qpos[1] = startY - seatDist * Math.sin(startYaw);
      this.data.qpos[2] = 0.18;
      this.data.qpos[3] = Math.cos(startYaw / 2);
      this.data.qpos[4] = 0;
      this.data.qpos[5] = 0;
      this.data.qpos[6] = Math.sin(startYaw / 2);
    }

    this.mj.mj_forward(this.model, this.data);
    this.simTime = 0;
    this._simAcc = 0;
    this.stagnantTime = 0;
    this._stagnantCounter = 0;
    this._stuckCheckCounter = 0;
    this._lastWatchdogCarPos = null;
    this._lastWatchdogCarYaw = null;
    this._lastStuckFlyPos = null;
    this.touches = 0;
    this.wasTouching = false;
    this.parkedFor = 0;
    this.routeIndex = 0;
    this.autoPushing = false;
    this.cargo.position.set(startX, startY, this.cargoStart.z);
    this.cargo.rotation.z = startYaw;
    this._yaw = startYaw;
    const b = this.bodyId;
    this.lastFly = new THREE.Vector2(this.data.xpos[3 * b], this.data.xpos[3 * b + 1]);
    this.unstuckState = {
      active: false,
      phase: 'none',
      timer: 0,
      stuckFrames: 0,
      lastFly: [this.data.xpos[3 * b], this.data.xpos[3 * b + 1]],
      stuckTurnDir: 1,
    };
    document.getElementById('timer').textContent = '0.00';
    document.getElementById('touches').textContent = '0';
    this._updateSignals(false, 0.02);
    this._updateCamera(true);
  }

  restart() {
    this._resetSim();
    this._showReady();
    if (this.autopilot) {
      setTimeout(() => {
        if (this.phase === 'ready') this._startCountdown();
      }, 400);
    }
  }

  _showReady() {
    this.phase = 'ready';
    overlayEl.classList.remove('hidden');
    const puzzle = this.puzzles[this.puzzleIndex];
    overlayEl.innerHTML = `<h2>${puzzle.displayName || puzzle.name}</h2><p>${puzzle.desc}</p><button id="go">Start Simulation</button><p style="font-size:11.5px;color:var(--muted)">You can pause or switch missions at any time.</p>`;
    document.getElementById('go').onclick = () => this._startCountdown();
  }

  _startCountdown() {
    this._resetSim();
    this.phase = 'countdown';
    let n = 1;
    const tick = () => {
      if (this.phase !== 'countdown') return;
      overlayEl.classList.remove('hidden');
      overlayEl.innerHTML = '<div class="big">' + (n > 0 ? n : 'GO!') + '</div>';
      if (n < 0) {
        overlayEl.classList.add('hidden');
        this.phase = 'running';
        this.simTime = 0;
        return;
      }
      n--;
      setTimeout(tick, n < 0 ? 150 : 280);
    };
    tick();
  }

  _controlTime() {
    return this.simTime / BASE_PLAYBACK_SPEED;
  }

  _finishRun() {
    this.phase = 'finished';
    const t = this._controlTime();
    const best = this._saveBest(t);
    this.reward += 100.0;
    this.episode += 1;
    this.batchSuccesses = (this.batchSuccesses || 0) + 1;
    const puzzle = this.puzzles[this.puzzleIndex];
    this._savePolicy(puzzle.name, true);
    this._recordEpisodeReward(this.reward);
    this._saveLearning();
    const epEl = this.dom?.episode || document.getElementById('train-episode');
    if (epEl) epEl.textContent = String(this.episode);
    const rewEl = this.dom?.reward || document.getElementById('train-reward');
    if (rewEl) rewEl.textContent = (this.reward >= 0 ? '+' : '') + this.reward.toFixed(1);
    const plastEl = this.dom?.plasticity || document.getElementById('train-plasticity');
    if (plastEl) plastEl.textContent = `Route mastered by Carla! (${t.toFixed(1)}s)`;
    this.brainViewer?.flashPlasticity();

    if (this.isBurstTraining) {
      this.phase = 'finished';
      return;
    }

    if (this.batchActive) {
      this._updateBatchHud();
      if (this.pauseOnSuccess) {
        this.stopBatch();
        overlayEl.classList.remove('hidden');
        overlayEl.innerHTML = `
          <div style="border: 2px solid var(--cyan); border-radius: 14px; padding: 22px 28px; background: rgba(8,16,24,0.96); box-shadow: 0 0 35px rgba(85,221,213,0.35); text-align: center;">
            <h2 style="color:var(--cyan); margin:0 0 8px 0; font-size:24px;">🎉 Mission Accomplished!</h2>
            <p style="margin:0 0 14px 0; color:#cbd5e1; font-size:13.5px;">Carla parked successfully on attempt <b>${this.batchCurrent}</b> of <b>${this.batchTotal > 9000 ? '∞' : this.batchTotal}</b>!</p>
            <div class="big" style="font-size:46px; color:#fff; font-weight:800; margin-bottom: 14px;">${t.toFixed(2)} s</div>
            <div style="display:flex; gap:10px; justify-content:center;">
              <button id="view-success" style="background:#15222e; color:var(--cyan); border:1px solid var(--cyan); padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Inspect Parking</button>
              <button id="continue-batch" style="background:var(--orange); color:#000; border:0; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Continue Training</button>
            </div>
          </div>`;
        document.getElementById('view-success').onclick = () => {
          overlayEl.classList.add('hidden');
          const resumeBtn = document.getElementById('batch-resume-btn');
          if (resumeBtn && this.batchCurrent < this.batchTotal) {
            resumeBtn.style.display = 'block';
            resumeBtn.textContent = `▶ Continue Batch (${this.batchCurrent + 1} / ${this.batchTotal})`;
          }
          const toggleBtn = document.getElementById('batch-toggle-btn');
          if (toggleBtn && this.batchCurrent < this.batchTotal) {
            toggleBtn.textContent = `▶ Resume (${this.batchCurrent + 1}/${this.batchTotal})`;
            toggleBtn.classList.remove('running');
          }
        };
        document.getElementById('continue-batch').onclick = () => {
          overlayEl.classList.add('hidden');
          if (this.batchCurrent < this.batchTotal) {
            this.batchActive = true;
            this.batchCurrent++;
            this._startBatchEpisode();
          } else {
            this._finishBatch(true);
          }
        };
        document.getElementById('best').textContent = best.toFixed(2);
        return;
      } else {
        if (this.batchCurrent >= this.batchTotal) {
          this._finishBatch(true);
          return;
        } else {
          this.batchCurrent++;
          this._startBatchEpisode();
          return;
        }
      }
    }

    overlayEl.classList.remove('hidden');
    overlayEl.innerHTML = `<h2>Mission Accomplished!</h2><p>The connectome coordinated navigation and parking into the bay.</p><div class="big" style="font-size:46px">${t.toFixed(2)} s</div><button id="again">Next Attempt / Play Again</button>`;
    document.getElementById('again').onclick = () => this._startCountdown();
    document.getElementById('best').textContent = best.toFixed(2);
  }

  startBatch(count) {
    this.batchActive = true;
    this.batchTotal = Number(count) || 20;
    this.batchCurrent = 1;
    this.batchSuccesses = 0;
    this.autopilot = true;
    this.isTraining = true;

    const autoBtn = document.getElementById('auto-button');
    if (autoBtn) autoBtn.textContent = 'Autopilot: ON';
    const trainBtn = document.getElementById('train-button');
    if (trainBtn) {
      trainBtn.textContent = 'Training: ON';
      trainBtn.classList.add('active-state');
    }

    // Automatically accelerate to Turbo speed
    if (this.speedMultiplier < 8) {
      this.setSpeed(8);
    }

    const toggleBtn = document.getElementById('batch-toggle-btn');
    if (toggleBtn) {
      toggleBtn.textContent = '⏹ Stop Batch';
      toggleBtn.classList.add('running');
    }

    const batchHud = document.getElementById('batch-hud');
    if (batchHud) batchHud.classList.remove('hidden');

    this._startBatchEpisode();
  }

  stopBatch() {
    this.batchActive = false;
    const toggleBtn = document.getElementById('batch-toggle-btn');
    if (toggleBtn) {
      if (this.batchCurrent > 0 && this.batchCurrent < this.batchTotal) {
        toggleBtn.textContent = `▶ Resume (${this.batchCurrent + 1}/${this.batchTotal})`;
      } else {
        toggleBtn.textContent = '▶ Auto-Batch';
      }
      toggleBtn.classList.remove('running');
    }
    const statusText = document.getElementById('batch-status-text');
    if (statusText) {
      statusText.textContent = 'Paused';
      statusText.style.color = 'var(--muted)';
    }
    const resumeBtn = document.getElementById('batch-resume-btn');
    if (resumeBtn && this.batchCurrent > 0 && this.batchCurrent < this.batchTotal) {
      resumeBtn.style.display = 'block';
      resumeBtn.textContent = `▶ Resume Batch (${this.batchCurrent + 1} / ${this.batchTotal})`;
    }
  }

  _startBatchEpisode() {
    this._resetSim();
    this.phase = 'running';
    this.stagnantTime = 0;
    this._lastWatchdogCarPos = null;
    overlayEl.classList.add('hidden');
    const resumeBtn = document.getElementById('batch-resume-btn');
    if (resumeBtn) resumeBtn.style.display = 'none';
    const toggleBtn = document.getElementById('batch-toggle-btn');
    if (toggleBtn) {
      toggleBtn.textContent = '⏹ Stop Batch';
      toggleBtn.classList.add('running');
    }
    this._updateBatchHud();
  }

  _updateBatchHud() {
    const iterEl = document.getElementById('batch-iter-count');
    if (iterEl) iterEl.textContent = `${this.batchCurrent} / ${this.batchTotal > 9000 ? '∞' : this.batchTotal}`;
    const statusText = document.getElementById('batch-status-text');
    if (statusText) {
      statusText.textContent = `Running (${this.speedMultiplier}×)...`;
      statusText.style.color = 'var(--cyan)';
    }
  }

  _finishBatch(_achieved) {
    this.batchActive = false;
    this.batchCurrent = 0;
    this.phase = 'finished';
    const resumeBtn = document.getElementById('batch-resume-btn');
    if (resumeBtn) resumeBtn.style.display = 'none';
    const toggleBtn = document.getElementById('batch-toggle-btn');
    if (toggleBtn) {
      toggleBtn.textContent = '▶ Auto-Batch';
      toggleBtn.classList.remove('running');
    }
    overlayEl.classList.remove('hidden');
    overlayEl.innerHTML = `
      <div style="border: 1px solid var(--line); border-radius: 12px; padding: 22px 26px; background: #080d13; text-align: center;">
        <h2 style="color:var(--orange); margin-top:0;">Batch of ${this.batchTotal} iterations finished</h2>
        <p style="font-size:14px; margin: 8px 0 16px;">Successes: <b style="color:var(--cyan); font-size:18px;">${this.batchSuccesses}</b> of ${this.batchTotal}</p>
        <p style="color:var(--muted); font-size:12px; margin-bottom: 20px;">Cumulative reward: <b>${(this.reward >= 0 ? '+' : '') + this.reward.toFixed(1)}</b></p>
        <button id="again-batch" style="background:var(--cyan); color:#000; font-weight:700; border:0; padding:9px 18px; border-radius:8px; cursor:pointer; font-size:13px;">Launch Another Batch</button>
      </div>`;
    document.getElementById('again-batch').onclick = () => {
      overlayEl.classList.add('hidden');
      this.startBatch(this.batchTotal);
    };
  }

  runBurstTraining(numEpisodes = 10) {
    if (this.isBurstTraining) return;
    this.isBurstTraining = true;
    overlayEl.classList.add('hidden');

    const burstButtons = [
      document.getElementById('burst-train-btn'),
      document.getElementById('burst-train-panel-btn'),
    ].filter(Boolean);

    burstButtons.forEach((btn) => {
      btn.disabled = true;
      btn.textContent = `⚡ 0/${numEpisodes}`;
    });

    const plastEl = this.dom?.plasticity || document.getElementById('train-plasticity');
    if (plastEl) plastEl.textContent = `⚡ Simulating burst...`;

    let completed = 0;
    const episodesPerSlice = 2;

    const stepSlice = () => {
      const target = Math.min(completed + episodesPerSlice, numEpisodes);
      while (completed < target) {
        this._runHeadlessEpisode();
        completed++;
        burstButtons.forEach((btn) => {
          btn.textContent = `⚡ ${completed}/${numEpisodes}`;
        });
      }

      this._renderRewardSparkline();

      if (completed < numEpisodes) {
        requestAnimationFrame(stepSlice);
      } else {
        this.isBurstTraining = false;
        burstButtons.forEach((btn) => {
          btn.disabled = false;
          btn.textContent = '⚡ Burst';
        });
        if (plastEl) plastEl.textContent = `✓ ${numEpisodes} iterations ready`;
        this.brainViewer?.flashPlasticity();
        this._resetSim();
        this._showReady();
      }
    };

    requestAnimationFrame(stepSlice);
  }

  _runHeadlessEpisode() {
    this._resetSim();
    this.autopilot = true;
    this.phase = 'running';
    const maxSim = this.maxEpisodeTime || 35.0;
    const subSteps = 10;
    const stepDt = this.dt; // 0.002
    const ctrlDt = subSteps * stepDt; // 0.02s
    let lastCarPos = [this.cargo.position.x, this.cargo.position.y];
    let lastCarYaw = this.cargo.rotation.z;
    this.stagnantTime = 0;

    const puzzle = this.puzzles[this.puzzleIndex];

    while (this.simTime < maxSim && this.phase === 'running') {
      // 1. Decisión de piloto automático con dt sincronizado con los 10 sub-pasos físicos (0.02s)
      this._autoDrive(ctrlDt);
      this._routeChanged = false;

      // 2. Ejecutar 10 sub-pasos de física desacoplados de renderizado
      for (let s = 0; s < subSteps; s++) {
        if (this._routeChanged) {
          this._autoDrive(ctrlDt);
          this._routeChanged = false;
        }
        this._physicsStep(1.0);
        this._updateCargo(stepDt);
        if (this.phase !== 'running') break;
      }

      if (this.phase !== 'running') break;

      const goalDistance = Math.hypot(this.cargo.position.x - this.target.x, this.cargo.position.y - this.target.y);
      const isParking = this.routeIndex >= puzzle.route.length && goalDistance < 1.2;

      // 3. Detección realista de estancamiento (solo acumula si intenta avanzar sin moverse por >3s)
      const curCarPos = [this.cargo.position.x, this.cargo.position.y];
      const curCarYaw = this.cargo.rotation.z;
      const moved = Math.hypot(curCarPos[0] - lastCarPos[0], curCarPos[1] - lastCarPos[1]);
      const turned = Math.abs(curCarYaw - lastCarYaw);
      const isDriving = Math.abs(this.driveL) + Math.abs(this.driveR) > 0.25;

      if (isParking) {
        this.stagnantTime = 0;
      } else if (isDriving && moved < 0.0025 && turned < 0.003) {
        this.stagnantTime = (this.stagnantTime || 0) + ctrlDt;
      } else if (moved > 0.006 || turned > 0.006) {
        this.stagnantTime = Math.max(0, (this.stagnantTime || 0) - ctrlDt * 1.5);
      }
      lastCarPos = curCarPos;
      lastCarYaw = curCarYaw;

      // Maniobra refleja MDN de retroceso si se atasca >3s
      if (this.stagnantTime > 3.0 && !this.unstuckState.active) {
        this.unstuckState.active = true;
        this.unstuckState.phase = 'reverse';
        this.unstuckState.timer = 1.1;
        this.unstuckState.stuckTurnDir = Math.random() > 0.5 ? 1 : -1;
      }

      // Solo abortar si persiste atascado por más de 8s continuos
      if (this.stagnantTime > 8.0) {
        this._onWatchdogTimeout('stagnant');
        break;
      }

      if (this.simTime >= maxSim) {
        this._onWatchdogTimeout('timeout');
        break;
      }
    }

    if (this.phase === 'running') {
      this._onWatchdogTimeout('timeout');
    }
  }

  _onWatchdogTimeout(reason) {
    this.episode += 1;
    this.reward = Math.max(-200, this.reward - 10.0);

    const puzzle = this.puzzles[this.puzzleIndex];
    const goalDistance = this.cargo
      ? Math.hypot(this.cargo.position.x - this.target.x, this.cargo.position.y - this.target.y)
      : 99;
    const isParking = this.routeIndex >= puzzle.route.length && goalDistance < 1.2;

    // Solo adaptar offsets si realmente se atascó en ruta (nunca durante maniobra de estacionamiento final)
    if (this.currentPolicy && !isParking && this.routeIndex < puzzle.route.length) {
      if (!this.currentPolicy.offsets) this.currentPolicy.offsets = [];
      if (!this.currentPolicy.offsets[this.routeIndex]) {
        this.currentPolicy.offsets[this.routeIndex] = [0, 0];
      }
      const carPos = [this.cargo ? this.cargo.position.x : 0, this.cargo ? this.cargo.position.y : 0];
      const nearest = puzzle?.obstacles?.find(
        (o) => Math.hypot(carPos[0] - o.position[0], carPos[1] - o.position[1]) < 1.6,
      );
      if (nearest) {
        const awayX = carPos[0] - nearest.position[0];
        const awayY = carPos[1] - nearest.position[1];
        const d = Math.hypot(awayX, awayY) || 1;
        const shiftX = (awayX / d) * 0.08;
        const shiftY = (awayY / d) * 0.08;
        this.currentPolicy.offsets[this.routeIndex][0] = clamp(
          this.currentPolicy.offsets[this.routeIndex][0] + shiftX,
          -0.4,
          0.4,
        );
        this.currentPolicy.offsets[this.routeIndex][1] = clamp(
          this.currentPolicy.offsets[this.routeIndex][1] + shiftY,
          -0.4,
          0.4,
        );
      }
      // Mantener steerGain estable en 1.0 (evita sobreviraje y bandazos)
      this.currentPolicy.steerGain = 1.0;
      this._savePolicy(puzzle.name, false);
      const plastEl = this.dom?.plasticity || document.getElementById('train-plasticity');
      if (plastEl) plastEl.textContent = `Adapting route...`;
    }

    this._recordEpisodeReward(this.reward);
    this._saveLearning();
    const epEl = this.dom?.episode || document.getElementById('train-episode');
    if (epEl) epEl.textContent = String(this.episode);
    const rewEl = this.dom?.reward || document.getElementById('train-reward');
    if (rewEl) rewEl.textContent = (this.reward >= 0 ? '+' : '') + this.reward.toFixed(1);

    if (this.isBurstTraining) {
      this.phase = 'finished';
      return;
    }

    if (this.batchActive) {
      const statusText = document.getElementById('batch-status-text');
      if (statusText) {
        statusText.textContent = reason === 'stagnant' ? 'Stuck · Retrying' : 'Timeout · Retrying';
        statusText.style.color = 'var(--orange)';
      }
      if (this.batchCurrent >= this.batchTotal) {
        this._finishBatch(false);
      } else {
        this.batchCurrent++;
        this._startBatchEpisode();
      }
      return;
    }

    const driveBadge = document.getElementById('hud-drive-badge');
    if (driveBadge) {
      driveBadge.textContent = 'TIMEOUT · RETRY';
      driveBadge.classList.add('reverse');
      setTimeout(() => driveBadge.classList.remove('reverse'), 1000);
    }
    this._resetSim();
    this.phase = 'running';
  }

  _saveBest(t) {
    const key = `nmf-parking-best-p${this.puzzleIndex}`;
    const old = Number(localStorage.getItem(key)) || Infinity;
    const best = Math.min(old, t);
    try {
      localStorage.setItem(key, String(best));
    } catch {}
    return best;
  }

  _saveLearning() {
    try {
      localStorage.setItem('nmf-learning-episode', String(this.episode));
      localStorage.setItem('nmf-learning-reward', this.reward.toFixed(1));
      localStorage.setItem('nmf-learning-history', JSON.stringify(this.rewardHistory));
    } catch {}
  }

  _recordEpisodeReward(rew) {
    this.rewardHistory.push(Number(rew.toFixed(1)));
    if (this.rewardHistory.length > 40) this.rewardHistory.shift();
    this._renderRewardSparkline();
  }

  _renderRewardSparkline() {
    const canvas = document.getElementById('reward-sparkline');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width,
      h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const history = this.rewardHistory || [];
    if (history.length === 0) return;

    const trendEl = document.getElementById('sparkline-trend');
    const latest = history[history.length - 1];
    if (trendEl) {
      trendEl.textContent = (latest >= 0 ? '+' : '') + latest.toFixed(1);
    }

    if (history.length === 1) {
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    let minR = Math.min(...history);
    let maxR = Math.max(...history);
    if (maxR - minR < 1e-3) {
      minR -= 10;
      maxR += 10;
    }

    const pad = 8;
    const step = (w - pad * 2) / (history.length - 1);

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.40)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0.02)');

    ctx.beginPath();
    history.forEach((val, i) => {
      const x = pad + i * step;
      const y = h - pad - ((val - minR) / (maxR - minR)) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad + (history.length - 1) * step, h);
    ctx.lineTo(pad, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line stroke
    ctx.beginPath();
    history.forEach((val, i) => {
      const x = pad + i * step;
      const y = h - pad - ((val - minR) / (maxR - minR)) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Point dots
    history.forEach((val, i) => {
      const x = pad + i * step;
      const y = h - pad - ((val - minR) / (maxR - minR)) * (h - pad * 2);
      ctx.beginPath();
      ctx.arc(x, y, i === history.length - 1 ? 3 : 1.8, 0, Math.PI * 2);
      ctx.fillStyle = i === history.length - 1 ? '#10b981' : '#55ddd5';
      ctx.fill();
    });
  }

  _loadPolicy(puzzleName) {
    try {
      const raw = localStorage.getItem(`nmf-policy-${puzzleName}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) {
          const safeOffsets = Array.isArray(parsed.offsets)
            ? parsed.offsets.map((off) => {
                if (!Array.isArray(off) || off.length < 2) return [0, 0];
                const ox = clamp(Number(off[0]) || 0, -0.4, 0.4);
                const oy = clamp(Number(off[1]) || 0, -0.4, 0.4);
                return [ox, oy];
              })
            : [];
          const safeSteerGain = 1.0;
          return {
            name: puzzleName,
            offsets: safeOffsets,
            steerGain: safeSteerGain,
            successCount: Number(parsed.successCount) || 0,
            attempts: Number(parsed.attempts) || 0,
          };
        }
      }
    } catch {}
    return {
      name: puzzleName,
      offsets: [],
      steerGain: 1.0,
      successCount: 0,
      attempts: 0,
    };
  }

  _savePolicy(puzzleName, succeeded = false) {
    if (!this.currentPolicy) return;
    if (succeeded) this.currentPolicy.successCount = (this.currentPolicy.successCount || 0) + 1;
    this.currentPolicy.attempts = (this.currentPolicy.attempts || 0) + 1;
    try {
      localStorage.setItem(`nmf-policy-${puzzleName}`, JSON.stringify(this.currentPolicy));
    } catch {}
  }

  _renderBest() {
    const key = `nmf-parking-best-p${this.puzzleIndex}`;
    const best = Number(localStorage.getItem(key));
    document.getElementById('best').textContent = best ? best.toFixed(2) : '—';
  }

  setSpeed(multiplier) {
    this.speedMultiplier = multiplier;
    this._simAcc = 0;
    document.querySelectorAll('.speed-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === multiplier);
    });
    const badge = document.getElementById('speed-badge');
    if (badge) {
      badge.textContent = `${multiplier}×`;
      badge.classList.toggle('turbo', multiplier >= 8);
    }
  }

  selectPuzzle(index) {
    this.puzzleIndex = Math.max(0, Math.min(this.puzzles.length - 1, index));
    try {
      localStorage.setItem('nmf-selected-puzzle', String(this.puzzleIndex));
    } catch {}

    const puzzle = this.puzzles[this.puzzleIndex];
    this.currentPolicy = this._loadPolicy(puzzle.name);
    this.cargoStart.set(puzzle.cargo[0], puzzle.cargo[1], 0.75);
    this.target.set(puzzle.target[0], puzzle.target[1]);
    this.routeIndex = 0;
    this.zone.position.set(this.target.x, this.target.y, 0.03);
    this.goalLight.position.set(this.target.x, this.target.y, 1.2);

    const selectEl = document.getElementById('puzzle-select');
    if (selectEl && selectEl.value !== String(this.puzzleIndex)) {
      selectEl.value = String(this.puzzleIndex);
    }

    this._drawPuzzle();
    this._renderBest();
    this.restart();
  }

  /**
   * Inicializa la caché de nodos del DOM para evitar consultas repetitivas
   * con document.getElementById y querySelector en el ciclo principal a 60 FPS.
   */
  _initDomCache() {
    this.dom = {
      bars: {
        forward: document.getElementById('bar-forward'),
        turn: document.getElementById('bar-turn'),
        mdn: document.getElementById('bar-mdn'),
        contact: document.getElementById('bar-contact'),
        cpg: document.getElementById('bar-cpg'),
      },
      values: {
        forward: document.getElementById('value-forward'),
        turn: document.getElementById('value-turn'),
        mdn: document.getElementById('value-mdn'),
        contact: document.getElementById('value-contact'),
        cpg: document.getElementById('value-cpg'),
      },
      neurons: {
        mdn: this._cacheNeuronRow('mdn'),
        turn: this._cacheNeuronRow('turn'),
        left: this._cacheNeuronRow('left'),
        right: this._cacheNeuronRow('right'),
        contact: this._cacheNeuronRow('contact'),
      },
      reward: document.getElementById('train-reward'),
      driveBadge: document.getElementById('hud-drive-badge'),
      speedo: document.getElementById('hud-speedometer'),
      attemptElapsed: document.getElementById('hud-attempt-elapsed'),
      gear: document.getElementById('gear-indicator'),
      gas: document.getElementById('tele-gas'),
      brake: document.getElementById('tele-brake'),
      wheel: document.getElementById('tele-wheel'),
      target: document.getElementById('tele-target'),
      steer: document.getElementById('tele-steer'),
      timer: document.getElementById('timer'),
      touches: document.getElementById('touches'),
      strategy: document.getElementById('strategy'),
    };
  }

  _cacheNeuronRow(name) {
    const row = document.querySelector('[data-neuron="' + name + '"]');
    if (!row) return null;
    return {
      row,
      bar: row.querySelector('b'),
      output: row.querySelector('output'),
    };
  }

  _wireUi() {
    this._initDomCache();

    // 1. Puzzle selector
    const selectEl = document.getElementById('puzzle-select');
    if (selectEl) {
      selectEl.innerHTML = this.puzzles
        .map((p, i) => `<option value="${i}">${i + 1}. [${p.difficulty}] ${p.name}</option>`)
        .join('');
      selectEl.value = String(this.puzzleIndex);
      selectEl.onchange = (e) => this.selectPuzzle(Number(e.target.value));
    }

    // 2. Speed controls
    document.querySelectorAll('.speed-btn').forEach((btn) => {
      btn.onclick = () => this.setSpeed(Number(btn.dataset.speed));
    });
    this.setSpeed(this.speedMultiplier);

    // Keyboard shortcuts for speed
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === '+' || k === '=') {
        const speeds = [1, 4, 8];
        const next = speeds[Math.min(speeds.length - 1, speeds.indexOf(this.speedMultiplier) + 1)];
        this.setSpeed(next);
      } else if (k === '-' || k === '_') {
        const speeds = [1, 4, 8];
        const prev = speeds[Math.max(0, speeds.indexOf(this.speedMultiplier) - 1)];
        this.setSpeed(prev);
      } else if (k === 't') {
        const speeds = [1, 4, 8];
        const idx = (speeds.indexOf(this.speedMultiplier) + 1) % speeds.length;
        this.setSpeed(speeds[idx]);
      }
    });

    // 3. Topbar buttons
    document.getElementById('reset-button').onclick = () => this.restart();

    document.getElementById('auto-button').onclick = (e) => {
      this.autopilot = !this.autopilot;
      e.currentTarget.textContent = 'Autopilot: ' + (this.autopilot ? 'ON' : 'OFF');
      if (!this.autopilot) {
        this.input.resetGains();
        this.driveL = this.driveR = 0;
      }
    };

    // Auto-Lote & Entrenamiento Sandbox Automático
    const batchToggleBtn = document.getElementById('batch-toggle-btn');
    if (batchToggleBtn) {
      batchToggleBtn.onclick = () => {
        if (this.batchActive) {
          this.stopBatch();
        } else if (this.batchCurrent > 0 && this.batchCurrent < this.batchTotal && this.phase === 'finished') {
          this.batchActive = true;
          this.batchCurrent++;
          const resumeBtn = document.getElementById('batch-resume-btn');
          if (resumeBtn) resumeBtn.style.display = 'none';
          this._startBatchEpisode();
        } else {
          const selectEl = document.getElementById('batch-select');
          const count = selectEl ? Number(selectEl.value) : 20;
          this.startBatch(count);
        }
      };
    }

    const batchResumeBtn = document.getElementById('batch-resume-btn');
    if (batchResumeBtn) {
      batchResumeBtn.onclick = () => {
        if (this.batchCurrent < this.batchTotal) {
          this.batchActive = true;
          this.batchCurrent++;
          batchResumeBtn.style.display = 'none';
          this._startBatchEpisode();
        } else {
          this._finishBatch(true);
        }
      };
    }

    const wireBurst = (btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.onclick = () => {
          const selectEl = document.getElementById('batch-select');
          const count = selectEl ? Math.min(20, Math.max(5, parseInt(selectEl.value, 10) || 10)) : 10;
          this.runBurstTraining(count);
        };
      }
    };
    wireBurst('burst-train-btn');
    wireBurst('burst-train-panel-btn');

    const batchSelect = document.getElementById('batch-select');
    if (batchSelect) {
      batchSelect.onchange = (e) => {
        this.batchTotal = Number(e.target.value);
        if (this.batchActive) {
          this._updateBatchHud();
        }
      };
    }

    const checkPause = document.getElementById('check-pause-success');
    if (checkPause) {
      this.pauseOnSuccess = checkPause.checked;
      checkPause.onchange = (e) => {
        this.pauseOnSuccess = e.target.checked;
      };
    }

    const checkDomainRand = document.getElementById('check-domain-rand');
    if (checkDomainRand) {
      this.domainRandomization = checkDomainRand.checked;
      checkDomainRand.onchange = (e) => {
        this.domainRandomization = e.target.checked;
      };
    }

    const trainBtn = document.getElementById('train-button');
    if (trainBtn) {
      trainBtn.onclick = () => {
        this.isTraining = !this.isTraining;
        trainBtn.textContent = 'Training: ' + (this.isTraining ? 'ON' : 'OFF');
        trainBtn.classList.toggle('active-state', this.isTraining);
        const plasEl = document.getElementById('train-plasticity');
        if (plasEl) {
          plasEl.textContent = this.isTraining ? 'Adaptive' : 'Fixed';
          plasEl.style.color = this.isTraining ? 'var(--cyan)' : 'var(--muted)';
        }
      };
    }

    document.getElementById('pause-button').onclick = (e) => {
      if (this.phase === 'running') {
        this.phase = 'paused';
        e.currentTarget.textContent = 'Resume';
      } else if (this.phase === 'paused') {
        this.phase = 'running';
        e.currentTarget.textContent = 'Pause';
      }
    };

    // 4. Brain actions
    const nextBtn = document.getElementById('next-puzzle-btn');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this.selectPuzzle((this.puzzleIndex + 1) % this.puzzles.length);
      };
    }

    const resetLearnBtn = document.getElementById('reset-learning-btn');
    if (resetLearnBtn) {
      resetLearnBtn.onclick = () => {
        this.episode = 1;
        this.reward = 0.0;
        this.rewardHistory = [0.0];
        try {
          localStorage.removeItem('nmf-learning-episode');
          localStorage.removeItem('nmf-learning-reward');
          localStorage.removeItem('nmf-learning-history');
          for (const p of this.puzzles) {
            localStorage.removeItem(`nmf-policy-${p.name}`);
          }
        } catch {}
        this.currentPolicy = this._loadPolicy(this.puzzles[this.puzzleIndex].name);
        document.getElementById('train-episode').textContent = '1';
        document.getElementById('train-reward').textContent = '+0.0';
        const plasEl = document.getElementById('train-plasticity');
        if (plasEl) plasEl.textContent = 'Reset';
        this._renderRewardSparkline();
        this.brainViewer?.flashPlasticity();
        this.restart();
      };
    }

    // Inicializar lecturas de aprendizaje y curva sparkline desde valores persistidos
    const initEpEl = document.getElementById('train-episode');
    if (initEpEl) initEpEl.textContent = String(this.episode);
    const initRewEl = document.getElementById('train-reward');
    if (initRewEl) initRewEl.textContent = (this.reward >= 0 ? '+' : '') + this.reward.toFixed(1);
    this._renderRewardSparkline();

    // 5. On-screen controls
    document.querySelectorAll('[data-key]').forEach((button) => {
      const activate = (e) => {
        e.preventDefault();
        const key = button.dataset.key;
        this.input._cpgKey(key);
        document.querySelectorAll('[data-key]').forEach((b) => b.classList.toggle('active', b === button));
        if (this.phase === 'ready') this._startCountdown();
      };
      button.addEventListener('pointerdown', activate);
    });

    // 6. Botones de solicitud de giro en telemetría inferior
    const btnReqLeft = document.getElementById('btn-req-left');
    if (btnReqLeft) {
      btnReqLeft.onclick = () => {
        this._steerRequest = -0.75;
        this._steerRequestTimer = 0.85;
        if (this.phase === 'ready') this._startCountdown();
      };
    }
    const btnReqRight = document.getElementById('btn-req-right');
    if (btnReqRight) {
      btnReqRight.onclick = () => {
        this._steerRequest = 0.75;
        this._steerRequestTimer = 0.85;
        if (this.phase === 'ready') this._startCountdown();
      };
    }

    this._renderBest();
  }

  _resolveCargoCollisions(x, y, yaw, _oldX, _oldY) {
    let curX = x,
      curY = y;
    let collided = false;
    let nearestObstacle = null;
    let minObsDist = Infinity;

    const puzzle = this.puzzles[this.puzzleIndex];
    if (puzzle && puzzle.obstacles) {
      for (const obs of puzzle.obstacles) {
        const ox = obs.position[0],
          oy = obs.position[1];
        const distToCenter = Math.hypot(curX - ox, curY - oy);
        if (distToCenter < minObsDist) {
          minObsDist = distToCenter;
          nearestObstacle = obs;
        }

        if (obs.type === 'roundabout_island') {
          // Circular roundabout island: continuous radial deflection
          const rIsland = obs.size[0] / 2;
          const rCar = 0.65;
          const rMin = rIsland + rCar;
          const dx = curX - ox,
            dy = curY - oy;
          const dist = Math.hypot(dx, dy);
          if (dist < rMin) {
            collided = true;
            const nx = dist > 0.001 ? dx / dist : 1;
            const ny = dist > 0.001 ? dy / dist : 0;
            curX = ox + nx * rMin;
            curY = oy + ny * rMin;
          }
        } else if (obs.type === 'cone') {
          // Pylon / cone obstacle: radial cylinder collision with generous clearance
          const rCone = 0.18;
          const rCar = 0.38;
          const rMin = rCone + rCar;
          const dx = curX - ox,
            dy = curY - oy;
          const dist = Math.hypot(dx, dy);
          if (dist < rMin) {
            collided = true;
            const nx = dist > 0.001 ? dx / dist : 1;
            const ny = dist > 0.001 ? dy / dist : 0;
            curX = ox + nx * rMin;
            curY = oy + ny * rMin;
          }
        } else {
          // Rectangular vehicles, vans, dumpsters: AABB sliding resolution with minimal penetration normal
          const halfObsX = obs.size[0] / 2;
          const halfObsY = obs.size[1] / 2;
          const cosY = Math.abs(Math.cos(yaw || 0));
          const sinY = Math.abs(Math.sin(yaw || 0));
          const carExtentX = cosY * 0.72 + sinY * 0.44;
          const carExtentY = sinY * 0.72 + cosY * 0.44;
          const totalX = halfObsX + carExtentX;
          const totalY = halfObsY + carExtentY;

          const distX = Math.abs(curX - ox);
          const distY = Math.abs(curY - oy);
          if (distX < totalX && distY < totalY) {
            collided = true;
            const penX = totalX - distX;
            const penY = totalY - distY;
            if (penX < penY) {
              curX = curX > ox ? ox + totalX : ox - totalX;
            } else {
              curY = curY > oy ? oy + totalY : oy - totalY;
            }
          }
        }
      }
    }

    // Street curbs and perimeter boundary resolution (expanded to 22.0m for roomy parking bays)
    const minX = -3.5,
      maxX = 22.0;
    const minY = -5.2,
      maxY = 5.2;
    if (curX < minX) {
      curX = minX;
      collided = true;
    }
    if (curX > maxX) {
      curX = maxX;
      collided = true;
    }
    if (curY < minY) {
      curY = minY;
      collided = true;
    }
    if (curY > maxY) {
      curY = maxY;
      collided = true;
    }

    return { x: curX, y: curY, collided, nearestObstacle };
  }

  _cargoHitsObstacle(x, y, yaw) {
    const puzzle = this.puzzles[this.puzzleIndex];
    if (!puzzle || !puzzle.obstacles || puzzle.obstacles.length === 0) return false;

    // Fast check with continuous sliding resolver
    if (this._resolveCargoCollisions(x, y, yaw, x, y).collided) return true;

    // Safety multi-point perimeter check
    if (cargoHitsObstacle(puzzle, x, y, 0.35)) return true;

    if (yaw !== undefined) {
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const halfL = 0.84;
      const halfW = 0.54;

      const points = [
        [x + cosY * halfL, y + sinY * halfL],
        [x - cosY * halfL, y - sinY * halfL],
        [x + cosY * halfL - sinY * halfW, y + sinY * halfL + cosY * halfW],
        [x + cosY * halfL + sinY * halfW, y + sinY * halfL - cosY * halfW],
        [x - cosY * halfL - sinY * halfW, y - sinY * halfL + cosY * halfW],
        [x - cosY * halfL + sinY * halfW, y - sinY * halfL - cosY * halfW],
      ];

      for (const [px, py] of points) {
        if (cargoHitsObstacle(puzzle, px, py, 0.08)) return true;
      }
    }

    return false;
  }

  /**
   * Actualiza la cinemática del vehículo y la interacción física con Carla.
   *
   * Modelo Cinemático Ackermann (Bicycle Model):
   * 1. Desplazamiento longitudinal no holonómico:
   *    Un vehículo con ruedas restringe el movimiento lateral sin derrape ("no sideways crabbing").
   *    La traslación se obtiene proyectando el desplazamiento flyDelta sobre el vector director del chasis:
   *    ds = flyDelta.x * carCos + flyDelta.y * carSin.
   * 2. Ángulo de guiñada dependiente de rodadura:
   *    El cambio de rumbo dTheta solo ocurre si hay traslación longitudinal efectiva (ds > 0.0001):
   *    dTheta = (ds / wheelbase) * tan(steerAngle). Si el vehículo está detenido, dTheta = 0.
   * 3. Integración sobre el arco medio de rodadura circular:
   *    dx = ds * cos(avgRot), dy = ds * sin(avgRot), con avgRot = oldRotZ + dTheta * 0.5.
   * 4. Detección y respuesta elástica ante obstáculos del entorno vial:
   *    Si se detecta colisión, se restituyen las coordenadas anteriores (impenetrabilidad)
   *    y se aplica adaptación plástica de evasión acotada a ±1.5m.
   *
   * @param {number} subDt Timestep del sub-paso de física
   * @returns {boolean} true si Carla está en rango de interacción con el vehículo
   */
  _updateCargo(subDt) {
    const b = this.bodyId;
    const fly = new THREE.Vector2(this.data.xpos[3 * b], this.data.xpos[3 * b + 1]);
    const flyDelta = fly.clone().sub(this.lastFly);
    const distance = fly.distanceTo(new THREE.Vector2(this.cargo.position.x, this.cargo.position.y));
    const touching = distance < 2.25;

    if (touching && !this.wasTouching) {
      this.touches++;
      const touchesEl = this.dom?.touches || document.getElementById('touches');
      if (touchesEl) touchesEl.textContent = String(this.touches);
    }

    const canPush = touching && (!this.autopilot || this.autoPushing || distance < 1.45);
    if (canPush) {
      const oldX = this.cargo.position.x,
        oldY = this.cargo.position.y;
      const oldRotZ = this.cargo.rotation.z;

      // 1. Cinemática vehicular no holonómica (Modelo Bicicleta / Ackermann):
      // Un auto real SOLO puede desplazarse a lo largo de su eje longitudinal de marcha.
      // Queda completamente imposibilitado el desplazamiento diagonal o lateral ("crabbing").
      const carCos = Math.cos(oldRotZ),
        carSin = Math.sin(oldRotZ);
      const ds = flyDelta.x * carCos + flyDelta.y * carSin;

      // 2. Ángulo de giro de las ruedas delanteras según comando de dirección
      const steerCmd = this.driveR - this.driveL;
      const maxSteerAngle = 0.45; // ~26 grados de giro máximo
      const steerAngle = clamp(steerCmd * 0.72, -maxSteerAngle, maxSteerAngle);
      if (this.frontLeftPivot) this.frontLeftPivot.rotation.z = steerAngle;
      if (this.frontRightPivot) this.frontRightPivot.rotation.z = steerAngle;

      // 3. Modelo de giro con rodadura (Ackermann):
      // Un auto real NUNCA gira sobre su propio eje en el lugar estando detenido.
      // El cambio angular dTheta depende estrictamente de la rodadura (dTheta = (ds / L) * tan(delta)).
      const wheelbase = 1.45; // Batalla entre ejes del Mini Cooper
      const dTheta = Math.abs(ds) > 0.0001 ? (ds / wheelbase) * Math.tan(steerAngle) : 0;
      const newRotZ = oldRotZ + dTheta;

      // 4. Posición actualizada estrictamente a lo largo de la trayectoria de rodadura
      const avgRot = oldRotZ + dTheta * 0.5;
      this.cargo.position.x = oldX + ds * Math.cos(avgRot);
      this.cargo.position.y = oldY + ds * Math.sin(avgRot);
      this.cargo.rotation.z = newRotZ;

      // Rodadura de las 4 ruedas proporcional al avance longitudinal real
      const movedDist = Math.abs(ds);
      if (movedDist > 0.0005 && this.carWheels) {
        for (const w of this.carWheels) w.rotation.y -= ds * 4.5;
      }

      // 5. Continuous Sliding Collision Resolution:
      // Prevents penetrations into obstacles, curbs and vehicles while maintaining tangential
      // motion so the car can smoothly slide along surfaces and steer away without getting stuck.
      const col = this._resolveCargoCollisions(this.cargo.position.x, this.cargo.position.y, newRotZ, oldX, oldY);
      this.cargo.position.x = col.x;
      this.cargo.position.y = col.y;

      // Synchronize Carla in the driver seat rigidly to the collision-resolved car position
      if (this.data && this.data.qpos && this.data.qpos.length >= 7) {
        const seatDist = 0.95;
        this.data.qpos[0] = col.x - Math.cos(newRotZ) * seatDist;
        this.data.qpos[1] = col.y - Math.sin(newRotZ) * seatDist;
        this._yaw = newRotZ;
        if (col.collided && this.data.qvel) {
          this.data.qvel[0] *= 0.5;
          this.data.qvel[1] *= 0.5;
        }
        this.mj.mj_forward(this.model, this.data);
        fly.set(this.data.xpos[3 * b], this.data.xpos[3 * b + 1]);
      }

      if (col.collided) {
        // Minor collision penalty and learning feedback (adaptive offsets are applied safely upon episode completion)
        if (this.isTraining && Math.random() < 0.2) {
          this.reward = Math.max(-100, this.reward - 0.5);
          this.brainViewer?.flashPlasticity();
        }
      }
    } else if (this.unstuckState && this.unstuckState.active) {
      // Active recovery maneuver with sliding collision avoidance
      const stepDt = typeof subDt === 'number' && subDt > 0 ? subDt : 0.002;
      if (this.unstuckState.phase === 'reverse') {
        const ds = -1.4 * stepDt;
        const turnDir = this.unstuckState.stuckTurnDir || 1;
        const steer = turnDir * 0.35;
        const dTheta = (ds / 1.45) * Math.tan(steer);
        const carYaw = this.cargo.rotation.z + dTheta;
        const nextX = this.cargo.position.x + ds * Math.cos(this.cargo.rotation.z + dTheta * 0.5);
        const nextY = this.cargo.position.y + ds * Math.sin(this.cargo.rotation.z + dTheta * 0.5);
        const col = this._resolveCargoCollisions(nextX, nextY, carYaw, this.cargo.position.x, this.cargo.position.y);
        this.cargo.position.x = col.x;
        this.cargo.position.y = col.y;
        this.cargo.rotation.z = carYaw;
        if (this.data && this.data.qpos && this.data.qpos.length >= 7) {
          const seatDist = 0.95;
          this.data.qpos[0] = col.x - Math.cos(carYaw) * seatDist;
          this.data.qpos[1] = col.y - Math.sin(carYaw) * seatDist;
          this._yaw = carYaw;
          this.mj.mj_forward(this.model, this.data);
          fly.set(this.data.xpos[3 * b], this.data.xpos[3 * b + 1]);
        }
        if (this.carWheels) {
          for (const w of this.carWheels) w.rotation.y -= ds * 4.5;
        }
      } else if (this.unstuckState.phase === 'turn') {
        const ds = 1.1 * stepDt;
        const turnDir = -(this.unstuckState.stuckTurnDir || 1);
        const steer = turnDir * 0.35;
        const dTheta = (ds / 1.45) * Math.tan(steer);
        const carYaw = this.cargo.rotation.z + dTheta;
        const nextX = this.cargo.position.x + ds * Math.cos(this.cargo.rotation.z + dTheta * 0.5);
        const nextY = this.cargo.position.y + ds * Math.sin(this.cargo.rotation.z + dTheta * 0.5);
        const col = this._resolveCargoCollisions(nextX, nextY, carYaw, this.cargo.position.x, this.cargo.position.y);
        this.cargo.position.x = col.x;
        this.cargo.position.y = col.y;
        this.cargo.rotation.z = carYaw;
        if (this.data && this.data.qpos && this.data.qpos.length >= 7) {
          const seatDist = 0.95;
          this.data.qpos[0] = col.x - Math.cos(carYaw) * seatDist;
          this.data.qpos[1] = col.y - Math.sin(carYaw) * seatDist;
          this._yaw = carYaw;
          this.mj.mj_forward(this.model, this.data);
          fly.set(this.data.xpos[3 * b], this.data.xpos[3 * b + 1]);
        }
        if (this.carWheels) {
          for (const w of this.carWheels) w.rotation.y -= ds * 4.5;
        }
      }
    } else {
      // Si Carla no está empujando ni al volante (solo fuera del auto a más de 1.45m)
      const distToCar = fly.distanceTo(new THREE.Vector2(this.cargo.position.x, this.cargo.position.y));
      const minSolidDist = 0.92;
      if (distToCar < minSolidDist && distance >= 1.45 && this.data?.qpos && this.data.qpos.length >= 7) {
        const awayX = fly.x - this.cargo.position.x;
        const awayY = fly.y - this.cargo.position.y;
        const d = Math.hypot(awayX, awayY) || 1;
        this.data.qpos[0] = this.cargo.position.x + (awayX / d) * minSolidDist;
        this.data.qpos[1] = this.cargo.position.y + (awayY / d) * minSolidDist;
        if (this.data.qvel) {
          this.data.qvel[0] *= 0.2;
          this.data.qvel[1] *= 0.2;
        }
        this.mj.mj_forward(this.model, this.data);
        fly.set(this.data.xpos[3 * b], this.data.xpos[3 * b + 1]);
      }
    }

    // Safety clamping inside playable boundary (expanded to 22.0m for full avenue driving)
    this.cargo.position.x = THREE.MathUtils.clamp(this.cargo.position.x, -3.5, 22.0);
    this.cargo.position.y = THREE.MathUtils.clamp(this.cargo.position.y, -5.2, 5.2);

    this.lastFly.copy(fly);
    this.wasTouching = touching;

    const puzzle = this.puzzles[this.puzzleIndex];
    const activeGoal = this._currentGoal();
    const activeDistance = Math.hypot(this.cargo.position.x - activeGoal[0], this.cargo.position.y - activeGoal[1]);

    let passed = false;
    if (this.routeIndex < puzzle.route.length) {
      const nextGoal = puzzle.route[this.routeIndex + 1] || puzzle.target;
      const segDx = nextGoal[0] - activeGoal[0];
      const segDy = nextGoal[1] - activeGoal[1];
      const carDx = this.cargo.position.x - activeGoal[0];
      const carDy = this.cargo.position.y - activeGoal[1];
      passed = segDx * carDx + segDy * carDy > 0;
    }

    if (this.routeIndex < puzzle.route.length && (activeDistance < 1.35 || (activeDistance < 2.8 && passed))) {
      this.routeIndex++;
      this._routeChanged = true;
      if (this.isTraining) {
        this.reward += 20.0;
        this.brainViewer?.flashPlasticity();
      }
    }

    const goalDistance = Math.hypot(this.cargo.position.x - this.target.x, this.cargo.position.y - this.target.y);
    const parkConfirmRate = typeof subDt === 'number' && subDt > 0 ? subDt : 0.016;
    this.parkedFor =
      this.routeIndex >= puzzle.route.length && goalDistance < 1.4 ? this.parkedFor + parkConfirmRate : 0;
    if (this.parkedFor > 0.45) this._finishRun();

    return touching;
  }

  _updateSignals(touching, wallDt) {
    if (!this.dom) this._initDomCache();

    const forward = Math.min(1, Math.abs((this.driveL + this.driveR) / 2));
    const turn = Math.min(1, Math.abs(this.driveL - this.driveR) / 1.6);
    const cpg = Math.min(1, this.controller.mags.reduce((sum, value) => sum + Math.abs(value), 0) / 6);
    const mdnVal = this.unstuckState.active ? 1.0 : this.autoPushing ? 0.2 : 0.05;

    const values = { forward, turn, mdn: mdnVal, contact: touching ? 1 : Math.min(1, this.data.ncon / 20), cpg };
    for (const [name, value] of Object.entries(values)) {
      const bar = this.dom.bars[name];
      const val = this.dom.values[name];
      if (bar) bar.style.width = (value * 100).toFixed(0) + '%';
      if (val) val.textContent = value.toFixed(2);
    }

    const neurons = {
      mdn: mdnVal,
      turn,
      left: Math.min(1, Math.abs(this.driveL)),
      right: Math.min(1, Math.abs(this.driveR)),
      contact: values.contact,
    };
    for (const [name, value] of Object.entries(neurons)) {
      const item = this.dom.neurons[name];
      if (!item) continue;
      if (item.bar) item.bar.style.width = (value * 100).toFixed(0) + '%';
      if (item.output) item.output.textContent = value.toFixed(2);
      item.row.classList.toggle('firing', value > 0.62);
    }

    // Actualizar indicador de recompensa
    if (this.dom.reward) {
      this.dom.reward.textContent = (this.reward >= 0 ? '+' : '') + this.reward.toFixed(1);
    }

    // Overlays HUD (estado de tracción, velocímetro, intento)
    if (this.dom.driveBadge) {
      if (this.autoPushing) {
        this.dom.driveBadge.textContent = 'PUSHING';
        this.dom.driveBadge.className = 'hud-drive-badge pushing';
      } else if (this.unstuckState?.active || (this.driveL < 0 && this.driveR < 0)) {
        this.dom.driveBadge.textContent = 'REVERSE';
        this.dom.driveBadge.className = 'hud-drive-badge reverse';
      } else {
        this.dom.driveBadge.textContent = 'FORWARD';
        this.dom.driveBadge.className = 'hud-drive-badge';
      }
    }

    if (this.dom.speedo) {
      const forwardDrive = Math.max(0, (this.driveL + this.driveR) / 2);
      const kmh = forwardDrive * 2.2;
      this.dom.speedo.textContent = `${kmh.toFixed(1)} km/h`;
    }

    if (this.dom.attemptElapsed) {
      this.dom.attemptElapsed.textContent = `Attempt ${this.episode} · ${this._controlTime().toFixed(1)}s elapsed`;
    }

    if (this.dom.gear) {
      const isRev = this.unstuckState?.active || (this.driveL < 0 && this.driveR < 0);
      const isStopped = Math.abs(this.driveL) < 0.05 && Math.abs(this.driveR) < 0.05;
      this.dom.gear.textContent = isRev ? 'R' : isStopped ? 'N' : 'D';
    }

    // Telemetría inferior
    const forwardDrive = Math.max(0, (this.driveL + this.driveR) / 2);
    const gasPct = Math.round(forwardDrive * 100);
    const isBraking = Boolean(this.unstuckState?.active || (this.driveL < 0 && this.driveR < 0));
    const brakePct = isBraking ? 100 : gasPct === 0 ? 25 : 0;

    if (this.dom.gas) this.dom.gas.textContent = `${gasPct}%`;
    if (this.dom.brake) this.dom.brake.textContent = `${brakePct}%`;

    const steerDeg = (-(this.driveR - this.driveL) * 16.5).toFixed(1);
    if (this.dom.wheel) this.dom.wheel.textContent = `${steerDeg >= 0 ? '+' : ''}${steerDeg}°`;

    const goal = this._currentGoal();
    const carX = this.cargo ? this.cargo.position.x : 0;
    const carY = this.cargo ? this.cargo.position.y : 0;
    const carYaw = this.cargo ? this.cargo.rotation.z : this._yaw;
    const desiredAngle = Math.atan2(goal[1] - carY, goal[0] - carX);
    let angleErr = desiredAngle - carYaw;
    while (angleErr < -Math.PI) angleErr += Math.PI * 2;
    while (angleErr > Math.PI) angleErr -= Math.PI * 2;
    const targetDeg = (((angleErr * 180) / Math.PI) * 0.35).toFixed(1);
    if (this.dom.target) this.dom.target.textContent = `${targetDeg >= 0 ? '+' : ''}${targetDeg}°`;

    const steerVal = (-(this.driveR - this.driveL) * 0.42).toFixed(3);
    if (this.dom.steer) this.dom.steer.textContent = `${steerVal >= 0 ? '+' : ''}${steerVal}`;

    // Actualizar sensores de visión 3D por raycasting y calcular proximidades ópticas
    const rays = this.latestVisionRays || this._updateVisionSensors();
    const visLeft = rays.length ? Math.max(rays[0].proximity, rays[1].proximity) : 0;
    const visRight = rays.length ? Math.max(rays[3].proximity, rays[4].proximity) : 0;

    // Update 3D Brain Viewer on the right
    this.brainViewer?.update(
      {
        forward,
        turn: (this.driveR - this.driveL) / 2,
        mdn: mdnVal,
        contact: values.contact,
        cpg,
        driveL: this.driveL,
        driveR: this.driveR,
        visLeft,
        visRight,
      },
      wallDt,
    );
  }

  _autoDrive(dtOverride = null) {
    const wallDt = this._lastWallDt || 0.016;
    const dt = dtOverride !== null ? dtOverride : wallDt * BASE_PLAYBACK_SPEED * this.speedMultiplier;
    const b = this.bodyId;
    const goal = this._currentGoal();
    const puzzle = this.puzzles[this.puzzleIndex];

    const curOffset = (this.currentPolicy?.offsets && this.currentPolicy.offsets[this.routeIndex]) || [0, 0];
    const steerGain = this.currentPolicy?.steerGain || 1.0;
    const visionRays = this._updateVisionSensors();

    const plan = planAutopilot({
      fly: [this.data.xpos[3 * b], this.data.xpos[3 * b + 1]],
      cargo: [this.cargo.position.x, this.cargo.position.y],
      target: goal,
      yaw: this._yaw,
      puzzle,
      unstuckState: this.unstuckState,
      learnedOffset: curOffset,
      steerGain,
      visionRays,
      dt,
      speedMultiplier: this.speedMultiplier,
      inCockpit: true,
    });

    if (this._steerRequestTimer > 0) {
      this._steerRequestTimer -= dt;
      const req = this._steerRequest * (this._steerRequestTimer / 0.85);
      plan.left = clamp(plan.left - req * 0.45, -0.55, 1.2);
      plan.right = clamp(plan.right + req * 0.45, -0.55, 1.2);
    }

    this.driveL = plan.left;
    this.driveR = plan.right;
    this.autoPushing = plan.pushing;

    const segment = Math.min(this.routeIndex + 1, puzzle.route.length + 1);
    const strategy = this.dom?.strategy || document.getElementById('strategy');
    if (strategy) {
      strategy.textContent = `Step ${segment}/${puzzle.route.length + 1}: ${plan.state}`;
    }
  }

  /**
   * Ejecuta un paso de integración física en el motor MuJoCo.
   *
   * Aspectos clave de la simulación:
   * 1. Acoplamiento neuromuscular: Ejecuta Controller.stepCPG modulando actuadores según driveL/driveR.
   * 2. Propulsión escalada: Calcula velocidades generalizadas (qvel) escaladas con stepScale
   *    para soportar aceleración temporal sin desestabilizar la masa corporal de Carla.
   * 3. Estabilización de postura erguida: Modifica el cuaternión en qpos asegurando pitch=0 y roll=0
   *    para mantener a Carla perfectamente sentada al volante sin rotaciones parásitas.
   * 4. Resolución de colisiones sólidas AABB: Previene la penetración física a través de
   *    obstáculos y vehículos estacionados.
   *
   * @param {number} stepScale Factor de escala para simulación adaptativa
   */
  _physicsStep(stepScale = 1.0) {
    this.controller.stepCPG(this.data.ctrl, this.driveL, this.driveR, stepScale);

    // Apply forward and rotational propulsion scaled with stepScale
    let forwardDrive = (this.driveL + this.driveR) / 2;
    if (this.autopilot && !this.unstuckState?.active) {
      forwardDrive = Math.max(0, forwardDrive);
    }
    const pace = forwardDrive * 5.5;
    this.data.qvel[0] = Math.cos(this._yaw) * pace;
    this.data.qvel[1] = Math.sin(this._yaw) * pace;
    this.data.qvel[5] = (this.driveR - this.driveL) * 1.6;

    // Estabilización de postura erguida (anti-vuelco y estabilidad total en la cabina)
    if (this.data.qpos && this.data.qpos.length >= 7) {
      this.data.qpos[0] += this.data.qvel[0] * this.dt * stepScale;
      this.data.qpos[1] += this.data.qvel[1] * this.dt * stepScale;
      this.data.qpos[2] = Math.max(0.12, this.data.qpos[2]);
      const currentYaw = this._yaw || 0;
      const halfYaw = currentYaw * 0.5;
      this.data.qpos[3] = Math.cos(halfYaw);
      this.data.qpos[4] = 0; // pitch nulo: perfectamente horizontal
      this.data.qpos[5] = 0; // roll nulo: perfectamente horizontal
      this.data.qpos[6] = Math.sin(halfYaw);
      this.data.qvel[2] = 0;
      this.data.qvel[3] = 0;
      this.data.qvel[4] = 0;
    }

    this.mj.mj_step(this.model, this.data);
    this.simTime += this.dt * stepScale;

    // Solid physical collision resolution for Carla against obstacles, curbs, and boundaries
    const activePuzzle = this.puzzles[this.puzzleIndex];
    if (activePuzzle && this.data.qpos && this.data.qpos.length >= 7) {
      let carlaMoved = false;
      let fx = this.data.qpos[0],
        fy = this.data.qpos[1];

      // When driving inside the vehicle cockpit, Carla's body is protected by the car chassis,
      // and the car resolver (_resolveCargoCollisions) already handles all obstacle physics.
      const isDriving =
        this.inCockpit || (this.cargo && Math.hypot(fx - this.cargo.position.x, fy - this.cargo.position.y) < 1.45);

      if (!isDriving && activePuzzle.obstacles) {
        for (const obs of activePuzzle.obstacles) {
          const ox = obs.position[0],
            oy = obs.position[1];

          if (obs.type === 'roundabout_island') {
            const rMin = obs.size[0] / 2 + 0.32;
            const dx = fx - ox,
              dy = fy - oy;
            const dist = Math.hypot(dx, dy);
            if (dist < rMin) {
              const nx = dist > 0.001 ? dx / dist : 1;
              const ny = dist > 0.001 ? dy / dist : 0;
              fx = ox + nx * rMin;
              fy = oy + ny * rMin;
              carlaMoved = true;
            }
          } else if (obs.type === 'cone') {
            const rMin = 0.35;
            const dx = fx - ox,
              dy = fy - oy;
            const dist = Math.hypot(dx, dy);
            if (dist < rMin) {
              const nx = dist > 0.001 ? dx / dist : 1;
              const ny = dist > 0.001 ? dy / dist : 0;
              fx = ox + nx * rMin;
              fy = oy + ny * rMin;
              carlaMoved = true;
            }
          } else {
            const halfW = obs.size[0] / 2 + 0.32;
            const halfH = obs.size[1] / 2 + 0.32;
            if (Math.abs(fx - ox) < halfW && Math.abs(fy - oy) < halfH) {
              const penX = halfW - Math.abs(fx - ox);
              const penY = halfH - Math.abs(fy - oy);
              if (penX < penY) {
                fx = fx > ox ? ox + halfW : ox - halfW;
              } else {
                fy = fy > oy ? oy + halfH : oy - halfH;
              }
              carlaMoved = true;
            }
          }
        }
      }

      // Keep Carla within playable street limits (matching road bounds: -3.5 to 22.0, -5.2 to 5.2)
      const boundedX = clamp(fx, -3.5, 22.0);
      const boundedY = clamp(fy, -5.2, 5.2);
      if (boundedX !== fx || boundedY !== fy) {
        fx = boundedX;
        fy = boundedY;
        carlaMoved = true;
      }

      if (carlaMoved) {
        this.data.qpos[0] = fx;
        this.data.qpos[1] = fy;
        if (this.data.qvel) {
          this.data.qvel[0] *= 0.2;
          this.data.qvel[1] *= 0.2;
        }
        this.mj.mj_forward(this.model, this.data);
      }
    }
  }

  /**
   * Bucle principal de animación y simulación a 60 FPS (requestAnimationFrame).
   *
   * Arquitectura y Optimizaciones:
   * 1. Substepping adaptativo: Acumula el delta temporal simulado en _simAcc y ejecuta
   *    pasos fijos de dt=0.002s, con un límite seguro de MAX_STEPS=120 para no bloquear el hilo UI.
   * 2. Desacoplamiento de autonomía: La planificación _autoDrive() se calcula a tasa de cuadro
   *    mientras que la física interna de MuJoCo corre a alta frecuencia.
   * 3. Watchdogs de seguridad:
   *    - Tiempo máximo (45s) por intento.
   *    - Detección de estancamiento cinemático (elapsedSim > 1.2) con activación refleja MDN.
   * 4. Sincronización Three.js: Actualiza transformaciones visuales, cámaras, sensores y telemetría.
   *
   * @param {number} nowMs Timestamp de requestAnimationFrame en milisegundos
   */
  _frame(nowMs) {
    requestAnimationFrame((t) => this._frame(t));
    if (this.isBurstTraining) return;
    const now = nowMs / 1000;
    const wallDt = this._lastWall === undefined ? 0 : Math.min(now - this._lastWall, 0.1);
    this._lastWall = now;
    this._padState = this.pad.sample();
    if (this.phase === 'ready' && this._padState && this._padState.active) this._startCountdown();

    let effectiveSteps = 0,
      touching = this.wasTouching;
    if (this.phase === 'running') {
      this._lastWallDt = wallDt;
      if (this.autopilot) {
        this._autoDrive();
      } else {
        this.driveL = this.input.gainL;
        this.driveR = this.input.gainR;
        if (this._padState && this._padState.active) {
          this.driveL = this._padState.gainL;
          this.driveR = this._padState.gainR;
        }
      }

      // 2. Avance de física adaptativo y proporcional según multiplicador (1x, 2x, 4x, 8x, 16x Turbo)
      const targetSimDt = wallDt * BASE_PLAYBACK_SPEED * this.speedMultiplier;
      this._simAcc = (this._simAcc || 0) + targetSimDt;

      const wantSteps = Math.floor(this._simAcc / this.dt);
      if (wantSteps > 0) {
        this._simAcc -= wantSteps * this.dt;
        const MAX_STEPS = 120;
        const nSteps = Math.min(wantSteps, MAX_STEPS);
        const stepScale = wantSteps / nSteps;
        effectiveSteps = wantSteps;

        for (let i = 0; i < nSteps; i++) {
          if (this.autopilot && i > 0 && (i % 10 === 0 || this._routeChanged)) {
            this._autoDrive(this.dt * 10 * stepScale);
            this._routeChanged = false;
          }
          this._physicsStep(stepScale);
          touching = this._updateCargo(this.dt * stepScale);
          if (this.phase !== 'running') break;
        }
      } else {
        touching = this.wasTouching;
      }
      const elapsedSim = this._controlTime();
      if (this.dom?.timer) this.dom.timer.textContent = elapsedSim.toFixed(2);
      else {
        const timerEl = document.getElementById('timer');
        if (timerEl) timerEl.textContent = elapsedSim.toFixed(2);
      }
      if (this.dom?.attemptElapsed) {
        this.dom.attemptElapsed.textContent = `Attempt ${this.episode} · ${elapsedSim.toFixed(1)}s elapsed`;
      } else {
        const attemptElapsedEl = document.getElementById('hud-attempt-elapsed');
        if (attemptElapsedEl)
          attemptElapsedEl.textContent = `Attempt ${this.episode} · ${elapsedSim.toFixed(1)}s elapsed`;
      }

      // 1. Watchdog de tiempo máximo: previene que una iteración corra indefinidamente
      if (elapsedSim > this.maxEpisodeTime) {
        this._onWatchdogTimeout('timeout');
        return;
      }

      // 2. Watchdog de estancamiento (cero progreso): previene quedarse trabado para siempre
      if (elapsedSim > 1.2) {
        this._stagnantCounter = (this._stagnantCounter || 0) + 1;
        if (this._stagnantCounter >= 16) {
          this._stagnantCounter = 0;
          const puzzle = this.puzzles[this.puzzleIndex];
          const carPos = [this.cargo.position.x, this.cargo.position.y];
          const carYaw = this.cargo.rotation.z;
          const goalDist = Math.hypot(carPos[0] - this.target.x, carPos[1] - this.target.y);
          const isParking = this.routeIndex >= puzzle.route.length && goalDist < 1.2;

          if (isParking) {
            this.stagnantTime = 0;
          } else if (this._lastWatchdogCarPos) {
            const moved = Math.hypot(carPos[0] - this._lastWatchdogCarPos[0], carPos[1] - this._lastWatchdogCarPos[1]);
            const turned = Math.abs(carYaw - (this._lastWatchdogCarYaw ?? carYaw));
            const isDriving = Math.abs(this.driveL) + Math.abs(this.driveR) > 0.25;

            // Tiempo de control simulado en este bloque (16 cuadros):
            const dtSimBlock = wallDt * this.speedMultiplier * 16;
            if (isDriving && moved < 0.035 && turned < 0.04) {
              this.stagnantTime = (this.stagnantTime || 0) + dtSimBlock;
            } else if (moved > 0.08 || turned > 0.08) {
              this.stagnantTime = Math.max(0, (this.stagnantTime || 0) - dtSimBlock * 1.5);
            }
          }
          this._lastWatchdogCarPos = carPos;
          this._lastWatchdogCarYaw = carYaw;

          if (this.stagnantTime > 3.0 && !this.unstuckState.active) {
            this.unstuckState.active = true;
            this.unstuckState.phase = 'reverse';
            this.unstuckState.timer = 1.1;
            this.unstuckState.stuckTurnDir = Math.random() > 0.5 ? 1 : -1;
          }
          if (this.stagnantTime > 7.0) {
            // Imposible continuar tras estancamiento prolongado: abortar y reintentar inmediatamente
            this._onWatchdogTimeout('stagnant');
            return;
          }
        }
      }

      // 3. Detector de atasco a nivel de cuadros (60 FPS)
      this._stuckCheckCounter = (this._stuckCheckCounter || 0) + 1;
      if (this._stuckCheckCounter >= 18) {
        this._stuckCheckCounter = 0;
        const b = this.bodyId;
        const curFly = [this.data.xpos[3 * b], this.data.xpos[3 * b + 1]];
        if (this._lastStuckFlyPos) {
          const dist = Math.hypot(curFly[0] - this._lastStuckFlyPos[0], curFly[1] - this._lastStuckFlyPos[1]);
          const puzzle = this.puzzles[this.puzzleIndex];
          const carPos = [this.cargo.position.x, this.cargo.position.y];
          const goalDist = Math.hypot(carPos[0] - this.target.x, carPos[1] - this.target.y);
          const isParking = this.routeIndex >= puzzle.route.length && goalDist < 1.2;

          const nearObs = this.inCockpit
            ? cargoHitsObstacle(puzzle, carPos[0], carPos[1], 0.32)
            : cargoHitsObstacle(puzzle, carPos[0], carPos[1], 0.32) ||
              flyHitsObstacle(puzzle, curFly[0], curFly[1], 0.4);
          const nearWall = this.inCockpit
            ? isNearBorder(carPos[0], carPos[1], 0.4)
            : isNearBorder(carPos[0], carPos[1], 0.4) || isNearBorder(curFly[0], curFly[1], 0.4);
          if (
            this.autopilot &&
            !isParking &&
            this.routeIndex < puzzle.route.length &&
            (nearObs || nearWall) &&
            dist < 0.045 &&
            this.driveL + this.driveR > 0.25
          ) {
            this.unstuckState.stuckAttempts = (this.unstuckState.stuckAttempts || 0) + 1;
            if (!this.unstuckState.active) {
              this.unstuckState.active = true;
              this.unstuckState.phase = 'reverse';
              this.unstuckState.timer = 1.05;
              this.unstuckState.stuckTurnDir = Math.random() > 0.5 ? 1 : -1;
            }
            // Si tras 2 intentos consecutivos de maniobra sigue bloqueado, reiniciar intento con adaptación de ruta
            if (this.unstuckState.stuckAttempts >= 2) {
              this.unstuckState.stuckAttempts = 0;
              this._onWatchdogTimeout('stagnant');
              return;
            }
          } else if (dist > 0.08 || isParking) {
            this.unstuckState.stuckAttempts = 0;
          }
        }
        this._lastStuckFlyPos = curFly;
      }
    }

    syncMeshes(this.meshGroup, this.data);
    this._updateCamera(false);
    this._updateSignals(touching, wallDt);
    this.renderer.render(this.scene, this.camera);
    this.bodyRenderer.render(this.scene, this.bodyCamera);
    this._statsMeter(now, effectiveSteps);
  }
}
