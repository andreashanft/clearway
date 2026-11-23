import * as THREE from 'three/webgpu';
import type { App } from '../app';
import type { Button } from '../engine/input/input';
import { CAMERA_MODES } from '../game/camera';
import type { Game } from '../game/game';
import type { VehicleType } from '../game/level';
import { DEG } from '../game/math';
import { routePoint } from '../game/route';
import { formatTime } from '../game/scoring';
import type { VehicleSpec } from '../game/vehicles/specs';
import { measureHandling, type HandlingRow } from './measure';
import { DebugOverlay, type DebugControls } from './overlay';

/** Functions on `window.clearway` for testing from the browser console. */
export interface DebugApi {
  app: App;
  /** Runs the simulation for a span of game time and draws once. */
  advance(seconds: number): void;
  /**
   * Sets the scripted car controls.
   *
   * @param steer Steering wheel from -1 (left) to 1 (right).
   * @param throttle Pedals from -1 (brake, then reverse) to 1 (full throttle).
   */
  drive(steer: number, throttle: number): void;
  /** Presses a button once. */
  press(button: Button): void;
  /** Holds or releases the Action button and the handbrake. */
  hold(buttons: { action?: boolean; brake?: boolean }): void;
  /** Puts the player into another vehicle. */
  setVehicle(type: VehicleType): void;
  /** Returns the state of the player's vehicle. */
  vehicle(): Record<string, number | boolean | string>;
  /** Measures acceleration, braking, turning and the slalom of every vehicle in the yard. */
  measure(): HandlingRow[];
}

declare global {
  interface Window {
    clearway?: DebugApi;
  }
}

/** One slider of the handling panel: a value of the vehicle's tuning and its range. */
interface TuningSlider {
  key: keyof VehicleSpec;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Factor between the stored value and the value on the slider, for example m/s to km/h. */
  scale?: number;
}

const TUNING_SLIDERS: TuningSlider[] = [
  { key: 'topSpeed', label: 'Top speed km/h', min: 20, max: 240, step: 1, scale: 3.6 },
  { key: 'reverseSpeed', label: 'Reverse m/s', min: 2, max: 30, step: 0.5 },
  { key: 'acceleration', label: 'Acceleration', min: 4, max: 70, step: 1 },
  { key: 'braking', label: 'Braking', min: 10, max: 100, step: 1 },
  { key: 'coasting', label: 'Coasting', min: 0, max: 30, step: 0.5 },
  { key: 'turnRadius', label: 'Turn radius m', min: 0, max: 20, step: 0.5 },
  { key: 'pivotRate', label: 'Pivot rate', min: 0, max: 5, step: 0.1 },
  { key: 'cornering', label: 'Cornering', min: 5, max: 90, step: 1 },
  { key: 'steerSpeed', label: 'Steer speed', min: 1, max: 20, step: 0.5 },
  { key: 'turnResponse', label: 'Turn response', min: 2, max: 30, step: 1 },
  { key: 'grip', label: 'Grip', min: 2, max: 40, step: 1 },
];

/** Adds the debug overlay and the console API to a running app. */
export function installDebugTools(app: App): void {
  const overlay = new DebugOverlay(app.ui);
  const { render } = app;
  overlay.addStat({ label: 'Backend', read: () => render.backend });
  overlay.addStat({ label: 'FPS', read: () => app.frameStats.fps.toFixed(0) });
  overlay.addStat({ label: 'Frame', read: () => `${app.frameStats.frameMs.toFixed(1)} ms` });
  overlay.addStat({
    label: 'Draw calls',
    read: () => String(render.renderer.info.render.drawCalls),
  });
  overlay.addStat({
    label: 'Triangles',
    read: () => String(render.renderer.info.render.triangles),
  });
  overlay.addStat({ label: 'Bodies', read: () => String(app.game?.physics.bodyCount ?? 0) });
  overlay.addStat({ label: 'Scale', read: () => `${Math.round(render.scale * 100)} %` });
  overlay.addStat({
    label: 'Speed',
    read: () => `${((app.game?.activeVehicle.forwardSpeed ?? 0) * 3.6).toFixed(0)} km/h`,
  });
  overlay.addStat({
    label: 'Position',
    read: () => {
      const position = app.game?.activeVehicle.position;
      return position ? `${position.x.toFixed(0)}, ${position.z.toFixed(0)}` : '';
    },
  });
  overlay.addStat({ label: 'Debris', read: () => String(app.game?.debris.activeCount ?? 0) });
  overlay.addStat({
    label: 'Buildings',
    read: () =>
      app.game ? `${app.game.buildings.destroyedCount} / ${app.game.buildings.list.length}` : '',
  });
  overlay.addStat({
    label: 'Hauler',
    read: () => {
      const game = app.game;
      if (!game?.hauler) {
        return 'none';
      }
      const next = game.nextObstacle;
      const target = next
        ? `${next.obstacle.def.id} in ${formatTime(game.secondsToImpact)}`
        : 'clear';
      return `${game.hauler.distance.toFixed(0)} m, ${target}`;
    },
  });
  const { controls } = overlay;
  controls.addSlider('Time scale', { min: 0, max: 4, step: 0.05, value: 1 }, (value) => {
    app.stepper.timeScale = value;
  });

  // Switches that apply to the current area and to every area loaded later.
  const switches = { invincible: false, route: false, colliders: false };
  let routeLine: THREE.Object3D | undefined;
  let colliderLines: THREE.LineSegments | undefined;
  controls.addToggle('Invincible Hauler', false, (value) => {
    switches.invincible = value;
    if (app.game) {
      app.game.invincibleHauler = value;
    }
  });
  controls.addToggle('Route line', false, (value) => {
    switches.route = value;
    routeLine?.removeFromParent();
    routeLine = value && app.game ? createRouteLine(app.game) : undefined;
    if (routeLine) {
      app.game?.scene.add(routeLine);
    }
  });
  controls.addToggle('Colliders', false, (value) => {
    switches.colliders = value;
    if (!value) {
      colliderLines?.removeFromParent();
      colliderLines = undefined;
    }
  });
  controls.addButton('Measure handling', () => measureHandling(app));

  const handling = overlay.addPanel('Handling');
  addCameraPanel(overlay.addPanel('Chase camera'));

  const apply = (game: Game): void => {
    game.invincibleHauler = switches.invincible;
    routeLine = switches.route ? createRouteLine(game) : undefined;
    if (routeLine) {
      game.scene.add(routeLine);
    }
    colliderLines = undefined;
    buildHandlingPanel(handling, game.activeVehicle.spec);
    game.events.on('vehicleChanged', () => {
      buildHandlingPanel(handling, game.activeVehicle.spec);
    });
  };
  app.onGameLoaded(apply);
  if (app.game) {
    apply(app.game);
  }

  app.onFrame((frameSeconds) => {
    overlay.update(frameSeconds);
    const game = app.game;
    if (switches.colliders && game) {
      // Draw the wireframes that Rapier reports for every collider.
      const buffers = game.physics.world.debugRender();
      if (!colliderLines) {
        colliderLines = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: 0x3df5a0, depthTest: false }),
        );
        colliderLines.frustumCulled = false;
        game.scene.add(colliderLines);
      }
      colliderLines.geometry.dispose();
      colliderLines.geometry = new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.BufferAttribute(buffers.vertices, 3),
      );
    }
  });

  window.clearway = {
    app,
    advance: (seconds) => app.advance(seconds),
    drive: (steer, throttle) => {
      app.scripted.steer = steer;
      app.scripted.throttle = throttle;
    },
    press: (button) => app.scripted.press(button),
    hold: (buttons) => {
      app.scripted.action = buttons.action ?? app.scripted.action;
      app.scripted.brake = buttons.brake ?? app.scripted.brake;
    },
    setVehicle: (type) => app.setVehicle(type),
    measure: () => measureHandling(app),
    vehicle: (): Record<string, number | boolean | string> => {
      const vehicle = app.game?.activeVehicle;
      if (!vehicle) {
        return {};
      }
      return {
        type: vehicle.spec.type,
        x: Number(vehicle.position.x.toFixed(2)),
        y: Number(vehicle.position.y.toFixed(2)),
        z: Number(vehicle.position.z.toFixed(2)),
        heading: Number((vehicle.heading / DEG).toFixed(1)),
        speed: Number(vehicle.forwardSpeed.toFixed(2)),
        steering: Number(vehicle.steering.toFixed(2)),
        grounded: vehicle.grounded,
      };
    },
  };
}

/**
 * Fills the handling panel with one slider per tuning value of a vehicle. The sliders change
 * the shared tuning of that vehicle type, so a change applies at once and survives a reset of
 * the yard, but not a reload of the page.
 */
function buildHandlingPanel(panel: DebugControls, spec: VehicleSpec): void {
  panel.clear();
  const values = spec as unknown as Record<string, number>;
  for (const slider of TUNING_SLIDERS) {
    const scale = slider.scale ?? 1;
    panel.addSlider(
      slider.label,
      { min: slider.min, max: slider.max, step: slider.step, value: values[slider.key] * scale },
      (value) => {
        values[slider.key] = value / scale;
      },
    );
  }
  panel.addButton(`Copy ${spec.name} values`, () => {
    const text = JSON.stringify(
      Object.fromEntries(TUNING_SLIDERS.map(({ key }) => [key, Number(values[key].toFixed(3))])),
      undefined,
      2,
    );
    console.log(`${spec.type}: ${text}`);
    void navigator.clipboard?.writeText(`${spec.type}: ${text}`);
  });
}

/** Adds sliders for the chase view of the camera. */
function addCameraPanel(panel: DebugControls): void {
  const chase = CAMERA_MODES.chase;
  panel.addSlider(
    'Distance m',
    { min: 8, max: 50, step: 1, value: chase.distances[1] },
    (value) => {
      chase.distances = [value * 0.75, value, value * 1.4];
    },
  );
  panel.addSlider('Pitch °', { min: 8, max: 70, step: 1, value: chase.pitch / DEG }, (value) => {
    chase.pitch = value * DEG;
  });
  panel.addSlider(
    'Field of view °',
    { min: 30, max: 90, step: 1, value: chase.fovLandscape },
    (value) => {
      chase.fovPortrait += value - chase.fovLandscape;
      chase.fovLandscape = value;
    },
  );
  panel.addSlider(
    'Look ahead m',
    { min: 0, max: 20, step: 0.5, value: chase.leadMetres },
    (value) => {
      chase.leadMetres = value;
    },
  );
  panel.addSlider('Turn rate', { min: 1, max: 15, step: 0.5, value: chase.turnRate }, (value) => {
    chase.turnRate = value;
  });
}

/** Builds a red strip along the Hauler's line, with a post at each obstacle. */
function createRouteLine(game: Game): THREE.Object3D | undefined {
  const { route } = game;
  if (!route) {
    return undefined;
  }
  const group = new THREE.Group();
  group.name = 'debug-route';
  const material = new THREE.MeshBasicMaterial({ color: 0xff3d5a, toneMapped: false });
  const step = 6;
  const dash = new THREE.BoxGeometry(step * 0.6, 0.15, 0.6);
  for (let distance = 0; distance < route.length; distance += step) {
    const [x, z] = routePoint(route, distance);
    const mesh = new THREE.Mesh(dash, material);
    mesh.position.set(x, game.heightAt(x, z) + 0.3, z);
    mesh.rotation.y = -route.heading;
    group.add(mesh);
  }
  const post = new THREE.BoxGeometry(0.5, 14, 0.5);
  for (const obstacle of game.obstacles) {
    const [x, z] = routePoint(route, obstacle.def.distance);
    const mesh = new THREE.Mesh(post, material);
    mesh.position.set(x, game.heightAt(x, z) + 7, z);
    group.add(mesh);
  }
  return group;
}
