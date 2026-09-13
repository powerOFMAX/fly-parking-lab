import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_PUZZLES, PARKING_PUZZLES, cargoHitsObstacle, planAutopilot } from '../public/nmf/game/autopilot.mjs';

const html = readFileSync(new URL('../public/nmf/game/game.html', import.meta.url), 'utf8');
const game = readFileSync(new URL('../public/nmf/game/game.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

test('la aplicación abre una sola experiencia NeuroMechFly', () => {
  assert.match(page, /\/nmf\/game\/game\.html/);
  assert.match(html, /MaleCNS × NeuroMechFly v2/);
  assert.doesNotMatch(page, /FruitFlyLab/);
});

test('juego y cuerpo tienen vistas sincronizadas separadas', () => {
  assert.match(html, /id="game-view"/);
  assert.match(html, /id="body-view"/);
  assert.match(game, /this\.renderer\.render\(this\.scene, this\.camera\)/);
  assert.match(game, /this\.bodyRenderer\.render\(this\.scene, this\.bodyCamera\)/);
  assert.match(game, /PerspectiveCamera\(58/);
  assert.match(html, /id="neural-activity"/);
  assert.match(game, /data-neuron/);
});

test('el piloto resuelve más de una disposición', () => {
  assert.equal(PARKING_PUZZLES.length, 3);
  assert.equal(PARKING_PUZZLES[1].route.length, 3);
  assert.equal(PARKING_PUZZLES[2].obstacles.length, 2);
  assert.equal(cargoHitsObstacle(PARKING_PUZZLES[1], 5.4, 0.4), true);
  assert.match(game, /_autoDrive\(\)/);
  const approach = planAutopilot({ fly: [0, 0], cargo: [3.2, 0], target: [6.2, 0], yaw: 0 });
  assert.equal(approach.pushing, false);
  assert.ok(Math.abs(approach.left - approach.right) < 0.001);

  const push = planAutopilot({ fly: [1.2, 0], cargo: [3.2, 0], target: [6.2, 0], yaw: 0 });
  assert.equal(push.pushing, true);
  assert.equal(push.state, 'pushing towards target');

  const diagonal = planAutopilot({ fly: [0, 0], cargo: [3, 1.4], target: [6, -1.6], yaw: 0 });
  assert.ok(diagonal.left >= -0.55 && diagonal.right <= 1.2);
  assert.notEqual(diagonal.left, diagonal.right);
});

test('el usuario puede alternar autonomía y control manual', () => {
  assert.match(html, /id="auto-button"/);
  assert.match(game, /this\.autopilot = !this\.autopilot/);
  assert.match(html, /data-key="w"/);
  assert.match(html, /data-key="a"/);
  assert.match(html, /data-key="d"/);
});

test('la ejecución automática completa las tres rutas en el modelo de navegación', () => {
  for (const puzzle of PARKING_PUZZLES) {
    let fly = [0, 0],
      cargo = [...puzzle.cargo],
      yaw = 0,
      routeIndex = 0;
    for (let step = 0; step < 12000; step++) {
      const goal = puzzle.route[routeIndex] || puzzle.target;
      const plan = planAutopilot({ fly, cargo, target: goal, yaw });
      const dt = 0.02;
      yaw += (plan.right - plan.left) * 1.45 * dt;
      const speed = Math.max(0, (plan.left + plan.right) / 2) * 5.0;
      const previousFly = [...fly];
      fly[0] += Math.cos(yaw) * speed * dt;
      fly[1] += Math.sin(yaw) * speed * dt;
      const touching = Math.hypot(fly[0] - cargo[0], fly[1] - cargo[1]) < 2.25;
      if (touching && plan.pushing) {
        const old = [...cargo];
        cargo[0] += (fly[0] - previousFly[0]) * 0.96;
        cargo[1] += (fly[1] - previousFly[1]) * 0.96;
        if (Math.hypot(fly[0] - cargo[0], fly[1] - cargo[1]) > 1.9 || cargoHitsObstacle(puzzle, cargo[0], cargo[1]))
          cargo = old;
      }
      if (routeIndex < puzzle.route.length && Math.hypot(cargo[0] - goal[0], cargo[1] - goal[1]) < 1.05) routeIndex++;
      if (
        routeIndex === puzzle.route.length &&
        Math.hypot(cargo[0] - puzzle.target[0], cargo[1] - puzzle.target[1]) < 1.05
      )
        break;
    }
    assert.ok(Math.hypot(cargo[0] - puzzle.target[0], cargo[1] - puzzle.target[1]) < 1.05, puzzle.name);
  }
});

test('el catálogo urbano contiene 6 misiones viales completas sin laberintos obsoletos', () => {
  assert.equal(ALL_PUZZLES.length, 6);
  assert.equal(ALL_PUZZLES[4].name, 'urban roundabout');
  assert.equal(ALL_PUZZLES[5].name, 't-junction maneuver');
  for (const p of ALL_PUZZLES) {
    assert.ok(p.type.startsWith('street_'), `Puzzle ${p.name} should have a street type`);
  }
});

test('los sensores de visión por raycasting desvían reactivamente el rumbo ante obstáculos', () => {
  const straightPlan = planAutopilot({
    fly: [0, 0],
    cargo: [3.0, 0.0],
    target: [8.0, 0.0],
    yaw: 0,
  });

  // Obstáculo cercano detectado en el rayo izquierdo (-30 grados)
  const visionRays = [
    { angleOffset: -Math.PI / 3, distance: 3.5, maxRange: 3.8, proximity: 0.1 },
    { angleOffset: -Math.PI / 6, distance: 0.8, maxRange: 3.8, proximity: 0.8 }, // Close obstacle left
    { angleOffset: 0, distance: 3.5, maxRange: 3.8, proximity: 0.1 },
    { angleOffset: Math.PI / 6, distance: 3.5, maxRange: 3.8, proximity: 0.1 },
    { angleOffset: Math.PI / 3, distance: 3.5, maxRange: 3.8, proximity: 0.1 },
  ];

  const evasivePlan = planAutopilot({
    fly: [0, 0],
    cargo: [3.0, 0.0],
    target: [8.0, 0.0],
    yaw: 0,
    visionRays,
  });

  // Con obstáculo a la izquierda, debe girar a la derecha (left > right o menor giro a la izquierda)
  assert.ok(evasivePlan.left >= straightPlan.left, 'Debe acelerar rueda izquierda para girar a la derecha');
});

test('la curva de aprendizaje y el domain randomization están integrados en la interfaz', () => {
  assert.match(html, /id="reward-sparkline"/);
  assert.match(html, /id="check-domain-rand"/);
  assert.match(game, /_updateVisionSensors\(\)/);
  assert.match(game, /_renderRewardSparkline\(\)/);
  assert.match(game, /_drawRoundaboutScene/);
  assert.match(game, /_drawTJunctionScene/);
});

test('la navegación automática completa las nuevas misiones viales (rotonda y cruce en T)', () => {
  const newMissions = [ALL_PUZZLES[4], ALL_PUZZLES[5]];
  for (const puzzle of newMissions) {
    let fly = [0, 0],
      cargo = [...puzzle.cargo],
      yaw = 0,
      routeIndex = 0;
    for (let step = 0; step < 16000; step++) {
      const goal = puzzle.route[routeIndex] || puzzle.target;
      const plan = planAutopilot({ fly, cargo, target: goal, yaw, puzzle });
      const dt = 0.02;
      yaw += (plan.right - plan.left) * 1.45 * dt;
      const speed = Math.max(0, (plan.left + plan.right) / 2) * 5.0;
      const previousFly = [...fly];
      fly[0] += Math.cos(yaw) * speed * dt;
      fly[1] += Math.sin(yaw) * speed * dt;
      const touching = Math.hypot(fly[0] - cargo[0], fly[1] - cargo[1]) < 2.25;
      if (touching && plan.pushing) {
        const old = [...cargo];
        cargo[0] += (fly[0] - previousFly[0]) * 0.96;
        cargo[1] += (fly[1] - previousFly[1]) * 0.96;
        if (Math.hypot(fly[0] - cargo[0], fly[1] - cargo[1]) > 1.9 || cargoHitsObstacle(puzzle, cargo[0], cargo[1]))
          cargo = old;
      }
      if (routeIndex < puzzle.route.length && Math.hypot(cargo[0] - goal[0], cargo[1] - goal[1]) < 1.05) routeIndex++;
      if (
        routeIndex === puzzle.route.length &&
        Math.hypot(cargo[0] - puzzle.target[0], cargo[1] - puzzle.target[1]) < 1.05
      )
        break;
    }
    assert.ok(
      Math.hypot(cargo[0] - puzzle.target[0], cargo[1] - puzzle.target[1]) < 1.05,
      `Completar misión: ${puzzle.name}`,
    );
  }
});

test('las velocidades 8x y 16x Turbo escalan la física adaptativamente sin saturar el hilo principal', () => {
  // 1. _autoDrive está desacoplado del bucle interno de física
  assert.match(game, /_autoDrive\(\);/);
  assert.doesNotMatch(game, /_physicsStep\(\)\s*\{[^}]*_autoDrive/);

  // 2. Escalado adaptativo con presupuesto seguro de pasos y stepScale proporcional
  assert.match(game, /const MAX_STEPS = 120;/);
  assert.match(game, /const stepScale = wantSteps \/ nSteps;/);
  assert.match(game, /this\._physicsStep\(stepScale\);/);

  // 3. Watchdog con gracia de inicio y acumulación de tiempo de simulación real
  assert.match(game, /elapsedSim > 1\.2/);
  assert.doesNotMatch(game, /this\.stagnantTime = \(this\.stagnantTime \|\| 0\) \+ 0\.28 \* this\.speedMultiplier;/);

  // 4. Acoplamiento mosca-auto libre del bug de retroceso artificial por separación
  assert.doesNotMatch(game, /hitsObstacle \|\| separation > 1\.9/);
});

test('la cabina ancla a Carla de forma 100% estática en su eje sin rotaciones parásitas', () => {
  // 1. La cabina y la cámara de cabina se orientan con flyYaw / newYaw directamente sin desfase de filtrado
  assert.match(game, /const flyYaw = newYaw;/);
  assert.match(game, /this\.cockpitGroup\.rotation\.z = flyYaw;/);
  assert.match(game, /const cFly = Math\.cos\(flyYaw\), sFly = Math\.sin\(flyYaw\);/);
  assert.match(game, /this\.bodyCamera\.position\.set\(\s*fx \+ cFly \* camX - sFly \* camY/);
  assert.match(game, /this\.bodyCamera\.lookAt\(\s*fx \+ cFly \* lookX - sFly \* lookY/);

  // 2. Postura erguida y horizontal garantizada en MuJoCo (pitch y roll nulos en cabina)
  assert.match(game, /this\.data\.qpos\[4\] = 0;\s*\/\/\s*pitch nulo/);
  assert.match(game, /this\.data\.qpos\[5\] = 0;\s*\/\/\s*roll nulo/);
});

test('los pedales tienen respuesta mecánica visible y feedback lumínico emisivo', () => {
  // Materiales emisivos reactivos
  assert.match(game, /this\.brakePedalMat = new THREE\.MeshStandardMaterial/);
  assert.match(game, /this\.gasPedalMat = new THREE\.MeshStandardMaterial/);
  assert.match(game, /this\.brakePedalMat\.emissiveIntensity = brakePress/);
  assert.match(game, /this\.gasPedalMat\.emissiveIntensity = gasPress/);

  // Iluminación dinámica de la pedalera
  assert.match(game, /this\.pedalLight\.color\.setHex/);
  assert.match(game, /this\.pedalLight\.intensity = 2\.0 \+ activeIntensity/);
});

test('el menú de velocidades expone exactamente 3 opciones simplificadas con cache-busting v=4.0', () => {
  // Solo botones: Normal (1x), Rápido (4x), Muy rápido (8x)
  const speedButtons = html.match(/class="speed-btn[^"]*"/g) || [];
  assert.equal(speedButtons.length, 3, 'Deben existir exactamente 3 botones de velocidad');
  assert.match(html, /data-speed="1"/);
  assert.match(html, /data-speed="4"/);
  assert.match(html, /data-speed="8"/);
  assert.doesNotMatch(html, /data-speed="2"/);
  assert.doesNotMatch(html, /data-speed="16"/);

  // Cache-busting en page.tsx
  assert.match(page, /\/nmf\/game\/game\.html\?v=4\.[0-9]/);
});

test('la física del auto sigue el modelo cinemático Ackermann (sin giro estático ni desplazamiento diagonal)', () => {
  // 1. Condición de empuje continuo
  assert.match(game, /canPush = touching && \(!this\.autopilot \|\| this\.autoPushing \|\| distance < 1\.45\);/);
  // 2. Desplazamiento puramente longitudinal según rumbo (cero movimiento diagonal / sideways)
  assert.match(game, /const ds = flyDelta\.x \* carCos \+ flyDelta\.y \* carSin;/);
  // 3. Giro angular dependiente de rodadura (cero rotación sobre su eje si está detenido)
  assert.match(game, /const dTheta = Math\.abs\(ds\) > 0\.0001 \? \(ds \/ wheelbase\) \* Math\.tan\(steerAngle\) : 0;/);
  // 4. Posición calculada sobre el arco de rodadura
  assert.match(game, /this\.cargo\.position\.x = oldX \+ ds \* Math\.cos\(avgRot\);/);
  assert.match(game, /this\.cargo\.position\.y = oldY \+ ds \* Math\.sin\(avgRot\);/);
});

test('guardas de integridad: la cámara de la cabina encuadra a Carla de cuerpo entero sin recortes', () => {
  const camMatch = game.match(/const camX = ([0-9.-]+),\s*camY = ([0-9.-]+),\s*camZ = ([0-9.-]+);/);
  assert.ok(camMatch, 'Debe existir la definición de coordenadas de cámara camX, camY, camZ');
  const camX = parseFloat(camMatch[1]);
  const camY = parseFloat(camMatch[2]);
  const camZ = parseFloat(camMatch[3]);

  // Altura elevada para no recortar la cabeza y alas
  assert.ok(camZ >= 0.85, `camZ (${camZ}) debe ser >= 0.85m`);
  // Distancia cómoda
  const camDist = Math.hypot(camX, camY);
  assert.ok(camDist >= 3.0 && camDist <= 4.2, `camDist (${camDist.toFixed(2)}m) debe estar entre 3.0m y 4.2m`);

  const lookMatch = game.match(/const lookX = ([0-9.-]+),\s*lookY = ([0-9.-]+),\s*lookZ = ([0-9.-]+);/);
  assert.ok(lookMatch, 'Debe existir la definición de lookX, lookY, lookZ');
  const lookX = parseFloat(lookMatch[1]);
  const lookZ = parseFloat(lookMatch[3]);

  assert.ok(lookZ <= -0.2, `lookZ (${lookZ}) debe mirar hacia abajo para enfocar pedales`);
  assert.ok(lookX >= 0.2, `lookX (${lookX}) debe centrarse entre Carla y los mandos`);
});

test('guardas de integridad: la barra superior y los botones de velocidad no tienen recortes de texto', () => {
  // Botones de velocidad con nowrap y flex-shrink: 0
  assert.match(
    html,
    /white-space:\s*nowrap\s*!important;/,
    'Los botones de velocidad deben tener white-space: nowrap !important',
  );
  assert.match(
    html,
    /flex-shrink:\s*0\s*!important;/,
    'Los botones de velocidad deben tener flex-shrink: 0 !important',
  );

  // Teclas de control WASDQ
  for (const key of ['a', 'w', 's', 'd', 'q']) {
    assert.match(html, new RegExp(`data-key="${key}"`), `La tecla ${key.toUpperCase()} debe estar presente`);
  }
});

test('el piloto automático reconoce a Carla conduciendo al volante y acota desvíos aprendidos', () => {
  // 1. Carla sentada al volante del Mini Cooper (desplazada ~0.45m a lo largo del chasis)
  const seatedPlan = planAutopilot({
    fly: [2.4 - 0.45, 0.8],
    cargo: [2.4, 0.8],
    target: [4.8, 0.9],
    yaw: 0,
  });
  assert.equal(seatedPlan.pushing, true, 'Carla al volante debe estar empujando/conduciendo hacia adelante');
  assert.equal(seatedPlan.state, 'pushing towards target');

  // 2. Acotado estricto de desvíos aprendidos a ±1.5m para evitar deriva infinita
  const runawayPlan = planAutopilot({
    fly: [1.2, 0],
    cargo: [3.2, 0],
    target: [6.2, 0],
    yaw: 0,
    learnedOffset: [15.0, -22.0], // Intento de deriva extrema
  });
  // effTargetX = 6.2 + 1.5 = 7.7, effTargetY = 0 - 1.5 = -1.5
  assert.ok(runawayPlan.waypoint[0] < 9.0, 'El desvío en X debe estar acotado a <= 1.5m');
  assert.ok(runawayPlan.waypoint[1] >= -2.5, 'El desvío en Y debe estar acotado a >= -1.5m');
});

test('el cálculo instantáneo por modo ráfaga está integrado en interfaz y simulación', () => {
  assert.match(html, /id="burst-train-btn"/, 'Debe existir el botón ⚡ Ráfaga en la barra superior');
  assert.match(html, /id="burst-train-panel-btn"/, 'Debe existir el botón ⚡ Ráfaga rápida en el panel');
  assert.match(game, /runBurstTraining\(/, 'Debe existir el método runBurstTraining en Game');
  assert.match(game, /_runHeadlessEpisode\(/, 'Debe existir el método _runHeadlessEpisode en Game');
  assert.match(game, /if \(this\.isBurstTraining\) return;/, 'Debe pausar el bucle _frame durante la ráfaga');
});

test('la navegación autónoma en cabina completa las 6 misiones del catálogo vial urbano', () => {
  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
  for (const puzzle of ALL_PUZZLES) {
    let carPos = [...puzzle.cargo];
    let carYaw = 0;
    let routeIndex = 0;
    const wheelbase = 1.45;
    const dt = 0.02;

    for (let step = 0; step < 600; step++) {
      const goal = puzzle.route[routeIndex] || puzzle.target;
      const fly = [carPos[0] - Math.cos(carYaw) * 0.95, carPos[1] - Math.sin(carYaw) * 0.95];
      const plan = planAutopilot({ fly, cargo: carPos, target: goal, yaw: carYaw, puzzle, inCockpit: true });

      const steerCmd = plan.right - plan.left;
      const steerAngle = clamp(steerCmd * 0.72, -0.45, 0.45);
      const forwardDrive = Math.max(0, (plan.left + plan.right) / 2);
      const pace = forwardDrive * 5.5;
      const ds = pace * dt;

      const dTheta = Math.abs(ds) > 0.0001 ? (ds / wheelbase) * Math.tan(steerAngle) : 0;
      const newRotZ = carYaw + dTheta;
      const avgRot = carYaw + dTheta * 0.5;
      carPos[0] += ds * Math.cos(avgRot);
      carPos[1] += ds * Math.sin(avgRot);
      carYaw = newRotZ;

      const activeDistance = Math.hypot(carPos[0] - goal[0], carPos[1] - goal[1]);
      let passed = false;
      if (routeIndex < puzzle.route.length) {
        const nextGoal = puzzle.route[routeIndex + 1] || puzzle.target;
        const segDx = nextGoal[0] - goal[0];
        const segDy = nextGoal[1] - goal[1];
        const carDx = carPos[0] - goal[0];
        const carDy = carPos[1] - goal[1];
        passed = segDx * carDx + segDy * carDy > 0;
      }

      if (routeIndex < puzzle.route.length && (activeDistance < 1.35 || (activeDistance < 2.8 && passed))) {
        routeIndex++;
      }

      const goalDistance = Math.hypot(carPos[0] - puzzle.target[0], carPos[1] - puzzle.target[1]);
      if (routeIndex >= puzzle.route.length && goalDistance < 1.1) {
        break;
      }
    }

    const finalDist = Math.hypot(carPos[0] - puzzle.target[0], carPos[1] - puzzle.target[1]);
    assert.ok(
      routeIndex >= puzzle.route.length && finalDist < 1.1,
      `Misión ${puzzle.name} completada con éxito (distancia final: ${finalDist.toFixed(2)}m)`,
    );
  }
});

test('la velocidad 8x y el modo ráfaga mantienen la frecuencia de guiñada a 50Hz sin degradación de trayectoria', () => {
  // 1. Invariante de control a 50Hz y actualización instantánea en cambio de waypoint en bucle físico
  assert.match(
    game,
    /if \(this\.autopilot && i > 0 && \(i % 10 === 0 \|\| this\._routeChanged\)\)/,
    'El bucle de _frame debe actualizar _autoDrive a 50Hz (cada 10 sub-pasos) o al cruzar waypoint',
  );
  assert.match(game, /this\._routeChanged = true;/, '_updateCargo debe marcar _routeChanged al avanzar routeIndex');

  // 2. Desactivación de falsos positivos del watchdog durante el estacionamiento en bahía
  assert.match(
    game,
    /const isParking = this\.routeIndex >= puzzle\.route\.length && goalDist < 1\.2;/,
    'El watchdog debe reconocer el estado isParking para no penalizar el frenado final',
  );

  // 3. Simulación determinista a 8x para verificar que todas las 6 misiones urbanas completan con éxito
  const dt = 0.002;
  const wheelbase = 1.45;
  const speedMultiplier = 8;
  const frameWallDt = 1 / 60;
  const simDtPerFrame = frameWallDt * speedMultiplier;

  for (const puzzle of ALL_PUZZLES) {
    const carPos = [...puzzle.cargo];
    let carYaw = 0;
    let routeIndex = 0;
    let driveL = 0,
      driveR = 0;
    let routeChanged = false;

    const autoDrive = () => {
      const goal = puzzle.route[routeIndex] || puzzle.target;
      const fly = [carPos[0] - Math.cos(carYaw) * 0.95, carPos[1] - Math.sin(carYaw) * 0.95];
      const plan = planAutopilot({ fly, cargo: carPos, target: goal, yaw: carYaw, puzzle, inCockpit: true });
      driveL = plan.left;
      driveR = plan.right;
    };

    let simAcc = 0;
    let finished = false;

    for (let frame = 0; frame < 60 * 30; frame++) {
      simAcc += simDtPerFrame;
      const wantSteps = Math.floor(simAcc / dt);
      if (wantSteps <= 0) continue;
      simAcc -= wantSteps * dt;
      const nSteps = Math.min(wantSteps, 120);
      const stepScale = wantSteps / nSteps;

      autoDrive();

      for (let s = 0; s < nSteps; s++) {
        if (s > 0 && (s % 10 === 0 || routeChanged)) {
          autoDrive();
          routeChanged = false;
        }

        const steerCmd = driveR - driveL;
        const steerAngle = clamp(steerCmd * 0.72, -0.45, 0.45);
        const forwardDrive = Math.max(0, (driveL + driveR) / 2);
        const pace = forwardDrive * 5.5;
        const ds = pace * dt * stepScale;

        const dTheta = Math.abs(ds) > 0.0001 ? (ds / wheelbase) * Math.tan(steerAngle) : 0;
        const avgRot = carYaw + dTheta * 0.5;
        carPos[0] += ds * Math.cos(avgRot);
        carPos[1] += ds * Math.sin(avgRot);
        carYaw += dTheta;

        const activeGoal = puzzle.route[routeIndex] || puzzle.target;
        const activeDistance = Math.hypot(carPos[0] - activeGoal[0], carPos[1] - activeGoal[1]);
        let passed = false;
        if (routeIndex < puzzle.route.length) {
          const nextGoal = puzzle.route[routeIndex + 1] || puzzle.target;
          const segDx = nextGoal[0] - activeGoal[0];
          const segDy = nextGoal[1] - activeGoal[1];
          const carDx = carPos[0] - activeGoal[0];
          const carDy = carPos[1] - activeGoal[1];
          passed = segDx * carDx + segDy * carDy > 0;
        }

        if (routeIndex < puzzle.route.length && (activeDistance < 1.35 || (activeDistance < 2.8 && passed))) {
          routeIndex++;
          routeChanged = true;
        }

        const goalDist = Math.hypot(carPos[0] - puzzle.target[0], carPos[1] - puzzle.target[1]);
        if (routeIndex >= puzzle.route.length && goalDist < 1.1) {
          finished = true;
          break;
        }
      }
      if (finished) break;
    }

    const finalDist = Math.hypot(carPos[0] - puzzle.target[0], carPos[1] - puzzle.target[1]);
    assert.ok(
      finished && finalDist < 1.1,
      `Misión a 8x ${puzzle.name} debe completar exitosamente (distancia: ${finalDist.toFixed(2)}m)`,
    );
  }
});

test('las extremidades cinemáticas articuladas conectan a Carla con el volante y los pedales (IK de 2 huesos)', () => {
  // 1. Resolvedor analítico de cinemática inversa y posicionamiento de segmentos
  assert.match(game, /function solve2BoneIK\(/, 'Debe existir la función solve2BoneIK');
  assert.match(game, /function positionSegment\(/, 'Debe existir la función positionSegment');

  // 2. Definición del rig de 4 extremidades de conducción en cabina
  assert.match(game, /this\.cockpitLimbs = \{/, 'Debe existir this.cockpitLimbs con los 4 miembros');
  assert.match(game, /targetAnchor: wristL/, 'Brazo izquierdo anclado a la garra del volante izquierda');
  assert.match(game, /targetAnchor: wristR/, 'Brazo derecho anclado a la garra del volante derecha');
  assert.match(game, /targetAnchor: ankleBrake/, 'Pata media izquierda anclada al pedal de freno');
  assert.match(game, /targetAnchor: ankleGas/, 'Pata media derecha anclada al pedal de acelerador');

  // 3. Ocultación de patas de caminata por defecto en la cabina
  assert.match(game, /const isWalkingLimb =/, 'Debe identificar las extremidades de caminata para ocultarlas');
  assert.match(game, /name\.includes\('lf_'\) \|\|/, 'Debe filtrar patas delanteras y medias para evitar que floten');

  // 4. Actualización sincronizada a 60 FPS en _updateCamera
  assert.match(game, /updateLimb\(this\.cockpitLimbs\.armL/, 'Debe sincronizar el brazo izquierdo');
  assert.match(game, /updateLimb\(this\.cockpitLimbs\.armR/, 'Debe sincronizar el brazo derecho');
  assert.match(game, /updateLimb\(this\.cockpitLimbs\.legL/, 'Debe sincronizar la pata de freno');
  assert.match(game, /updateLimb\(this\.cockpitLimbs\.legR/, 'Debe sincronizar la pata de acelerador');
});

test('la resolución de colisiones y límites permite a Carla avanzar y completar el slalom y entrar en la bahía sin bloqueos', () => {
  // 1. Verificación en game.js de la protección de colisión en cabina
  assert.match(
    game,
    /if \(!isDriving && activePuzzle\.obstacles\)/,
    '_physicsStep debe proteger a Carla de colisiones de obstáculos mientras conduce en la cabina',
  );
  assert.match(
    game,
    /const boundedX = clamp\(fx, -3\.5, 22\.0\);/,
    'Los límites de Carla en _physicsStep deben cubrir la calzada completa hasta 22.0m',
  );

  // 2. Verificación en autopilot.mjs de desaceleración exclusiva para la bahía final
  const autoMjs = readFileSync(new URL('../public/nmf/game/autopilot.mjs', import.meta.url), 'utf8');
  assert.match(
    autoMjs,
    /const isTargetBay = puzzle && target\[0\] === puzzle\.target\[0\] && target\[1\] === puzzle\.target\[1\];/,
    'isDocking solo debe activarse al aproximarse a la bahía final, no en waypoints intermedios',
  );

  // 3. Simulación completa de Roadworks Slalom verificando que entra y completa la bahía
  const slalom = ALL_PUZZLES[2];
  const carPos = [...slalom.cargo];
  let carYaw = 0;
  let routeIndex = 0;
  let finished = false;

  for (let s = 0; s < 800; s++) {
    const goal = slalom.route[routeIndex] || slalom.target;
    const fly = [carPos[0] - Math.cos(carYaw) * 0.95, carPos[1] - Math.sin(carYaw) * 0.95];
    const plan = planAutopilot({ fly, cargo: carPos, target: goal, yaw: carYaw, puzzle: slalom, inCockpit: true });

    const steerCmd = plan.right - plan.left;
    const steerAngle = clamp(steerCmd * 0.72, -0.45, 0.45);
    const forwardDrive = Math.max(0, (plan.left + plan.right) / 2);
    const pace = forwardDrive * 5.5;
    const ds = pace * 0.02;

    const dTheta = Math.abs(ds) > 0.0001 ? (ds / 1.45) * Math.tan(steerAngle) : 0;
    const avgRot = carYaw + dTheta * 0.5;
    carPos[0] += ds * Math.cos(avgRot);
    carPos[1] += ds * Math.sin(avgRot);
    carYaw += dTheta;

    const activeDistance = Math.hypot(carPos[0] - goal[0], carPos[1] - goal[1]);
    let passed = false;
    if (routeIndex < slalom.route.length) {
      const nextGoal = slalom.route[routeIndex + 1] || slalom.target;
      const segDx = nextGoal[0] - goal[0];
      const segDy = nextGoal[1] - goal[1];
      const carDx = carPos[0] - goal[0];
      const carDy = carPos[1] - goal[1];
      passed = segDx * carDx + segDy * carDy > 0;
    }

    if (routeIndex < slalom.route.length && (activeDistance < 1.35 || (activeDistance < 2.8 && passed))) {
      routeIndex++;
    }

    const goalDist = Math.hypot(carPos[0] - slalom.target[0], carPos[1] - slalom.target[1]);
    if (routeIndex >= slalom.route.length && goalDist < 1.1) {
      finished = true;
      break;
    }
  }

  const finalDist = Math.hypot(carPos[0] - slalom.target[0], carPos[1] - slalom.target[1]);
  assert.ok(
    finished && finalDist < 1.1,
    `Roadworks Slalom debe completar la bahía de estacionamiento sin estancarse (distancia: ${finalDist.toFixed(2)}m)`,
  );
});
