import assert from 'node:assert/strict';
import test from 'node:test';
import { BrainSimulation, createWorld, decodeMotor, nmfKeyForAction, senseWorld } from '../app/simulation.ts';

test('las conexiones MaleCNS conservan procedencia y valores', () => {
  const brain = new BrainSimulation();
  const real = brain.edges.filter((edge) => edge.provenance === 'connectome');
  assert.deepEqual(
    real.map((edge) => edge.conns).sort((a, b) => a - b),
    [115.8, 116.5, 119],
  );
});

test('silenciar MDN impide que se active', () => {
  const brain = new BrainSimulation();
  brain.states.mdn.silenced = true;
  for (let step = 0; step < 30; step += 1) brain.step(0.02, { mdn: 10 });
  assert.equal(brain.states.mdn.activity, 0);
  assert.equal(brain.states.mdn.spiked, false);
});

test('la evasión gira en dirección opuesta a la araña', () => {
  const world = createWorld();
  world.fly = { x: 0, z: 0, heading: 0 };
  world.spider = { x: 2, z: 1 };
  const brain = new BrainSimulation();
  const { sensors } = senseWorld(world);
  const command = decodeMotor(brain, world, sensors.threat);
  assert.ok(command.turn < 0);
  assert.ok(command.speed > 0);
});

test('las intenciones neuronales llegan al controlador CPG de NeuroMechFly', () => {
  assert.equal(nmfKeyForAction('forward'), 'w');
  assert.equal(nmfKeyForAction('reverse'), 's');
  assert.equal(nmfKeyForAction('stimulate'), 's');
  assert.equal(nmfKeyForAction('stop'), 'q');
});
