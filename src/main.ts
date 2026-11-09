import './ui/fonts.css';
import './ui/tokens.css';
import './ui/base.css';
import { registerSW } from 'virtual:pwa-register';
import { DebugOverlay } from './debug/overlay';
import { EventBus } from './engine/events';
import { parseFlags } from './engine/flags';
import { InputManager } from './engine/input/input-manager';
import { GameLoop } from './engine/loop';
import { loadRapier, Physics } from './engine/physics';
import { Renderer } from './engine/renderer';
import type { GameEvents } from './game/events';
import { Game } from './game/game';
import { findLevel, LEVELS } from './game/level-data';
import { CameraGestures } from './ui/touch-controls/camera-gestures';
import { TouchControls } from './ui/touch-controls/touch-controls';

async function boot(): Promise<void> {
  const flags = parseFlags(window.location.search);
  const canvas = requireElement('#scene', HTMLCanvasElement);
  const ui = requireElement('#ui', HTMLElement);

  const [renderer, rapier] = await Promise.all([
    Renderer.create({ canvas, forceWebGL: flags.forceWebGL }),
    loadRapier(),
  ]);
  const physics = new Physics(rapier);
  const bus = new EventBus<GameEvents>();
  const input = new InputManager(canvas);
  const touchControls = new TouchControls(ui, input.touch, bus);
  new CameraGestures(canvas, input.touch);
  input.onSourceChange((source) => {
    touchControls.setVisible(source === 'touch');
  });

  const level = (flags.level ? findLevel(flags.level) : undefined) ?? LEVELS[0];
  if (!level) throw new Error('No levels found');
  const game = new Game(physics, input, bus);
  await game.load(level);
  renderer.onResize((viewport) => {
    game.setViewport(viewport);
  });

  let overlay: DebugOverlay | null = null;
  const loop = new GameLoop({
    beginFrame() {
      game.beginFrame();
    },
    step(dt) {
      game.step(dt);
      physics.step(dt);
      game.afterStep();
    },
    render(alpha, frameSeconds) {
      game.render(alpha, frameSeconds);
      renderer.render(game.scene, game.camera.camera);
      overlay?.update(frameSeconds);
    },
  });

  if (flags.debug) {
    // Handy for poking at the game from the browser console.
    Object.assign(window, { clearway: { game, physics, renderer, input, loop } });
    overlay = new DebugOverlay(ui, { renderer, physics, clock: loop.clock });
    overlay.addReadout(() => {
      const v = game.activeVehicle;
      if (!v) return '';
      const kmh = (v.forwardSpeed * 3.6).toFixed(0).padStart(4);
      return `VEHICLE ${v.spec.name} ${kmh} km/h  steer ${v.drive.steer.toFixed(2)}  throttle ${v.drive.throttle.toFixed(2)}`;
    });
  }

  loop.start();
  console.info(
    `Clearway booted on ${renderer.backend.toUpperCase()} in ${Math.round(performance.now())} ms`,
  );
}

function requireElement<T extends Element>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`Missing element ${selector}`);
  return el;
}

function showBootError(error: unknown): void {
  console.error(error);
  const panel = document.createElement('div');
  panel.className = 'cw-boot-error';
  panel.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = "Clearway can't start";
  const message = document.createElement('p');
  message.textContent =
    'This browser could not start the 3D renderer. Try a current version of Safari, Chrome, Edge or Firefox.';
  panel.append(title, message);
  document.body.append(panel);
}

registerSW({ immediate: true });
boot().catch(showBootError);
