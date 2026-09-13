import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('🛡️  Ejecutando auditoría de integridad de simulación, física y cámara...');

const gamePath = path.join(root, 'public/nmf/game/game.js');
const htmlPath = path.join(root, 'public/nmf/game/game.html');
const pagePath = path.join(root, 'app/page.tsx');

assert.ok(fs.existsSync(gamePath), 'game.js debe existir');
assert.ok(fs.existsSync(htmlPath), 'game.html debe existir');
assert.ok(fs.existsSync(pagePath), 'page.tsx debe existir');

const game = fs.readFileSync(gamePath, 'utf-8');
const html = fs.readFileSync(htmlPath, 'utf-8');
const page = fs.readFileSync(pagePath, 'utf-8');
assert.match(page, /\/nmf\/game\/game\.html\?v=4\.[0-9]/, 'page.tsx debe cargar game.html con versionado v=4.x');

// 1. INVARIANTE: CINEMÁTICA VEHICULAR ACKERMANN
console.log('  ✓ Verificando modelo cinemático Ackermann...');
assert.match(
  game,
  /const ds = flyDelta\.x \* carCos \+ flyDelta\.y \* carSin;/,
  'El desplazamiento longitudinal debe proyectarse sobre el rumbo del chasis (cero movimiento diagonal)',
);
assert.match(
  game,
  /const dTheta = Math\.abs\(ds\) > 0\.0001 \? \(ds \/ wheelbase\) \* Math\.tan\(steerAngle\) : 0;/,
  'La rotación angular debe requerir rodadura longitudinal (dTheta = 0 si ds = 0)',
);
assert.match(
  game,
  /this\.cargo\.position\.x = oldX \+ ds \* Math\.cos\(avgRot\);/,
  'La posición X debe integrarse en el arco de giro medio',
);
assert.match(
  game,
  /this\.cargo\.position\.y = oldY \+ ds \* Math\.sin\(avgRot\);/,
  'La posición Y debe integrarse en el arco de giro medio',
);

// 2. INVARIANTE: CÁMARA DE LA CABINA (Encuadre de cuerpo entero de Carla, pedales y volante)
console.log('  ✓ Verificando encuadre y estabilidad de la cabina de Carla...');
const camMatch = game.match(/const camX = ([0-9.-]+),\s*camY = ([0-9.-]+),\s*camZ = ([0-9.-]+);/);
assert.ok(camMatch, 'Debe existir la definición de camX, camY, camZ');
const camX = parseFloat(camMatch[1]);
const camY = parseFloat(camMatch[2]);
const camZ = parseFloat(camMatch[3]);

assert.ok(
  camZ >= 0.85,
  `La cámara debe estar elevada (camZ = ${camZ} >= 0.85) para evitar cortar la cabeza y alas de Carla`,
);
const camDist = Math.hypot(camX, camY);
assert.ok(
  camDist >= 3.0 && camDist <= 4.2,
  `La distancia horizontal (${camDist.toFixed(2)}m) debe estar en [3.0m, 4.2m] para encuadre completo`,
);

const lookMatch = game.match(/const lookX = ([0-9.-]+),\s*lookY = ([0-9.-]+),\s*lookZ = ([0-9.-]+);/);
assert.ok(lookMatch, 'Debe existir la definición de lookX, lookY, lookZ');
const lookX = parseFloat(lookMatch[1]);
const lookZ = parseFloat(lookMatch[3]);

assert.ok(
  lookZ <= -0.2,
  `El punto focal debe mirar hacia abajo (lookZ = ${lookZ} <= -0.2) para enfocar pedales e instrumental`,
);
assert.ok(lookX >= 0.2, `El punto focal debe centrarse entre Carla y el volante (lookX = ${lookX} >= 0.2)`);

// Carla 100% estática en su eje
assert.match(game, /const flyYaw = newYaw;/, 'La orientación de la cabina debe anclarse a newYaw sin desfase');
assert.match(
  game,
  /this\.cockpitGroup\.rotation\.z = flyYaw;/,
  'El grupo de cabina debe sincronizar rotación con Carla',
);

// 3. INVARIANTE: INTERFAZ Y BOTONES DE VELOCIDAD
console.log('  ✓ Verificando invariantes de UI y botones de velocidad...');
const speedButtons = html.match(/class="speed-btn[^"]*"/g) || [];
assert.equal(speedButtons.length, 3, 'Deben existir exactamente 3 botones de velocidad (1x, 4x, 8x)');
assert.match(html, /data-speed="1"/, 'Debe existir botón 1x');
assert.match(html, /data-speed="4"/, 'Debe existir botón 4x');
assert.match(html, /data-speed="8"/, 'Debe existir botón 8x');

// Estilos anti-corte en CSS
assert.match(
  html,
  /white-space:\s*nowrap\s*!important;/,
  'Los botones de velocidad deben tener white-space: nowrap !important',
);
assert.match(html, /flex-shrink:\s*0\s*!important;/, 'Los botones de velocidad deben tener flex-shrink: 0 !important');

// 4. INVARIANTE: CONTROLES DE CONDUCCIÓN
console.log('  ✓ Verificando controles de conducción (WASDQ)...');
for (const key of ['a', 'w', 's', 'd', 'q']) {
  assert.match(html, new RegExp(`data-key="${key}"`), `La tecla ${key.toUpperCase()} debe estar presente en el HUD`);
}

// 5. INVARIANTE: CONECTOMA MALECNS Y SENSORES
console.log('  ✓ Verificando conectoma MaleCNS y visión 3D...');
assert.match(game, /MDN/, 'Neurona MDN de marcha atrás/freno presente');
assert.match(game, /visual_left/, 'Neurona sensorial visual_left presente');
assert.match(game, /visual_right/, 'Neurona sensorial visual_right presente');
assert.match(game, /_updateVisionSensors/, 'Sistema de visión 3D de 5 rayos presente');

console.log('✨ Todas las 5 guardas de integridad superadas exitosamente.');
