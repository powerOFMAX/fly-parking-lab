const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const PARKING_PUZZLES = Object.freeze([
  {
    name: 'Straight Push',
    difficulty: 'Easy',
    cargo: [3.2, 0],
    target: [6.2, 0],
    route: [],
    obstacles: [],
    desc: 'Straight line with no obstacles to calibrate CPG locomotion and initial contact.',
  },
  {
    name: 'Navigate Around',
    difficulty: 'Medium',
    cargo: [3.0, 1.8],
    target: [8.0, -2.0],
    route: [
      [4.2, 3.5],
      [7.6, 3.5],
      [7.6, 0.4],
    ],
    obstacles: [{ position: [5.4, 0.4], size: [1.7, 3.6] }],
    desc: 'A large obstacle separates vehicle from goal. Navigate around safely without collisions.',
  },
  {
    name: 'S-Maze',
    difficulty: 'Hard',
    cargo: [2.8, -2.5],
    target: [9.2, 2.5],
    route: [
      [3.5, -3.5],
      [6.45, -3.5],
      [6.45, 2.7],
    ],
    obstacles: [
      { position: [4.5, 0.9], size: [1.1, 4.2] },
      { position: [8.4, -0.9], size: [1.1, 4.2] },
    ],
    desc: 'Double curve with wide corridors. Maneuver the vehicle through the S-shaped maze.',
  },
]);

// Official Urban Catalog: 6 complete realistic driving and parking missions
export const ALL_PUZZLES = Object.freeze([
  // 1. Parallel Parking on Street
  {
    name: 'parallel parking',
    displayName: '1. Parallel Parking',
    difficulty: 'Challenge',
    type: 'street_parallel',
    isParallelParking: true,
    cargo: [2.4, 0.8],
    target: [6.0, -1.4],
    route: [
      [4.4, 0.4],
      [5.4, -0.6],
    ],
    obstacles: [
      { position: [1.4, -1.4], size: [2.3, 1.2], type: 'car', model: 'coral_mini' },
      { position: [10.8, -1.4], size: [2.3, 1.2], type: 'car', model: 'grey_sedan' },
    ],
    desc: 'Drive down the avenue and park cleanly in the designated bay between both parked vehicles.',
  },

  // 2. Perpendicular Parking (90°)
  {
    name: 'perpendicular parking',
    displayName: '2. Perpendicular Parking (90°)',
    difficulty: 'Technical',
    type: 'street_perpendicular',
    isParallelParking: false,
    cargo: [2.4, 1.4],
    target: [6.4, -2.0],
    route: [
      [4.8, 1.4],
      [6.4, 0.4],
    ],
    obstacles: [
      { position: [3.4, -2.0], size: [1.8, 2.8], type: 'car', model: 'urban_pickup' },
      { position: [9.4, -2.0], size: [1.8, 2.8], type: 'car', model: 'blue_hatchback' },
    ],
    desc: 'Advance along the parking access road, make a sharp 90-degree turn, and dock between the pickup and hatchback.',
  },

  // 3. Roadworks Slalom
  {
    name: 'roadworks slalom',
    displayName: '3. Roadworks Slalom',
    difficulty: 'Skill',
    type: 'street_slalom',
    isParallelParking: false,
    cargo: [2.0, 0.0],
    target: [16.5, 0.0],
    route: [
      [3.6, -1.8],
      [4.8, -1.8],
      [6.6, 0.0],
      [8.4, 1.8],
      [10.2, 0.0],
      [12.0, -1.8],
      [14.2, 0.0],
    ],
    obstacles: [
      { position: [4.8, 0.0], size: [0.35, 0.35], type: 'cone' },
      { position: [8.4, 0.0], size: [0.35, 0.35], type: 'cone' },
      { position: [12.0, 0.0], size: [0.35, 0.35], type: 'cone' },
    ],
    desc: 'Navigate the zigzag slalom past the reflective roadwork pylons along the wide avenue and brake inside the bay.',
  },

  // 4. Alley Loading Bay
  {
    name: 'alley loading',
    displayName: '4. Alley Loading Bay',
    difficulty: 'Expert',
    type: 'street_alley',
    isParallelParking: false,
    cargo: [2.0, -0.6],
    target: [11.8, 0.0],
    route: [
      [4.5, -0.8],
      [7.0, 0.0],
      [9.2, 0.6],
    ],
    obstacles: [
      { position: [5.2, 2.6], size: [2.5, 1.2], type: 'car', model: 'delivery_van' },
      { position: [8.6, -2.6], size: [1.4, 1.0], type: 'dumpster' },
    ],
    desc: 'Maneuver past the delivery van and industrial dumpster through the alley corridor to dock in the loading zone.',
  },

  // 5. Urban Roundabout
  {
    name: 'urban roundabout',
    displayName: '5. Urban Roundabout',
    difficulty: 'Advanced',
    type: 'street_roundabout',
    isParallelParking: false,
    cargo: [2.0, -2.4],
    target: [3.2, 2.4],
    route: [
      [4.6, -2.4],
      [7.2, -2.8],
      [10.2, -1.0],
      [10.2, 1.0],
      [7.2, 2.8],
      [4.8, 2.4],
    ],
    obstacles: [{ position: [7.2, 0.0], size: [2.2, 2.2], type: 'roundabout_island' }],
    desc: 'Enter the roundabout, follow the continuous curve around the center landscaped island, and exit smoothly.',
  },

  // 6. T-Junction Maneuver
  {
    name: 't-junction maneuver',
    displayName: '6. T-Junction Maneuver',
    difficulty: 'Master',
    type: 'street_tjunction',
    isParallelParking: false,
    cargo: [2.0, -1.2],
    target: [2.4, 1.4],
    route: [
      [5.5, -1.4],
      [7.8, -1.0],
      [9.0, 0.8],
      [7.6, 2.4],
      [5.0, 1.6],
    ],
    obstacles: [{ position: [10.8, 0.0], size: [2.2, 1.4], type: 'car', model: 'urban_pickup' }],
    desc: 'Drive towards the T-junction, execute a 3-point technical turn without hitting the parked pickup, and park in the return bay.',
  },
]);

export function cargoHitsObstacle(puzzle, x, y, margin = 0.4) {
  if (!puzzle || !puzzle.obstacles) return false;
  return puzzle.obstacles.some(
    (obstacle) =>
      Math.abs(x - obstacle.position[0]) < obstacle.size[0] / 2 + margin &&
      Math.abs(y - obstacle.position[1]) < obstacle.size[1] / 2 + margin,
  );
}

export function flyHitsObstacle(puzzle, x, y, margin = 0.52) {
  if (!puzzle || !puzzle.obstacles) return false;
  return puzzle.obstacles.some(
    (obstacle) =>
      Math.abs(x - obstacle.position[0]) < obstacle.size[0] / 2 + margin &&
      Math.abs(y - obstacle.position[1]) < obstacle.size[1] / 2 + margin,
  );
}

export function isNearBorder(x, y, margin = 0.55) {
  const minX = -3.5 + margin,
    maxX = 22.0 - margin;
  const minY = -5.2 + margin,
    maxY = 5.2 - margin;
  return x < minX || x > maxX || y < minY || y > maxY;
}

/**
 * Planificador de navegación reactivo y autónomo para Carla y el vehículo.
 *
 * Principios y Algoritmos:
 * 1. Maniobra refleja MDN (Moonwalker Descending Neuron):
 *    Al activarse el estado de desatasco, ejecuta una secuencia de 2 fases:
 *    - Reversa (MDN=1.0) con retroceso rectilíneo para despejar obstáculos frontales.
 *    - Giro angular de escape con dirección alternada (stuckTurnDir) para desenganchar las ruedas.
 * 2. Acotamiento estricto de aprendizaje:
 *    Los desvíos aprendidos (learnedOffset) están restringidos a [-1.5m, +1.5m]
 *    para evitar que la política diverja fuera de los límites de la calzada.
 * 3. Campos Potenciales Repulsivos Artificiales (APF):
 *    Para cada obstáculo a distancia d < r0, genera una fuerza repulsiva:
 *    F_rep = 1.35 * (1/d - 1/r0) en dirección opuesta (dx/d, dy/d).
 * 4. Lidar Óptico 3D de 5 Rayos:
 *    Proyecta fuerzas evasivas proporcionales a la proximidad (1 - dist / maxRange)
 *    de rayos infrarrojos/visuales en abanico frontal (-60°, -30°, 0°, +30°, +60°).
 * 5. Control cinemático diferencial (Carla al volante / empujando):
 *    Evalúa la proyección longitudinal y error lateral respecto al vector objetivo para
 *    conducir en modo acoplado o reubicar a Carla detrás del vehículo.
 *
 * @param {Object} options Configuración del estado actual de navegación
 * @returns {Object} Comandos de tracción diferencial {left, right}, estado y waypoints
 */
export function planAutopilot({
  fly,
  cargo,
  target,
  yaw,
  puzzle,
  unstuckState,
  learnedOffset = [0, 0],
  steerGain = 1.0,
  visionRays = null,
  dt = 0.02,
  _speedMultiplier = 1.0,
  inCockpit = false,
}) {
  // Manejo de maniobra de desatasco (solo si fue activada intencionalmente a nivel de cuadro)
  if (unstuckState && unstuckState.active) {
    unstuckState.timer -= dt;
    if (unstuckState.phase === 'reverse') {
      if (unstuckState.timer <= 0) {
        unstuckState.phase = 'turn';
        unstuckState.timer = 0.35;
      }
      return {
        left: -0.75,
        right: -0.75,
        state: 'MDN reverse reflex (anti-stuck)',
        waypoint: [fly[0], fly[1]],
        pushing: false,
        mdn: 1.0,
        unstuck: true,
      };
    } else if (unstuckState.phase === 'turn') {
      if (unstuckState.timer <= 0) {
        unstuckState.active = false;
        unstuckState.phase = 'none';
      }
      const dir = unstuckState.stuckTurnDir || 1;
      return {
        left: dir > 0 ? -0.8 : 0.8,
        right: dir > 0 ? 0.8 : -0.8,
        state: 'Reorienting escape angle',
        waypoint: [fly[0], fly[1]],
        pushing: false,
        mdn: 0.25,
        unstuck: true,
      };
    }
  }

  // Desplazamiento aprendido del waypoint (acotado dentro de márgenes de seguridad ±1.5m)
  const safeOffsetX = clamp(learnedOffset[0] || 0, -1.5, 1.5);
  const safeOffsetY = clamp(learnedOffset[1] || 0, -1.5, 1.5);
  const effTargetX = target[0] + safeOffsetX;
  const effTargetY = target[1] + safeOffsetY;

  // Campo de potencial repulsivo ante obstáculos (solo si hay obstáculos definidos)
  let repX = 0,
    repY = 0;
  if (puzzle && puzzle.obstacles && puzzle.obstacles.length > 0) {
    for (const obs of puzzle.obstacles) {
      const ox = obs.position[0],
        oy = obs.position[1];
      const dx = cargo[0] - ox,
        dy = cargo[1] - oy;
      const d = Math.hypot(dx, dy);
      const r0 = Math.max(obs.size[0], obs.size[1]) * 0.7 + 1.25;
      if (d < r0 && d > 0.05) {
        const force = 1.35 * (1.0 / d - 1.0 / r0);
        repX += (dx / d) * force;
        repY += (dy / d) * force;
      }
    }
  }

  // Integración sensorial de rayos de visión (Ojos de la mosca / Lidar 3D reactivo)
  if (Array.isArray(visionRays) && visionRays.length > 0) {
    for (const ray of visionRays) {
      const dist = typeof ray.distance === 'number' ? ray.distance : ray.dist;
      const angle = typeof ray.angleOffset === 'number' ? ray.angleOffset : ray.angle || 0;
      if (typeof dist === 'number' && dist < ray.maxRange) {
        const prox = Math.max(0, 1.0 - dist / ray.maxRange);
        const rayWorldAngle = yaw + angle;
        repX += -Math.cos(rayWorldAngle) * prox * 1.25;
        repY += -Math.sin(rayWorldAngle) * prox * 1.25;
      }
    }
  }

  const goalX = effTargetX - cargo[0] + repX * 0.75;
  const goalY = effTargetY - cargo[1] + repY * 0.75;

  // Conducción vehicular en cabina (orientación y guiñada directa del automóvil)
  if (inCockpit) {
    const desired = Math.atan2(goalY, goalX);
    const error = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
    const turn = clamp(error * 1.4 * steerGain, -0.85, 0.85);
    let base = Math.abs(error) > 1.25 ? 0.35 : 1.15;

    // Desaceleración suave y centrado al aproximarse a la bahía de estacionamiento
    const distToTarget = Math.hypot(target[0] - cargo[0], target[1] - cargo[1]);
    const isTargetBay = puzzle && target[0] === puzzle.target[0] && target[1] === puzzle.target[1];
    const isDocking = isTargetBay && distToTarget < 2.0;
    if (isDocking) {
      if (distToTarget < 0.65) {
        base = 0.45;
      } else {
        base = Math.max(0.55, distToTarget * 0.6);
      }
    }

    return {
      left: clamp(base - turn, -0.55, 1.2),
      right: clamp(base + turn, -0.55, 1.2),
      state: 'pushing towards target',
      waypoint: [cargo[0] + Math.cos(desired) * 1.0, cargo[1] + Math.sin(desired) * 1.0],
      pushing: true,
      mdn: isDocking && distToTarget < 0.55 ? 0.4 : 0.15,
      unstuck: false,
    };
  }

  // Planificación base (100% compatible con el modelo y los tests unitarios)
  const length = Math.hypot(goalX, goalY) || 1;
  const direction = [goalX / length, goalY / length];
  const behind = [cargo[0] - direction[0] * 1.55, cargo[1] - direction[1] * 1.55];
  const flyFromCargo = [fly[0] - cargo[0], fly[1] - cargo[1]];
  const projection = flyFromCargo[0] * direction[0] + flyFromCargo[1] * direction[1];
  const lateralError = Math.abs(flyFromCargo[0] * direction[1] - flyFromCargo[1] * direction[0]);
  const pushing = projection < -0.28 && projection > -2.35 && lateralError < 0.95;
  const waypoint = pushing ? [cargo[0] + direction[0] * 0.7, cargo[1] + direction[1] * 0.7] : behind;

  const desired = Math.atan2(waypoint[1] - fly[1], waypoint[0] - fly[0]);
  const error = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
  const base = Math.abs(error) > 1.15 ? 0.1 : 1.12;
  const turn = clamp(error * 0.9 * steerGain, -0.85, 0.85);

  return {
    left: clamp(base - turn, -0.55, 1.2),
    right: clamp(base + turn, -0.55, 1.2),
    state: pushing ? 'pushing towards target' : 'seeking push point',
    waypoint,
    pushing,
    mdn: pushing ? 0.15 : 0.05,
    unstuck: false,
  };
}
