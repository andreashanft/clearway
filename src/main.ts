import './ui/fonts.css';
import './ui/tokens.css';
import './ui/base.css';
import { registerSW } from 'virtual:pwa-register';
import { DebugOverlay } from './debug/overlay';
import { parseFlags } from './engine/flags';
import { GameLoop } from './engine/loop';
import { loadRapier, Physics } from './engine/physics';
import { Renderer } from './engine/renderer';
import { Sandbox } from './game/sandbox';

async function boot(): Promise<void> {
  const flags = parseFlags(window.location.search);
  const canvas = requireElement('#scene', HTMLCanvasElement);
  const ui = requireElement('#ui', HTMLElement);

  const [renderer, rapier] = await Promise.all([
    Renderer.create({ canvas, forceWebGL: flags.forceWebGL }),
    loadRapier(),
  ]);
  const physics = new Physics(rapier);
  const sandbox = new Sandbox(physics);
  renderer.onResize((viewport) => sandbox.setViewport(viewport));

  let overlay: DebugOverlay | null = null;
  const loop = new GameLoop({
    step(dt) {
      sandbox.step(dt);
      physics.step(dt);
      sandbox.afterStep();
    },
    render(alpha, frameSeconds) {
      sandbox.render(alpha);
      renderer.render(sandbox.scene, sandbox.camera);
      overlay?.update(frameSeconds);
    },
  });

  if (flags.debug) {
    overlay = new DebugOverlay(ui, { renderer, physics, clock: loop.clock });
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
