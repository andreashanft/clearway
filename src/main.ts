import './ui/fonts';
import './ui/tokens.css';
import './ui/base.css';

import { DebugOverlay, isDebugRequested } from './debug/overlay';
import { FixedStepper, FrameStats } from './engine/loop';
import { PhysicsWorld, initPhysics } from './engine/physics';
import { RenderContext } from './engine/renderer';
import { createSandbox } from './game/sandbox';

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

  const [render] = await Promise.all([
    RenderContext.create(canvas, { forceWebGL: params.has('webgl') }),
    initPhysics(),
    document.fonts.ready,
  ]);

  const physics = new PhysicsWorld();
  const sandbox = createSandbox(physics);
  render.onResize((width, height) => sandbox.resize(width / height));

  const stepper = new FixedStepper();
  const frameStats = new FrameStats();

  let debug: DebugOverlay | undefined;
  if (isDebugRequested()) {
    debug = new DebugOverlay(ui);
    debug.addStat({ label: 'Backend', read: () => render.backend });
    debug.addStat({ label: 'FPS', read: () => frameStats.fps.toFixed(0) });
    debug.addStat({ label: 'Frame', read: () => `${frameStats.frameMs.toFixed(1)} ms` });
    debug.addStat({
      label: 'Draw calls',
      read: () => String(render.renderer.info.render.drawCalls),
    });
    debug.addStat({
      label: 'Triangles',
      read: () => String(render.renderer.info.render.triangles),
    });
    debug.addStat({ label: 'Bodies', read: () => String(physics.bodyCount) });
    debug.addStat({ label: 'Scale', read: () => `${Math.round(render.scale * 100)} %` });
    debug.addSlider('Time scale', { min: 0, max: 2, step: 0.05, value: 1 }, (value) => {
      stepper.timeScale = value;
    });
  }

  // The loop and the audio pause while the page is hidden.
  document.addEventListener('visibilitychange', () => {
    stepper.paused = document.hidden;
  });

  let lastTime = performance.now();
  await render.renderer.setAnimationLoop((time) => {
    const frameSeconds = (time - lastTime) / 1000;
    lastTime = time;
    frameStats.sample(frameSeconds);

    const alpha = stepper.advance(frameSeconds, (dt) => {
      sandbox.step(dt);
      physics.step();
    });
    sandbox.sync(alpha);
    render.renderer.render(sandbox.scene, sandbox.camera);
    debug?.update(frameSeconds);
  });

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
