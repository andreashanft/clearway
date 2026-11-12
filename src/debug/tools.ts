import * as THREE from 'three/webgpu';
import type { App } from '../app';
import type { Game } from '../game/game';
import { LEVELS } from '../game/levels';
import { routePoint } from '../game/route';
import { formatTime } from '../game/scoring';
import type { Button } from '../engine/input/input';
import { measureArrivals, type ArrivalRow } from './autoplay';
import { DebugOverlay } from './overlay';

/** Functions on `window.clearway` for testing from the browser console. */
export interface DebugApi {
  app: App;
  /** Runs the simulation for a span of game time and draws once. */
  advance(seconds: number): void;
  /** Points the scripted stick. X points right and Y points up on the screen. */
  drive(x: number, y: number): void;
  /** Presses a button once. */
  press(button: Button): void;
  /** Holds or releases the Action and Brake buttons. */
  hold(buttons: { action?: boolean; brake?: boolean }): void;
  /** Returns the state of the active vehicle. */
  vehicle(): Record<string, number | boolean | string>;
  /** Runs the level with an invincible Hauler and reports when it reaches each obstacle. */
  arrivals(): ArrivalRow[];
}

declare global {
  interface Window {
    clearway?: DebugApi;
  }
}

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
      if (!game) {
        return '';
      }
      const next = game.nextObstacle;
      const target = next
        ? `${next.obstacle.def.id} in ${formatTime(game.secondsToImpact)}`
        : 'clear';
      return `${game.hauler.distance.toFixed(0)} m, ${target}`;
    },
  });
  overlay.addSlider('Time scale', { min: 0, max: 4, step: 0.05, value: 1 }, (value) => {
    app.stepper.timeScale = value;
  });

  // Switches that apply to the current level and to every level loaded later.
  const switches = { invincible: false, route: false, colliders: false };
  let routeLine: THREE.Object3D | undefined;
  let colliderLines: THREE.LineSegments | undefined;
  const apply = (game: Game): void => {
    game.invincibleHauler = switches.invincible;
    routeLine = switches.route ? createRouteLine(game) : undefined;
    if (routeLine) {
      game.scene.add(routeLine);
    }
    colliderLines = undefined;
  };
  overlay.addToggle('Invincible Hauler', false, (value) => {
    switches.invincible = value;
    if (app.game) {
      app.game.invincibleHauler = value;
    }
  });
  overlay.addToggle('Route line', false, (value) => {
    switches.route = value;
    routeLine?.removeFromParent();
    routeLine = value && app.game ? createRouteLine(app.game) : undefined;
    if (routeLine) {
      app.game?.scene.add(routeLine);
    }
  });
  overlay.addToggle('Colliders', false, (value) => {
    switches.colliders = value;
    if (!value) {
      colliderLines?.removeFromParent();
      colliderLines = undefined;
    }
  });
  overlay.addButton('Measure arrivals', () => measureArrivals(app));
  overlay.addSelect(
    'Level',
    LEVELS.map((level) => ({ value: level.id, label: `${level.index} ${level.name}` })),
    new URLSearchParams(window.location.search).get('level') ?? LEVELS[0].id,
    (id) => {
      const url = new URL(window.location.href);
      url.searchParams.set('level', id);
      window.location.href = url.toString();
    },
  );
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
    drive: (x, y) => {
      app.scripted.pointX = x;
      app.scripted.pointY = y;
    },
    press: (button) => app.scripted.press(button),
    hold: (buttons) => {
      app.scripted.action = buttons.action ?? app.scripted.action;
      app.scripted.brake = buttons.brake ?? app.scripted.brake;
    },
    arrivals: () => measureArrivals(app),
    vehicle: (): Record<string, number | boolean | string> => {
      const vehicle = app.game?.activeVehicle;
      if (!vehicle) {
        return {};
      }
      return {
        id: vehicle.id,
        x: Number(vehicle.position.x.toFixed(2)),
        y: Number(vehicle.position.y.toFixed(2)),
        z: Number(vehicle.position.z.toFixed(2)),
        heading: Number(((vehicle.heading * 180) / Math.PI).toFixed(1)),
        speed: Number(vehicle.forwardSpeed.toFixed(2)),
        grounded: vehicle.grounded,
        charge: Number(vehicle.actionCharge.toFixed(2)),
      };
    },
  };
}

/** Builds a red strip along the Hauler's line, with a post at each obstacle. */
function createRouteLine(game: Game): THREE.Object3D {
  const group = new THREE.Group();
  group.name = 'debug-route';
  const material = new THREE.MeshBasicMaterial({ color: 0xff3d5a, toneMapped: false });
  const { route } = game;
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
