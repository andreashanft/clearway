import type { App } from '../app';
import type { Button } from '../engine/input/input';
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
  overlay.addSlider('Time scale', { min: 0, max: 2, step: 0.05, value: 1 }, (value) => {
    app.stepper.timeScale = value;
  });
  app.onFrame((frameSeconds) => overlay.update(frameSeconds));

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
