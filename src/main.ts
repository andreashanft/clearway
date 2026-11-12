import './ui/fonts';
import './ui/tokens.css';
import './ui/base.css';
import './ui/components.css';

import { App } from './app';
import { isDebugRequested } from './debug/overlay';
import { initPhysics } from './engine/physics';
import { EndOverlay } from './ui/screens/end-overlay';

/** Returns a required element of the page shell. */
function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`The page is missing the #${id} element.`);
  }
  return element as T;
}

async function boot(): Promise<void> {
  const canvas = requireElement<HTMLCanvasElement>('scene');
  const ui = requireElement('ui');
  const params = new URLSearchParams(window.location.search);

  const [app] = await Promise.all([
    App.start(canvas, ui, { forceWebGL: params.has('webgl') }),
    initPhysics(),
    document.fonts.ready,
  ]);
  if (params.has('touch')) {
    app.touch.forceShow();
  }
  if (isDebugRequested()) {
    const { installDebugTools } = await import('./debug/tools');
    installDebugTools(app);
  }
  const levelId = params.get('level') ?? undefined;
  const startLevel = async (): Promise<void> => {
    const game = await app.loadLevel(levelId);
    game.start();
  };
  const overlay = new EndOverlay(ui, () => void startLevel());
  app.onGameLoaded((game) => overlay.attach(game));
  await startLevel();

  requireElement('boot').classList.add('is-done');
}

boot().catch((error: unknown) => {
  console.error(error);
  const boot = document.getElementById('boot');
  if (boot) {
    const message = document.createElement('div');
    message.className = 'boot__error';
    message.textContent = `Clearway could not start. ${error instanceof Error ? error.message : String(error)}`;
    boot.append(message);
  }
});
