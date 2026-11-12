import type { Settings } from '../../engine/save';
import { button, el } from '../dom';
import { ICONS } from '../icons';

type Tab = 'controls' | 'display' | 'audio';
type Toggle = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];
type Volume = 'musicVolume' | 'effectsVolume' | 'voiceVolume';

const TABS: [Tab, string][] = [
  ['controls', 'Controls'],
  ['display', 'Display'],
  ['audio', 'Audio'],
];

/** The switches of each tab. Labels only, no descriptions. */
const TOGGLES: Record<Tab, [Toggle, string][]> = {
  controls: [
    ['leftHanded', 'Left-handed'],
    ['steeringAssist', 'Steering assist'],
    ['autoSkid', 'Auto-skid (Fishtail)'],
    ['haptics', 'Haptics'],
  ],
  display: [
    ['minimap', 'Mini-map'],
    ['fullCameraShake', 'Full camera shake'],
    ['patternMarkings', 'Pattern markings'],
  ],
  audio: [
    ['tensionMusic', 'Tension music'],
    ['subtitles', 'Subtitles'],
  ],
};

const SLIDERS: [Volume, string][] = [
  ['musicVolume', 'Music'],
  ['effectsVolume', 'Effects'],
  ['voiceVolume', 'Crew voice'],
];

const LAYOUTS: [Settings['touchLayout'], string][] = [
  ['point', 'Point-to-drive'],
  ['classic', 'Classic'],
];

export interface SettingsHandlers {
  onBack: () => void;
  onChange: (changes: Partial<Settings>) => void;
}

/** Settings: control layout, assists, display options and audio. */
export class SettingsScreen {
  readonly root: HTMLElement;
  private readonly content: HTMLElement;
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'controls';
  private settings: Settings | undefined;

  constructor(private readonly handlers: SettingsHandlers) {
    this.content = el('div', { className: 'settings__content' });
    const side = el('div', {
      className: 'settings__side',
      children: [
        el('div', {
          className: 'settings__head',
          children: [
            button('Back', 'ghost', handlers.onBack, {
              className: 'cw-button--icon',
              html: ICONS.back,
            }),
            el('h1', { className: 'cw-display settings__title', text: 'Settings' }),
          ],
        }),
        el('div', { className: 'cw-label settings__section', text: 'Configure' }),
      ],
    });
    for (const [tab, label] of TABS) {
      const tabButton = el('button', {
        className: 'settings__tab',
        text: label,
        attributes: { type: 'button' },
        onClick: () => {
          this.tab = tab;
          this.render();
        },
      });
      this.tabButtons.set(tab, tabButton);
      side.append(tabButton);
    }
    this.root = el('section', {
      className: 'screen settings cw-backdrop',
      attributes: { 'aria-label': 'Settings' },
      children: [side, this.content],
    });
  }

  show(settings: Readonly<Settings>): void {
    this.settings = { ...settings };
    this.render();
    this.tabButtons.get(this.tab)?.focus({ preventScroll: true });
  }

  private change(changes: Partial<Settings>): void {
    if (!this.settings) {
      return;
    }
    this.settings = { ...this.settings, ...changes };
    this.handlers.onChange(changes);
  }

  private render(): void {
    const settings = this.settings;
    if (!settings) {
      return;
    }
    for (const [tab, tabButton] of this.tabButtons) {
      tabButton.setAttribute('aria-pressed', String(tab === this.tab));
    }
    const parts: HTMLElement[] = [];

    if (this.tab === 'controls') {
      const cards = LAYOUTS.map(([layout, name]) =>
        el('button', {
          className: 'settings__layout cw-card',
          attributes: { type: 'button', 'aria-pressed': String(settings.touchLayout === layout) },
          children: [el('span', { className: 'cw-display settings__layout-name', text: name })],
          onClick: () => {
            this.change({ touchLayout: layout });
            this.render();
          },
        }),
      );
      parts.push(
        el('div', {
          className: 'settings__group',
          children: [
            el('div', { className: 'cw-label', text: 'Touch layout' }),
            el('div', { className: 'settings__layouts', children: cards }),
          ],
        }),
      );
    }

    if (this.tab === 'audio') {
      parts.push(
        el('div', {
          className: 'settings__sliders',
          children: SLIDERS.map(([key, label]) => {
            const id = `volume-${key}`;
            const readout = el('div', {
              className: 'settings__readout',
              text: String(settings[key]),
            });
            const input = el('input', {
              attributes: { id, type: 'range', min: '0', max: '100', value: String(settings[key]) },
            });
            input.addEventListener('input', () => {
              readout.textContent = input.value;
              this.change({ [key]: Number(input.value) });
            });
            return el('div', {
              className: 'settings__slider',
              children: [el('label', { text: label, attributes: { for: id } }), input, readout],
            });
          }),
        }),
      );
    }

    parts.push(
      el('div', {
        className: 'settings__toggles',
        children: TOGGLES[this.tab].map(([key, label]) => {
          const control = el('button', {
            className: 'switch',
            attributes: {
              type: 'button',
              role: 'switch',
              'aria-checked': String(settings[key]),
              'aria-label': label,
            },
            children: [el('span', { className: 'switch__knob' })],
          });
          control.addEventListener('click', () => {
            const value = control.getAttribute('aria-checked') !== 'true';
            control.setAttribute('aria-checked', String(value));
            this.change({ [key]: value });
          });
          return el('div', {
            className: 'settings__toggle',
            children: [el('div', { className: 'settings__toggle-label', text: label }), control],
          });
        }),
      }),
    );
    this.content.replaceChildren(...parts);
  }
}
