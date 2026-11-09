import './ui/fonts.css';
import './ui/tokens.css';
import './ui/base.css';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import { parseFlags } from './engine/flags';
import { loadRapier } from './engine/physics';
import { Renderer } from './engine/renderer';

async function boot(): Promise<void> {
  const flags = parseFlags(window.location.search);
  const canvas = requireElement('#scene', HTMLCanvasElement);
  const ui = requireElement('#ui', HTMLElement);

  const [renderer, rapier] = await Promise.all([
    Renderer.create({ canvas, forceWebGL: flags.forceWebGL }),
    loadRapier(),
  ]);
  const app = new App(renderer, rapier, ui, flags);
  await app.boot();
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
