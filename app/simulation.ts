export type NeuronId =
  | 'visual_left'
  | 'visual_right'
  | 'odor'
  | 'touch'
  | 'steer_left'
  | 'steer_right'
  | 'forward_drive'
  | 'mdn'
  | 'lbl40'
  | 'in07b010'
  | 'in12b003';

export type NmfAction = 'stop' | 'forward' | 'left' | 'right' | 'reverse' | 'stimulate';

export function nmfKeyForAction(action: NmfAction) {
  const keys: Record<NmfAction, string> = {
    stop: 'q',
    forward: 'w',
    left: 'a',
    right: 'd',
    reverse: 's',
    stimulate: 's',
  };
  return keys[action];
}

export type NeuronState = {
  voltage: number;
  activity: number;
  spiked: boolean;
  silenced: boolean;
};

export type Edge = {
  source: NeuronId;
  target: NeuronId;
  weight: number;
  originalWeight: number;
  provenance: 'connectome' | 'model';
  conns: number | null;
};

export const NODE_LABELS: Record<NeuronId, string> = {
  visual_left: 'Visión izquierda',
  visual_right: 'Visión derecha',
  odor: 'Olor',
  touch: 'Contacto',
  steer_left: 'Giro izquierdo',
  steer_right: 'Giro derecho',
  forward_drive: 'Avance',
  mdn: 'MDN',
  lbl40: 'LBL40',
  in07b010: 'IN07B010',
  in12b003: 'IN12B003',
};

const NODE_IDS = Object.keys(NODE_LABELS) as NeuronId[];

const EDGE_DATA: Omit<Edge, 'originalWeight'>[] = [
  { source: 'visual_left', target: 'steer_left', weight: 1.4, provenance: 'model', conns: null },
  { source: 'visual_right', target: 'steer_right', weight: 1.4, provenance: 'model', conns: null },
  { source: 'odor', target: 'forward_drive', weight: 1.5, provenance: 'model', conns: null },
  { source: 'touch', target: 'mdn', weight: 2.2, provenance: 'model', conns: null },
  { source: 'mdn', target: 'lbl40', weight: 1.55, provenance: 'connectome', conns: 115.8 },
  { source: 'mdn', target: 'in07b010', weight: 1.57, provenance: 'connectome', conns: 119 },
  { source: 'mdn', target: 'in12b003', weight: 1.55, provenance: 'connectome', conns: 116.5 },
];

export class BrainSimulation {
  states: Record<NeuronId, NeuronState>;
  edges: Edge[];
  private tau = 0.32;
  private threshold = 1;

  constructor() {
    this.states = Object.fromEntries(
      NODE_IDS.map((id) => [id, { voltage: 0, activity: 0, spiked: false, silenced: false }]),
    ) as Record<NeuronId, NeuronState>;
    this.edges = EDGE_DATA.map((edge) => ({ ...edge, originalWeight: edge.weight }));
  }

  reset() {
    for (const state of Object.values(this.states)) {
      state.voltage = 0;
      state.activity = 0;
      state.spiked = false;
      state.silenced = false;
    }
    for (const edge of this.edges) edge.weight = edge.originalWeight;
  }

  step(dt: number, external: Partial<Record<NeuronId, number>>) {
    const prior = Object.fromEntries(NODE_IDS.map((id) => [id, this.states[id].spiked])) as Record<NeuronId, boolean>;
    const currents = Object.fromEntries(NODE_IDS.map((id) => [id, external[id] ?? 0])) as Record<NeuronId, number>;
    for (const edge of this.edges) {
      if (prior[edge.source]) currents[edge.target] += edge.weight * 3.2;
    }
    for (const id of NODE_IDS) {
      const state = this.states[id];
      if (state.silenced) {
        state.voltage = 0;
        state.spiked = false;
        state.activity += (0 - state.activity) * Math.min(1, dt * 8);
        continue;
      }
      state.voltage += dt * (-state.voltage / this.tau + currents[id]);
      state.spiked = state.voltage >= this.threshold;
      if (state.spiked) state.voltage = 0;
      const target = state.spiked ? 1 : Math.min(0.95, state.voltage / this.threshold);
      state.activity += (target - state.activity) * Math.min(1, dt * 9);
    }
  }
}

export type Vec2 = { x: number; z: number };
export type Obstacle = Vec2 & { width: number; depth: number };

export type WorldState = {
  fly: Vec2 & { heading: number };
  food: Vec2;
  light: Vec2;
  spider: Vec2;
  obstacles: Obstacle[];
  foodFound: number;
  caught: number;
  elapsed: number;
};

export function createWorld(): WorldState {
  return {
    fly: { x: -5.2, z: 0.6, heading: 0 },
    food: { x: 5.5, z: 3.8 },
    light: { x: 5.5, z: -4.2 },
    spider: { x: 6.6, z: 0.2 },
    obstacles: [
      { x: -1.4, z: -2.6, width: 0.8, depth: 4 },
      { x: 2.2, z: 2.3, width: 0.9, depth: 3.2 },
      { x: -2.2, z: 4.2, width: 3.3, depth: 0.65 },
    ],
    foodFound: 0,
    caught: 0,
    elapsed: 0,
  };
}

function wrapAngle(angle: number) {
  return ((angle + Math.PI) % (Math.PI * 2)) - Math.PI;
}

function bearing(source: Vec2 & { heading: number }, target: Vec2, reach: number) {
  const dx = target.x - source.x;
  const dz = target.z - source.z;
  const distance = Math.max(0.01, Math.hypot(dx, dz));
  const relative = wrapAngle(Math.atan2(dz, dx) - source.heading);
  const strength = Math.max(0, 1 - distance / reach);
  return {
    distance,
    strength,
    forward: Math.max(0, Math.cos(relative)),
    left: Math.max(0, -Math.sin(relative)),
    right: Math.max(0, Math.sin(relative)),
  };
}

export type SensorValues = {
  lightLeft: number;
  lightRight: number;
  odor: number;
  touch: number;
  threat: number;
};

export function senseWorld(world: WorldState): { sensors: SensorValues; currents: Partial<Record<NeuronId, number>> } {
  const light = bearing(world.fly, world.light, 13);
  const food = bearing(world.fly, world.food, 8);
  const predator = bearing(world.fly, world.spider, 5.2);
  const threat = predator.strength * (0.35 + predator.forward);
  const touch = world.obstacles.some(
    (item) =>
      Math.abs(world.fly.x - item.x) < item.width / 2 + 0.35 && Math.abs(world.fly.z - item.z) < item.depth / 2 + 0.35,
  );
  const lightLeft = 1.1 + 5 * light.strength * (0.25 + light.forward + light.left);
  const lightRight = 1.1 + 5 * light.strength * (0.25 + light.forward + light.right);
  const odor = 0.7 + 6 * food.strength;
  return {
    sensors: { lightLeft, lightRight, odor, touch: touch ? 8 : 0, threat: Math.min(1, threat) },
    currents: {
      visual_left: lightLeft,
      visual_right: lightRight,
      odor,
      touch: touch ? 8 : 0,
      mdn: 7.5 * Math.min(1, threat),
      steer_left: 3.8 * (light.left + 0.65 * food.left) + 9 * predator.right,
      steer_right: 3.8 * (light.right + 0.65 * food.right) + 9 * predator.left,
      forward_drive: 2.2 + 4.5 * food.strength * (0.25 + food.forward) + 5 * predator.strength * (1 - predator.forward),
    },
  };
}

export type MotorCommand = { speed: number; turn: number };

export function decodeMotor(brain: BrainSimulation, world: WorldState, threat: number): MotorCommand {
  const activity = (id: NeuronId) => brain.states[id].activity;
  const reverse = Math.max(activity('mdn'), activity('lbl40'));
  let speed = 1.8 * activity('forward_drive') - 2.35 * reverse;
  let turn = 2.7 * (activity('steer_right') - activity('steer_left'));
  if (threat > 0.05) {
    const away = Math.atan2(world.fly.z - world.spider.z, world.fly.x - world.spider.x);
    turn = Math.max(-4.2, Math.min(4.2, wrapAngle(away - world.fly.heading) * 4));
    speed = Math.max(speed, 1.7 + 1.2 * threat);
  }
  return { speed, turn };
}

export function stepWorld(world: WorldState, command: MotorCommand, dt: number) {
  world.elapsed += dt;
  world.fly.heading = wrapAngle(world.fly.heading + command.turn * dt);
  const prior = { x: world.fly.x, z: world.fly.z };
  world.fly.x += Math.cos(world.fly.heading) * command.speed * dt;
  world.fly.z += Math.sin(world.fly.heading) * command.speed * dt;
  const blocked =
    Math.abs(world.fly.x) > 8.2 ||
    Math.abs(world.fly.z) > 6.2 ||
    world.obstacles.some(
      (item) =>
        Math.abs(world.fly.x - item.x) < item.width / 2 + 0.35 &&
        Math.abs(world.fly.z - item.z) < item.depth / 2 + 0.35,
    );
  if (blocked) {
    world.fly.x = prior.x;
    world.fly.z = prior.z;
    world.fly.heading = wrapAngle(world.fly.heading + 1.1);
  }

  const spiderDistance = Math.hypot(world.fly.x - world.spider.x, world.fly.z - world.spider.z);
  if (spiderDistance > 0.01) {
    world.spider.x += ((world.fly.x - world.spider.x) / spiderDistance) * 0.62 * dt;
    world.spider.z += ((world.fly.z - world.spider.z) / spiderDistance) * 0.62 * dt;
  }
  if (spiderDistance < 0.55) {
    world.caught += 1;
    world.spider.x = 6.6;
    world.spider.z = 0.2;
  }
  if (Math.hypot(world.fly.x - world.food.x, world.fly.z - world.food.z) < 0.6) {
    world.foodFound += 1;
    const positions = [
      { x: 5.1, z: -3.6 },
      { x: -4.7, z: 4.4 },
      { x: 3.4, z: 4.8 },
    ];
    Object.assign(world.food, positions[world.foodFound % positions.length]);
  }
}

export const FUNCTION_MAP = [
  { fn: 'Luz a la izquierda', neuron: 'Visión izquierda → Giro izquierdo', source: 'Modelo' },
  { fn: 'Luz a la derecha', neuron: 'Visión derecha → Giro derecho', source: 'Modelo' },
  { fn: 'Olor a comida', neuron: 'Olor → Avance', source: 'Modelo' },
  { fn: 'Amenaza frontal', neuron: 'MDN', source: 'Literatura + modelo' },
  { fn: 'Marcha atrás', neuron: 'MDN → LBL40', source: 'Conectoma + literatura' },
  { fn: 'Propagación desde MDN', neuron: 'IN07B010 / IN12B003', source: 'Conectoma' },
] as const;
