/** How long the screen takes to fade out; matches the transition in `index.html`. */
const FADE_MS = 220;

/** Reports how far a load is: a fraction from 0 to 1 and what is happening. */
export type LoadProgress = (fraction: number, label: string, seconds?: number) => void;

/**
 * The loading screen. Its markup and styles live in `index.html`, so it is on screen
 * before any script runs; this class takes it over for the rest of the boot and shows it
 * again for each level load.
 */
export class LoadingScreen {
  private readonly eyebrow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private hideTimer = 0;

  constructor(private readonly element: HTMLElement) {
    this.eyebrow = part(element, 'eyebrow');
    this.title = part(element, 'title');
    this.fill = part(element, 'fill');
    this.label = part(element, 'label');
  }

  /** Finds the loading screen that `index.html` put on the page. */
  static adopt(): LoadingScreen {
    const element = document.getElementById('loading');
    if (!element) throw new Error('Missing element #loading');
    return new LoadingScreen(element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  /**
   * Shows the screen for a level load. It takes taps at once, so nothing below can be
   * pressed twice, but it only fades in after a moment: a quick load never shows it.
   */
  show(eyebrow: string, title: string): void {
    window.clearTimeout(this.hideTimer);
    this.eyebrow.textContent = eyebrow;
    this.title.textContent = title;
    this.setFill(0.04, 0);
    this.label.textContent = '';
    this.element.classList.remove('is-leaving');
    this.element.classList.add('is-quiet');
    this.element.hidden = false;
  }

  /**
   * Moves the bar to `fraction` and names the step. With `seconds`, the bar creeps there
   * over that time, for a step that reports nothing while it runs.
   */
  readonly progress: LoadProgress = (fraction, label, seconds = 0.3) => {
    this.setFill(fraction, seconds);
    this.label.textContent = label;
  };

  /** Fades the screen out and takes it off the page. */
  hide(): void {
    if (this.element.hidden) return;
    this.setFill(1, 0.15);
    this.element.classList.add('is-leaving');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.element.hidden = true;
      this.element.classList.remove('is-leaving', 'is-quiet');
    }, FADE_MS);
  }

  private setFill(fraction: number, seconds: number): void {
    this.fill.style.transitionDuration = `${Math.round(seconds * 1000)}ms`;
    const shown = Math.min(1, Math.max(0.04, fraction));
    this.fill.style.transform = `translateX(${((shown - 1) * 100).toFixed(1)}%)`;
  }
}

function part(root: HTMLElement, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`.cw-loading__${name}`);
  if (!element) throw new Error(`Missing loading screen part ${name}`);
  return element;
}

/**
 * Resolves once the browser has painted, so a freshly shown screen is really visible. A
 * hidden page paints nothing, so a short timer stands in for the frame there.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 120);
    requestAnimationFrame(() => {
      window.clearTimeout(timer);
      window.setTimeout(resolve, 0);
    });
  });
}
