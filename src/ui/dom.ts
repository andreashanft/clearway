/** Options for {@link el}. */
interface ElementOptions {
  className?: string;
  text?: string;
  /** Trusted markup, for example an inline SVG icon from `icons.ts`. Never pass user input. */
  html?: string;
  attributes?: Record<string, string>;
  children?: (Node | undefined)[];
  onClick?: (event: MouseEvent) => void;
}

/** Creates a DOM element. It keeps the screen code short and free of string templates. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }
  if (options.html !== undefined) {
    element.innerHTML = options.html;
  }
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    element.setAttribute(name, value);
  }
  for (const child of options.children ?? []) {
    if (child) {
      element.append(child);
    }
  }
  const { onClick } = options;
  if (onClick) {
    element.addEventListener('click', (event) => onClick(event as MouseEvent));
  }
  return element;
}

/** Sets the text of an element only when it changed, to avoid needless layout work. */
export function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) {
    element.textContent = text;
  }
}

/** A button with the cut lower-right corner of the design system. */
export function button(
  label: string,
  variant: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet',
  onClick: () => void,
  options: { className?: string; ariaLabel?: string; html?: string } = {},
): HTMLButtonElement {
  const element = el('button', {
    className: `cw-button cw-button--${variant} ${options.className ?? ''}`.trim(),
    attributes: { type: 'button' },
    onClick,
  });
  if (options.html !== undefined) {
    element.innerHTML = options.html;
  } else {
    element.textContent = label;
  }
  element.setAttribute('aria-label', options.ariaLabel ?? label);
  return element;
}

/** A small dark chip with monospaced text, for times, counts and labels. */
export function tag(
  text: string,
  tone: 'plain' | 'go' | 'signal' | 'amber' | 'alarm' = 'plain',
): HTMLElement {
  return el('span', { className: `cw-tag cw-tag--${tone}`, text });
}
