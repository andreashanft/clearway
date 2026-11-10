/** Tracks which keys are down (by physical `KeyboardEvent.code`) and which went down this frame. */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  /** True once any key has been pressed since the last `endFrame()`. */
  active = false;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  isDown(...codes: string[]): boolean {
    return codes.some((code) => this.down.has(code));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  /** Clears the one-frame pressed set. */
  endFrame(): void {
    this.pressed.clear();
    this.active = false;
  }

  /** Forgets presses nobody has read yet, such as keys used in a menu. Held keys stay held. */
  clearPressed(): void {
    this.pressed.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (!event.repeat) this.pressed.add(event.code);
    this.down.add(event.code);
    this.active = true;
    if (GAME_KEYS.has(event.code)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.down.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };
}

/** Keys whose browser default (scrolling, focus moves) would interfere with play. */
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
