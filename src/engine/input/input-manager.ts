import { type ControlFrame, IDLE_FRAME, type InputSource, shapeStick } from './controls';
import { Gamepads, PAD, type PadSnapshot } from './gamepad';
import { Keyboard } from './keyboard';
import { TouchState } from './touch-state';

const STICK_DEAD_ZONE = 0.18;
const TRIGGER_DEAD_ZONE = 0.08;

/** Merges keyboard, mouse wheel, gamepad and touch input into one `ControlFrame` per frame. */
export class InputManager {
  readonly keyboard: Keyboard;
  readonly gamepads = new Gamepads();
  readonly touch = new TouchState();
  private wheelSteps = 0;
  private lastSource: InputSource;
  private sourceListeners = new Set<(source: InputSource) => void>();

  constructor(private readonly wheelTarget: HTMLElement) {
    this.keyboard = new Keyboard();
    this.lastSource = matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    wheelTarget.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointerdown', this.onPointerDown);
  }

  get source(): InputSource {
    return this.lastSource;
  }

  /** Calls `listener` whenever the most recent input device changes. */
  onSourceChange(listener: (source: InputSource) => void): () => void {
    this.sourceListeners.add(listener);
    listener(this.lastSource);
    return () => this.sourceListeners.delete(listener);
  }

  /** Reads all devices. Call exactly once per rendered frame. */
  poll(): ControlFrame {
    const kb = this.keyboard;
    const pad = this.gamepads.poll();
    const touchEdges = this.touch.takeEdges();

    if (this.touch.active) this.setSource('touch');
    else if (kb.active) this.setSource('keyboard');
    else if (this.gamepads.active) this.setSource('gamepad');
    this.touch.active = false;

    // Point-to-drive stick: touch first, then the gamepad's left stick when no trigger is held.
    let stickX = this.touch.stickX;
    let stickY = this.touch.stickY;
    let steer = this.touch.steer;
    let throttle = this.touch.gas - this.touch.reverse;
    if (pad) {
      const usingTriggers =
        pad.rightTrigger > TRIGGER_DEAD_ZONE || pad.leftTrigger > TRIGGER_DEAD_ZONE;
      const stick = shapeStick(pad.leftX, pad.leftY, STICK_DEAD_ZONE);
      if (usingTriggers) {
        steer += stick.x;
        throttle += pad.rightTrigger - pad.leftTrigger;
      } else if (stick.x !== 0 || stick.y !== 0) {
        stickX = stick.x;
        stickY = -stick.y;
      }
    }

    // Keyboard drives with classic controls.
    const kbSteer =
      (kb.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (kb.isDown('KeyA', 'ArrowLeft') ? 1 : 0);
    const kbThrottle =
      (kb.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (kb.isDown('KeyS', 'ArrowDown') ? 1 : 0);
    steer = clampUnit(steer + kbSteer);
    throttle = clampUnit(throttle + kbThrottle);

    const cameraTurn = pickEdge(
      touchEdges.cameraTurn,
      kb.wasPressed('KeyQ') ? -1 : kb.wasPressed('KeyR') ? 1 : 0,
      padEdge(pad, PAD.leftBumper, PAD.rightBumper),
    );
    let wheelStep: -1 | 0 | 1 = 0;
    if (this.wheelSteps !== 0) {
      wheelStep = this.wheelSteps < 0 ? -1 : 1;
      this.wheelSteps = 0;
    }
    const zoomStep = pickEdge(
      touchEdges.zoomStep,
      kb.wasPressed('KeyZ') ? -1 : kb.wasPressed('KeyX') ? 1 : wheelStep,
      padEdge(pad, PAD.dpadUp, PAD.dpadDown),
    );

    const frame: ControlFrame = {
      stickX,
      stickY,
      steer,
      throttle,
      brake:
        this.touch.brake || kb.isDown('ShiftLeft', 'ShiftRight') || (pad?.isDown(PAD.b) ?? false),
      action: this.touch.action || kb.isDown('Space') || (pad?.isDown(PAD.a) ?? false),
      actionPressed:
        touchEdges.actionPressed || kb.wasPressed('Space') || (pad?.wasPressed(PAD.a) ?? false),
      enterExitPressed:
        touchEdges.enterExitPressed || kb.wasPressed('KeyE') || (pad?.wasPressed(PAD.y) ?? false),
      cameraTurn,
      zoomStep,
      pausePressed:
        touchEdges.pausePressed ||
        kb.wasPressed('Escape', 'KeyP') ||
        (pad?.wasPressed(PAD.start) ?? false),
      source: this.lastSource,
    };
    kb.endFrame();
    return frame;
  }

  /** Forgets held inputs, for example when a menu opens over the game. */
  reset(): void {
    this.touch.reset();
    this.wheelSteps = 0;
    this.keyboard.clearPressed();
  }

  dispose(): void {
    this.keyboard.dispose();
    this.wheelTarget.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerdown', this.onPointerDown);
    this.sourceListeners.clear();
  }

  private setSource(source: InputSource): void {
    if (source === this.lastSource) return;
    this.lastSource = source;
    for (const listener of this.sourceListeners) listener(source);
  }

  /** Any finger on the screen brings up the touch controls, on hybrid devices too. */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') this.touch.active = true;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (Math.abs(event.deltaY) < 4) return;
    this.wheelSteps += event.deltaY > 0 ? 1 : -1;
    this.setSource('keyboard');
  };
}

export { IDLE_FRAME };

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function pickEdge(...values: (-1 | 0 | 1)[]): -1 | 0 | 1 {
  return values.find((v) => v !== 0) ?? 0;
}

function padEdge(pad: PadSnapshot | null, negative: number, positive: number): -1 | 0 | 1 {
  if (!pad) return 0;
  if (pad.wasPressed(negative)) return -1;
  if (pad.wasPressed(positive)) return 1;
  return 0;
}
