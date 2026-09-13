# Fly Parking Lab · NeuroMechFly v2 × MaleCNS

In-browser 3D bio-robotic simulation featuring **Carla**, a fruit fly (_Drosophila melanogaster_) that drives a classic Mini Cooper using the official **NeuroMechFly v2** biomechanical model coupled to the **MaleCNS** neural connectome and the **MuJoCo** rigid-body physics engine executed via WebAssembly.

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev
```

Open your browser at [http://localhost:5173/](http://localhost:5173/).

---

## Interface Architecture

The experience is divided into a primary driving arena and a synchronized sidebar for telemetry and biomechanical inspection:

### 1. Urban Road Driving Arena (Left Panel — 68%)

- **Vehicle:** Classic Mini Cooper (British Racing Green with white roof) driven by **Carla** from the cockpit.
- **In-Sim HUD Overlays:**
  - Mission identifier with pilot prefix (`Carla | mission_name`).
  - Real-time transmission status (`FORWARD`, `REVERSE`, `PUSHING`).
  - Digital speedometer in `km/h`.
  - Episode counter and elapsed time (`Attempt X · Y.Ys elapsed`).
- **3D Vision Sensors (Lidar / MaleCNS Optical System):**
  - 5 raycasting sensors scanning angles ($[-60^\circ, -30^\circ, 0^\circ, +30^\circ, +60^\circ]$) up to 3.8m.
  - Proximity color coding (cyan = clear, amber = alert, red = danger).
  - Proximity inputs feed descending optical neurons in the connectome (`visual_left`, `visual_right`).

### 2. Synchronized Sidebar (Right Panel — 32%)

- **Carla's Brain (3D MaleCNS Connectome — Top):**
  - Interactive 3D visualization of the cephalic and thoracic neural network.
  - Learning metrics: current attempt, cumulative reward, and synaptic plasticity state.
  - Real-time sparkline graph of the historical reward curve.
  - **Domain Randomization** toggle to evaluate policy generalization under stochastic perturbations.
  - **⚡ Burst Mode** button for headless background simulation without rendering overhead.
- **Cockpit View (Wheel · Pedals · Gear — Bottom):**
  - Elevated 3/4 lateral-frontal perspective showing Carla's entire body (head, compound eyes, thorax, wings, abdomen, and legs).
  - **Upright Steering Wheel:** Gripped by Carla's forelegs, rotating with sub-millimeter precision.
  - **Reactive Racing Pedals:** Lower pedals (red for brake, green for throttle) with mechanical compression, dynamic `pedalLight`, and leg flexion.
  - **Gear Indicator:** Transmission selector (`D` / `R`).

### 3. Lower Telemetry Bar

- Forced manual steering buttons (`Request left` / `Request right`).
- Angular offset toward current waypoint (`Target °`).
- Throttle percentage (`Gas %`) and brake percentage (`Brake %`).
- Steering wheel angle (`Wheel °`) and steer command (`Steer`).

---

## Realistic Urban Mission Catalog

Switch between 6 urban road missions using the topbar selector:

1. **Parallel Parking (`parallel parking`):** Wide avenue maneuver to dock into a curb-side slot between two parked cars.
2. **Perpendicular Parking (`perpendicular parking`):** Commercial lot maneuver pulling into a 90° bay between a pickup and a hatchback.
3. **Roadworks Slalom (`roadworks slalom`):** Roadway with traffic cones to smoothly slalom through caution markers.
4. **Alley Loading (`alley loading`):** Evade a delivery van and dumpsters to dock securely into the loading bay.
5. **Urban Roundabout (`urban roundabout`):** Continuous navigation through a roundabout ring with a central landscaped island and technical exit.
6. **T-Junction Maneuver (`t-junction maneuver`):** Technical intersection negotiating cross-traffic with a north detour and return parking bay.

---

## Vehicle Physics and Ackermann Kinematics

Vehicle movement strictly follows the **non-holonomic bicycle model**:

1. **Pure longitudinal traction:**
   $$ds = \Delta x \cos(\theta) + \Delta y \sin(\theta)$$
   Zero lateral slipping (no sideways diagonal movement or "crabbing").
2. **Static rotation lock:**
   $$d\theta = \frac{ds}{L} \tan(\delta) \quad \text{with } L = 1.45\text{ m}$$
   If the car is stationary ($ds = 0$), chassis yaw cannot rotate ($d\theta \equiv 0$). Front wheels pivot with the steering wheel, but the chassis remains anchored.
3. **Circular arc integration:**
   Position updates across the midpoint arc angle ($x \mathrel{+}= ds \cos(\theta_{mid})$, $y \mathrel{+}= ds \sin(\theta_{mid})$), preventing jerkiness through tight curves.

---

## Integrity Guards and Verification

The project includes strict invariant audits to guard against physics, camera, or UI regressions:

```bash
# Run unit test suite and integrity invariant audit
npm test

# Run code and physics integrity checks directly
node scripts/check-integrity.mjs

# Production build verification
npm run build
```

---

## Manual Controls

Toggle between autonomy and manual keyboard control with the `Autopilot: ON/OFF` button:

- `W`: Accelerate / Drive forward
- `S`: Reverse / Brake
- `A`: Steer left
- `D`: Steer right
- `Q`: Emergency stop / Brake
- `Space`: Restart current attempt / Pause
- `+` / `-` / `t`: Increase, decrease, or cycle simulation speed (1× Normal, 4× Fast, 8× Turbo)

---

## License and Provenance

- Built on the official **NeuroMechFly v2** biomechanical models and **MaleCNS v1.0** connectome reconstructions.
- NeuroMechFly license available in `public/nmf/LICENSE-NeuroMechFly.txt`.
