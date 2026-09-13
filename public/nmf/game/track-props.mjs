// ============================================================================
// TRACK PROPS & SCENERY BUILDER (Principio KISS: modular, limpio y reutilizable)
// ============================================================================
// Este módulo centraliza la construcción procedimental de elementos 3D urbanos:
// bahías de estacionamiento, marcas viales, cordones, calzadas, farolas,
// arbolado y obstáculos (vehículos estacionados, conos, vallas de obra).

import * as THREE from 'three';

// Materiales compartidos reutilizables (evita instanciar materiales idénticos repetidamente)
const SHARED_MATERIALS = {
  curb: new THREE.MeshStandardMaterial({ color: 0xdde3ea, roughness: 0.7 }),
  curbDark: new THREE.MeshStandardMaterial({ color: 0xc8d0d8, roughness: 0.85 }),
  whiteLine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  amberLine: new THREE.MeshBasicMaterial({ color: 0xf59e0b }),
  poleMetal: new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8 }),
  lampGlow: new THREE.MeshBasicMaterial({ color: 0xfffae0 }),
  blackTire: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 }),
  rimAlloy: new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.82, roughness: 0.2 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9, roughness: 0.15 }),
  darkTrim: new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.88 }),
};

/**
 * Crea una superficie de asfalto plano para calles, dársenas o playas de estacionamiento.
 */
export function createRoadSurface(x, y, width, height, color = 0x2e3440) {
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.1 }),
  );
  road.position.set(x, y, 0.01);
  return road;
}

/**
 * Crea un cordón de vereda o separación vial.
 */
export function createCurb(x, y, length, width = 0.35, height = 0.22, color = 0xdde3ea) {
  const mat = color === 0xdde3ea ? SHARED_MATERIALS.curb : new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const curb = new THREE.Mesh(new THREE.BoxGeometry(length, width, height), mat);
  curb.position.set(x, y, height / 2);
  return curb;
}

/**
 * Crea una zona verde / césped.
 */
export function createLawn(x, y, length, width, z = 0.18, color = 0x2d6a2e) {
  const lawn = new THREE.Mesh(
    new THREE.PlaneGeometry(length, width),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  lawn.position.set(x, y, z);
  return lawn;
}

/**
 * Crea la bahía delimitada de estacionamiento objetivo en color ámbar.
 * Incluye perímetro continuo de línea gruesa, relleno semitransparente con brillo
 * y 4 balizas luminosas en las esquinas.
 */
export function createParkingBay(x, y, hw = 1.3, hh = 1.6, angle = 0) {
  const bayGroup = new THREE.Group();

  // Contorno perimetral cerrado
  const bayPoints = [
    new THREE.Vector3(-hw, -hh, 0.03),
    new THREE.Vector3(hw, -hh, 0.03),
    new THREE.Vector3(hw, hh, 0.03),
    new THREE.Vector3(-hw, hh, 0.03),
    new THREE.Vector3(-hw, -hh, 0.03),
  ];
  const bayLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(bayPoints),
    new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 3 }),
  );

  // Relleno semitransparente cálido
  const bayFill = new THREE.Mesh(
    new THREE.PlaneGeometry(hw * 2, hh * 2),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.14, depthWrite: false }),
  );
  bayFill.position.z = 0.025;

  bayGroup.add(bayLine, bayFill);
  bayGroup.position.set(x, y, 0);
  if (angle) bayGroup.rotation.z = angle;

  return bayGroup;
}

/**
 * Crea la guía de aproximación en línea discontinua desde el punto de partida hasta la meta.
 */
export function createDashedRoute(start, route = [], target) {
  const pathPoints = [new THREE.Vector3(start.x, start.y, 0.035)];
  if (Array.isArray(route)) {
    route.forEach((pt) => pathPoints.push(new THREE.Vector3(pt[0], pt[1], 0.035)));
  }
  pathPoints.push(new THREE.Vector3(target.x, target.y, 0.035));

  const pathLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pathPoints),
    new THREE.LineDashedMaterial({ color: 0xf59e0b, dashSize: 0.35, gapSize: 0.25, linewidth: 2 }),
  );
  pathLine.computeLineDistances();
  return pathLine;
}

/**
 * Crea una hilera de líneas blancas discontinuas para el carril central de la calzada.
 */
export function createLaneDashes(group, startX, endX, stepX, y, length = 1.6, width = 0.14) {
  const geo = new THREE.PlaneGeometry(length, width);
  for (let x = startX; x <= endX; x += stepX) {
    const dash = new THREE.Mesh(geo, SHARED_MATERIALS.whiteLine);
    dash.position.set(x, y, 0.02);
    group.add(dash);
  }
}

/**
 * Construye una vivienda suburbana decorativa con paredes, tejado a 4 aguas y ventanas.
 */
export function createSuburbanHouse(x, y, wallColor = 0xf8fafc, roofColor = 0x7f1d1d) {
  const hg = new THREE.Group();
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 3.4, 3.2),
    new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.6 }),
  );
  walls.position.set(0, 0, 1.6);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(3.2, 1.8, 4),
    new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.7 }),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.set(0, 0, 4.1);

  // Ventanas reflectantes
  const winMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.2, metalness: 0.8 });
  const winGeo = new THREE.PlaneGeometry(0.7, 0.9);
  for (let w = -1.2; w <= 1.2; w += 1.2) {
    const win = new THREE.Mesh(winGeo, winMat);
    win.rotation.x = Math.PI / 2;
    win.position.set(w, -1.71, 1.8);
    hg.add(win);
  }

  hg.add(walls, roof);
  hg.position.set(x, y, 0.2);
  return hg;
}

/**
 * Construye un árbol con tronco cilíndrico y copa esférica.
 */
export function createTree(x, y, scale = 1.0) {
  const tg = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.16 * scale, 1.6 * scale, 8),
    new THREE.MeshStandardMaterial({ color: 0x543d2b, roughness: 0.9 }),
  );
  trunk.position.set(0, 0, 0.8 * scale);

  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(0.85 * scale, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x2d6a2e, roughness: 0.85 }),
  );
  foliage.scale.set(1, 1, 1.3);
  foliage.position.set(0, 0, 2.1 * scale);

  tg.add(trunk, foliage);
  tg.position.set(x, y, 0.1);
  return tg;
}

/**
 * Construye una farola urbana LED comercial con mástil, brazo y luminaria.
 */
export function createStreetLamp(x, y, armY = -0.4) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.5, 8), SHARED_MATERIALS.poleMetal);
  pole.rotation.x = Math.PI / 2;
  pole.position.set(0, 0, 2.25);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), SHARED_MATERIALS.curb);
  arm.position.set(0, armY, 4.45);

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.35, 0.06), SHARED_MATERIALS.lampGlow);
  lamp.position.set(0, armY - 0.3, 4.4);

  g.add(pole, arm, lamp);
  g.position.set(x, y, 0.0);
  return g;
}

/**
 * Añade 4 ruedas automotrices completas (neumático + llanta) a un grupo de vehículo.
 */
export function addVehicleWheels(carGroup, wheelOffset = 0.68, trackWidth = 0.58, radius = 0.205) {
  const wGeo = new THREE.CylinderGeometry(radius, radius, 0.13, 16);
  const rGeo = new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, 0.135, 12);

  for (const [wx, wy] of [
    [wheelOffset, trackWidth],
    [wheelOffset, -trackWidth],
    [-wheelOffset, trackWidth],
    [-wheelOffset, -trackWidth],
  ]) {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(wGeo, SHARED_MATERIALS.blackTire);
    tire.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(rGeo, SHARED_MATERIALS.rimAlloy);
    rim.rotation.x = Math.PI / 2;
    wheel.add(tire, rim);
    wheel.position.set(wx, wy, radius);
    carGroup.add(wheel);
  }
}

/**
 * Construye modelos 3D de vehículos estacionados para las misiones urbanas.
 * Soporta: 'coral_mini', 'urban_pickup', 'blue_hatchback', 'delivery_van', 'grey_sedan'.
 */
export function createParkedCar(type) {
  const g = new THREE.Group();
  const isCoral = type === 'coral_mini';
  const isPickup = type === 'urban_pickup';
  const isHatch = type === 'blue_hatchback';
  const isVan = type === 'delivery_van';

  const chromeMat = SHARED_MATERIALS.chrome;
  const blackMat = SHARED_MATERIALS.darkTrim;
  const glassMat = SHARED_MATERIALS.glass;

  if (isCoral) {
    // Mini Cooper Coral/Salmón estacionado
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.16, 0.08), blackMat);
    skirt.position.z = 0.16;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.06, 1.14, 0.42),
      new THREE.MeshStandardMaterial({ color: 0xf87171, roughness: 0.32, metalness: 0.4 }),
    );
    body.position.z = 0.39;
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 1.06, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.25 }),
    );
    roof.position.set(-0.12, 0, 0.84);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.18, 1.02, 0.36), glassMat);
    glass.position.set(-0.1, 0, 0.67);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.16, 0.1), chromeMat);
    fb.position.set(1.08, 0, 0.24);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.16, 0.1), chromeMat);
    rb.position.set(-1.08, 0, 0.24);
    const hlGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 16);
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xfffae0, emissive: 0xfffae0, emissiveIntensity: 0.3 });
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.rotation.z = Math.PI / 2;
    hl.position.set(1.05, 0.38, 0.46);
    const hr = hl.clone();
    hr.position.y = -0.38;
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.4 });
    const tl = new THREE.Mesh(hlGeo, tlMat);
    tl.rotation.z = Math.PI / 2;
    tl.position.set(-1.05, 0.38, 0.46);
    const tr = tl.clone();
    tr.position.y = -0.38;
    for (const my of [0.6, -0.6]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.07), blackMat);
      mirror.position.set(0.36, my, 0.64);
      g.add(mirror);
    }
    g.add(skirt, body, roof, glass, fb, rb, hl, hr, tl, tr);
  } else if (isPickup) {
    // Pickup urbana / SUV
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.35, 1.22, 0.08), blackMat);
    skirt.position.z = 0.18;
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 1.2, 0.48),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35, metalness: 0.4 }),
    );
    cab.position.set(0.35, 0, 0.46);
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 1.16, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.35, metalness: 0.4 }),
    );
    hood.position.set(0.95, 0, 0.48);
    const bedWallL = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.34), blackMat);
    bedWallL.position.set(-0.62, 0.56, 0.52);
    const bedWallR = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.08, 0.34), blackMat);
    bedWallR.position.set(-0.62, -0.56, 0.52);
    const bedWallBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.12, 0.34), blackMat);
    bedWallBack.position.set(-1.12, 0, 0.52);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.08, 0.36), glassMat);
    glass.position.set(0.3, 0, 0.78);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.22, 0.12), chromeMat);
    fb.position.set(1.22, 0, 0.25);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.22, 0.12), chromeMat);
    rb.position.set(-1.18, 0, 0.25);
    const hlGeo = new THREE.BoxGeometry(0.06, 0.24, 0.12);
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xfffae0, emissive: 0xfffae0, emissiveIntensity: 0.35 });
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(1.22, 0.42, 0.48);
    const hr = hl.clone();
    hr.position.y = -0.42;
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.4 });
    const tl = new THREE.Mesh(hlGeo, tlMat);
    tl.position.set(-1.18, 0.42, 0.48);
    const tr = tl.clone();
    tr.position.y = -0.42;
    for (const my of [0.65, -0.65]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.08), blackMat);
      mirror.position.set(0.55, my, 0.72);
      g.add(mirror);
    }
    g.add(skirt, cab, hood, bedWallL, bedWallR, bedWallBack, glass, fb, rb, hl, hr, tl, tr);
  } else if (isHatch) {
    // Hatchback azul urbano
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.12, 0.08), blackMat);
    skirt.position.z = 0.16;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 1.1, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.28, metalness: 0.5 }),
    );
    body.position.z = 0.36;
    const greenhouse = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.98, 0.36), glassMat);
    greenhouse.position.set(-0.06, 0, 0.65);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 1.0, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.28, metalness: 0.5 }),
    );
    roof.position.set(-0.06, 0, 0.83);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.12, 0.09), blackMat);
    fb.position.set(1.02, 0, 0.22);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.12, 0.09), blackMat);
    rb.position.set(-1.02, 0, 0.22);
    const hlGeo = new THREE.SphereGeometry(0.09, 12, 10);
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xfffae0, emissive: 0xfffae0, emissiveIntensity: 0.4 });
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.scale.set(0.5, 1, 0.7);
    hl.position.set(1.0, 0.36, 0.42);
    const hr = hl.clone();
    hr.position.y = -0.36;
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.4 });
    const tl = new THREE.Mesh(hlGeo, tlMat);
    tl.scale.set(0.4, 1, 0.8);
    tl.position.set(-1.0, 0.36, 0.44);
    const tr = tl.clone();
    tr.position.y = -0.36;
    for (const my of [0.58, -0.58]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.06), blackMat);
      mirror.position.set(0.32, my, 0.6);
      g.add(mirror);
    }
    g.add(skirt, body, greenhouse, roof, fb, rb, hl, hr, tl, tr);
  } else if (isVan) {
    // Furgoneta de reparto / Van
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.45, 1.2, 0.08), blackMat);
    skirt.position.z = 0.17;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.18, 0.52),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45, metalness: 0.2 }),
    );
    body.position.z = 0.44;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.1, 0.36), glassMat);
    cabin.position.set(0.65, 0, 0.76);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(2.38, 1.14, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45, metalness: 0.2 }),
    );
    roof.position.set(-0.08, 0, 0.88);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.16, 0.1), chromeMat);
    fb.position.set(1.18, 0, 0.24);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.16, 0.1), chromeMat);
    rb.position.set(-1.18, 0, 0.24);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 0.16), chromeMat);
    grille.position.set(1.16, 0, 0.4);
    const hlGeo = new THREE.BoxGeometry(0.06, 0.22, 0.08);
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0xf1f5f9, emissiveIntensity: 0.35 });
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(1.16, 0.4, 0.45);
    const hr = hl.clone();
    hr.position.y = -0.4;
    const tl = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.9, 0.07),
      new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.5 }),
    );
    tl.position.set(-1.16, 0, 0.45);
    for (const my of [0.6, -0.6]) {
      const mirror = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.08, 0.07),
        new THREE.MeshStandardMaterial({ color: 0x64748b }),
      );
      mirror.position.set(0.38, my, 0.65);
      g.add(mirror);
    }
    g.add(skirt, body, cabin, roof, fb, rb, grille, hl, hr, tl);
  } else {
    // Sedán gris urbano por defecto
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.14, 0.08), blackMat);
    skirt.position.z = 0.16;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 1.12, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.5 }),
    );
    body.position.z = 0.38;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.22, 1.02, 0.34), glassMat);
    glass.position.set(-0.06, 0, 0.66);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 1.04, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.5 }),
    );
    roof.position.set(-0.06, 0, 0.83);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.14, 0.1), chromeMat);
    fb.position.set(1.08, 0, 0.23);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.14, 0.1), chromeMat);
    rb.position.set(-1.08, 0, 0.23);
    const hlGeo = new THREE.BoxGeometry(0.06, 0.22, 0.09);
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xfffae0, emissive: 0xfffae0, emissiveIntensity: 0.35 });
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(1.06, 0.38, 0.45);
    const hr = hl.clone();
    hr.position.y = -0.38;
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.4 });
    const tl = new THREE.Mesh(hlGeo, tlMat);
    tl.position.set(-1.06, 0.38, 0.45);
    const tr = tl.clone();
    tr.position.y = -0.38;
    for (const my of [0.6, -0.6]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.07), blackMat);
      mirror.position.set(0.34, my, 0.62);
      g.add(mirror);
    }
    g.add(skirt, body, glass, roof, fb, rb, hl, hr, tl, tr);
  }

  // 4 Ruedas con llantas de aleación
  const wheelOffset = isVan ? 0.82 : isPickup ? 0.78 : 0.68;
  addVehicleWheels(g, wheelOffset, 0.58, 0.205);

  return g;
}

/**
 * Construye un cono de tráfico reflectante de obras viales 3D.
 */
export function createTrafficCone() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.38, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 }),
  );
  base.position.z = 0.025;

  const coneGeo = new THREE.ConeGeometry(0.16, 0.65, 16);
  coneGeo.rotateX(Math.PI / 2);
  coneGeo.translate(0, 0, 0.35);
  const coneMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    roughness: 0.35,
    metalness: 0.1,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);

  const collarGeo = new THREE.CylinderGeometry(0.115, 0.13, 0.16, 16);
  collarGeo.rotateX(Math.PI / 2);
  collarGeo.translate(0, 0, 0.38);
  const collar = new THREE.Mesh(
    collarGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.15, metalness: 0.2 }),
  );

  g.add(base, cone, collar);
  return g;
}

/**
 * Construye una valla de advertencia de obras con franjas diagonales y baliza intermitente.
 */
export function createRoadworkBarrier() {
  const g = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#18181b';
  for (let x = -32; x < 160; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, 32);
    ctx.lineTo(x + 16, 0);
    ctx.lineTo(x + 28, 0);
    ctx.lineTo(x + 12, 32);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.46), boardMat);
  board.position.z = 0.58;

  const legMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.2 });
  const legGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8);
  for (const lx of [0.75, -0.75]) {
    const leg1 = new THREE.Mesh(legGeo, legMat);
    leg1.rotation.y = 0.25;
    leg1.position.set(lx, 0.15, 0.36);
    const leg2 = new THREE.Mesh(legGeo, legMat);
    leg2.rotation.y = -0.25;
    leg2.position.set(lx, -0.15, 0.36);
    g.add(leg1, leg2);
  }

  const beaconGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.12, 12);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.8,
  });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.set(0, 0, 0.88);
  g.add(board, beacon);
  return g;
}

/**
 * Construye un contenedor de residuos industrial con ruedas y tapa abatible.
 */
export function createDumpster() {
  const g = new THREE.Group();
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.6, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
  const bin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.25, 0.72), greenMat);
  bin.position.z = 0.52;
  const lidL = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.62, 0.04), darkMat);
  lidL.position.set(0, 0.31, 0.89);
  const lidR = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.62, 0.04), darkMat);
  lidR.position.set(0, -0.31, 0.89);
  for (const my of [0.64, -0.64]) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.12), darkMat);
    pocket.position.set(0, my, 0.55);
    g.add(pocket);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12);
  for (const [wx, wy] of [
    [0.58, 0.48],
    [0.58, -0.48],
    [-0.58, 0.48],
    [-0.58, -0.48],
  ]) {
    const w = new THREE.Mesh(wheelGeo, darkMat);
    w.rotation.x = Math.PI / 2;
    w.position.set(wx, wy, 0.08);
    g.add(w);
  }
  g.add(bin, lidL, lidR);
  return g;
}
