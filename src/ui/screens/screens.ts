import './screens.css';
import type { InputSource } from '../../engine/input/controls';
import type { CampaignLevel } from '../../game/campaign';
import { formatScore } from '../../game/points';
import type { LevelRecord, Settings } from '../../game/progress';
import { type LevelStats, type Medal, shortfallFor } from '../../game/scoring';
import { button, chip, formatClock, h, icon, slider, stat, toggle } from '../kit';

const MEDAL_LETTER: Record<Medal, string> = { bronze: 'B', silver: 'S', gold: 'G' };

/** A mounted screen; `update` refreshes live values (optional). */
export interface Screen {
  readonly element: HTMLElement;
  update?: () => void;
}

function svgFrom(markup: string, viewBox: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}

function medalBadge(medal: Medal | null, className = ''): HTMLElement {
  return h('div', {
    class: `cw-medal cw-medal--${medal ?? 'none'} ${className}`,
    text: medal ? MEDAL_LETTER[medal] : '',
    attrs: { role: 'img', 'aria-label': medal ? `${medal} medal` : 'No medal' },
  });
}

/* Title ----------------------------------------------------------------- */

export interface TitleActions {
  play: () => void;
  settings: () => void;
  howToPlay: () => void;
}

export function titleScreen(
  info: { version: string; levels: number; cleared: number },
  actions: TitleActions,
): Screen {
  const element = h(
    'section',
    { class: 'cw-screen cw-title', attrs: { 'aria-label': 'Title' } },
    h(
      'div',
      { class: 'cw-title__main' },
      h(
        'div',
        { class: 'cw-title__tags' },
        chip(`PROTOTYPE v${info.version}`),
        chip(`${info.levels} LEVELS`, 'hazard'),
      ),
      h('h1', { class: 'cw-hero' }, 'Clear', h('br'), 'the ', h('em', { text: 'path.' })),
      h(
        'div',
        { class: 'cw-title__actions' },
        button('PLAY', 'primary', actions.play),
        button('Settings', 'ghost', actions.settings),
        button('How to play', 'ghost', actions.howToPlay),
      ),
    ),
    h(
      'div',
      { class: 'cw-title__counters' },
      stat('CLEARED', `${info.cleared} / ${info.levels}`, 'hazard'),
    ),
  );
  return { element };
}

/* Campaign --------------------------------------------------------------- */

export interface CampaignEntryView {
  readonly level: CampaignLevel;
  readonly record: LevelRecord | undefined;
  readonly unlocked: boolean;
  readonly available: boolean;
  readonly isNext: boolean;
  readonly unlockHint: string;
}

export function campaignScreen(
  entries: readonly CampaignEntryView[],
  totals: { medals: number; maxMedals: number; cleared: number },
  actions: { back: () => void; start: (id: string) => void },
): Screen {
  const cards = entries.map((entry) => {
    const { level, record } = entry;
    const state = !entry.unlocked || !entry.available ? 'locked' : entry.isNext ? 'next' : 'open';
    const art = h('div', { class: 'cw-level-card__art' }, svgFrom(level.thumbnail, '0 0 400 300'));
    art.append(
      h('span', { class: 'cw-chip cw-level-card__time' }, `⏱ ${formatClock(level.routeSeconds)}`),
    );
    if (state === 'locked') {
      art.append(h('div', { class: 'cw-level-card__lock' }, h('span', {}, icon('lock', 20))));
    } else if (record?.medal) {
      art.append(medalBadge(record.medal, 'cw-medal-pip cw-level-card__badge'));
    } else if (entry.isNext) {
      art.append(h('span', { class: 'cw-level-card__badge' }, chip('NEXT UP', 'blue')));
    }

    const actionsRow = h('div', { class: 'cw-level-card__actions' });
    if (state === 'locked') {
      actionsRow.append(h('div', { class: 'cw-level-card__note', text: entry.unlockHint }));
    } else if (record?.medal) {
      if (record.bestTime !== null)
        actionsRow.append(chip(`BEST ${formatClock(record.bestTime)}`, 'hazard'));
      if (record.bestScore) actionsRow.append(chip(`${formatScore(record.bestScore)} PTS`));
      actionsRow.append(
        button('Replay', 'ghost', () => actions.start(level.id), { size: 'small' }),
      );
    } else {
      actionsRow.append(
        button('START', 'primary', () => actions.start(level.id), { size: 'small' }),
      );
    }

    return h(
      'article',
      {
        class: 'cw-card cw-level-card',
        data: { state },
        attrs: { 'aria-label': `Level ${level.index}: ${level.name}` },
      },
      art,
      h(
        'div',
        { class: 'cw-level-card__body' },
        h('div', {
          class: 'cw-label',
          text: `LEVEL ${String(level.index).padStart(2, '0')} · ${level.tag}`,
        }),
        h('div', { class: 'cw-level-card__name', text: level.name }),
        h('div', { class: 'cw-level-card__tagline', text: level.tagline }),
        actionsRow,
      ),
    );
  });

  const element = h(
    'section',
    { class: 'cw-screen cw-screen--solid cw-campaign', attrs: { 'aria-label': 'Campaign' } },
    h(
      'div',
      { class: 'cw-screen__head' },
      button('', 'ghost', actions.back, {
        icon: icon('back'),
        ariaLabel: 'Back to title',
        class: 'cw-back',
      }),
      h(
        'div',
        {},
        h('h1', { class: 'cw-heading', text: 'Campaign' }),
        h('p', {
          class: 'cw-body',
          text: "Three routes. One Hauler. Don't let it touch anything.",
          style: { 'font-size': '12px', color: 'var(--cw-muted)' },
        }),
      ),
      h(
        'div',
        { class: 'cw-screen__head-side' },
        chip(`MEDALS ${totals.medals}/${totals.maxMedals}`),
        chip(`CLEARED ${totals.cleared}/${entries.length}`),
      ),
    ),
    h('div', { class: 'cw-campaign__grid' }, ...cards),
  );
  return { element };
}

/* 3-2-1 countdown -------------------------------------------------------- */

export function countdownScreen(): Screen & { show: (n: number) => void } {
  const element = h('section', {
    class: 'cw-screen cw-countdown',
    attrs: { 'aria-live': 'assertive' },
  });
  return {
    element,
    show(n: number) {
      element.replaceChildren(
        h('div', { class: 'cw-countdown__number', text: n > 0 ? String(n) : 'GO' }),
      );
    },
  };
}

/* Pause ------------------------------------------------------------------ */

export interface PauseInfo {
  countdown: number | null;
  /** Seconds until the Hauler leaves the level. */
  timeLeft: number;
  obstaclesCleared: number;
  obstaclesTotal: number;
  beacons: string;
  dish: string;
  score: number;
}

/** What each control does, per way of playing. The pause menu's help lists them. */
const CONTROLS: Record<InputSource, readonly (readonly [string, string])[]> = {
  keyboard: [
    ['W A S D', 'Drive (or the arrow keys)'],
    ['SHIFT', 'Brake'],
    ['SPACE', "Use the machine's action"],
    ['E', 'Enter or exit a machine'],
    ['Q / R', 'Rotate the camera'],
    ['Z / X', 'Zoom (or the mouse wheel)'],
    ['ESC / P', 'Pause'],
  ],
  gamepad: [
    ['LEFT STICK', 'Point where to drive'],
    ['RT / LT', 'Gas and reverse, steering with the stick'],
    ['A', "Use the machine's action"],
    ['B', 'Brake'],
    ['Y', 'Enter or exit a machine'],
    ['LB / RB', 'Rotate the camera'],
    ['D-PAD', 'Zoom, up and down'],
    ['START', 'Pause'],
  ],
  touch: [
    ['STICK', 'Point where to drive; push further to go faster'],
    ['ACTION', "Use the machine's action"],
    ['BRAKE', 'Brake'],
    ['EXIT', 'Enter or exit a machine'],
    ['MINI-MAP', 'Tap to fold it away, double-tap to recentre the camera'],
  ],
};

const CONTROL_TITLES: Record<InputSource, string> = {
  keyboard: 'KEYBOARD',
  gamepad: 'GAMEPAD',
  touch: 'TOUCH',
};

function controlsList(source: InputSource): HTMLElement {
  return h(
    'div',
    { class: 'cw-controls__group' },
    h('div', { class: 'cw-label', text: CONTROL_TITLES[source] }),
    h(
      'dl',
      { class: 'cw-controls__list' },
      ...CONTROLS[source].flatMap(([key, what]) => [
        h('dt', {}, chip(key)),
        h('dd', { text: what }),
      ]),
    ),
  );
}

export function pauseScreen(
  info: () => PauseInfo,
  /** Touch players see the touch controls in the help, everyone else keys and gamepad. */
  source: InputSource,
  actions: { resume: () => void; restart: () => void; settings: () => void; quit: () => void },
): Screen {
  const impact = chip('', 'amber');
  const stats = h('div', { class: 'cw-dialog__stats' });
  const resume = button('RESUME', 'primary', actions.resume);
  const dialog = h('div', { class: 'cw-card cw-dialog' });
  const element = h(
    'section',
    {
      class: 'cw-screen cw-screen--dim',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' },
    },
    dialog,
  );
  const controls = button('Controls', 'ghost', () => showHelp());
  const menu = [
    h(
      'div',
      { class: 'cw-dialog__head' },
      h('h1', { class: 'cw-heading', text: 'Paused' }),
      impact,
    ),
    resume,
    h(
      'div',
      { class: 'cw-dialog__row' },
      button('Restart', 'secondary', actions.restart),
      button('Settings', 'ghost', actions.settings),
      controls,
      button('Quit to map', 'text', actions.quit),
    ),
    stats,
  ];
  const back = button('BACK', 'primary', () => showMenu());
  const help = [
    h('h1', { class: 'cw-heading', text: 'Controls' }),
    h(
      'div',
      { class: 'cw-controls' },
      ...(source === 'touch' ? (['touch'] as const) : (['keyboard', 'gamepad'] as const)).map(
        controlsList,
      ),
    ),
    back,
  ];
  const showMenu = (): void => {
    dialog.classList.remove('cw-dialog--controls');
    dialog.replaceChildren(...menu);
    controls.focus();
  };
  const showHelp = (): void => {
    dialog.classList.add('cw-dialog--controls');
    dialog.replaceChildren(...help);
    dialog.scrollTop = 0;
    back.focus();
  };
  const update = (): void => {
    const i = info();
    impact.textContent =
      i.countdown === null
        ? `PATH CLEAR · ${formatClock(i.timeLeft)} LEFT`
        : `${formatClock(i.countdown)} TO IMPACT`;
    stats.replaceChildren(
      stat('OBSTACLES', `${i.obstaclesCleared} / ${i.obstaclesTotal}`),
      stat('BEACONS', i.beacons, 'signal'),
      stat('RELAY DISH', i.dish, 'muted'),
      stat('SCORE', formatScore(i.score), 'hazard'),
    );
  };
  update();
  dialog.replaceChildren(...menu);
  queueMicrotask(() => resume.focus());
  return { element, update };
}

/* Fail ------------------------------------------------------------------- */

export function failScreen(
  info: { hit: string; time: number; cleared: number; total: number; tip: string | null },
  actions: { retry: () => void; quit: () => void },
): Screen {
  const retry = button('RETRY', 'danger', actions.retry);
  const element = h(
    'section',
    {
      class: 'cw-screen cw-fail',
      attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Hauler destroyed' },
    },
    h(
      'span',
      { class: 'cw-chip cw-chip--alarm cw-fail__replay', style: { gap: '8px', height: '26px' } },
      h('span', { class: 'cw-dot' }),
      'SLOW MOTION · 0.25×',
    ),
    h(
      'div',
      { class: 'cw-dialog' },
      h('h1', { class: 'cw-heading' }, 'Hauler', h('br'), 'destroyed'),
      h(
        'p',
        { class: 'cw-body', style: { 'font-size': '13px' } },
        'It hit the ',
        h('b', { text: info.hit.toLowerCase(), style: { color: 'var(--cw-ink)' } }),
        ` at ${formatClock(info.time)} · ${info.cleared} of ${info.total} cleared`,
      ),
      info.tip ? h('div', { class: 'cw-tip' }, h('b', { text: 'TIP' }), ` · ${info.tip}`) : null,
      retry,
      button('Quit to map', 'ghost', actions.quit),
    ),
  );
  queueMicrotask(() => retry.focus());
  return { element };
}

/* Results ---------------------------------------------------------------- */

export function resultsScreen(
  info: {
    level: CampaignLevel;
    stats: LevelStats;
    medal: Medal | null;
    newBest: boolean;
    /** Best score before this run, to show a new record. */
    previousBestScore: number;
    obstaclesTotal: number;
    hasNext: boolean;
  },
  actions: { replay: () => void; next: () => void },
): Screen {
  const { stats, medal } = info;
  const bar = (
    label: string,
    found: number,
    total: number,
    tone: string,
    marker: boolean,
    valueText?: string,
  ): HTMLElement =>
    h(
      'div',
      { class: 'cw-bar' },
      h('div', { class: 'cw-bar__label', text: label }),
      h(
        'div',
        { class: 'cw-bar__track' },
        h('div', {
          class: 'cw-bar__fill',
          data: { tone },
          style: { width: `${total > 0 ? (found / total) * 100 : 0}%` },
        }),
        marker ? h('div', { class: 'cw-bar__marker' }) : null,
      ),
      h('div', { class: 'cw-bar__value', text: valueText ?? `${found} / ${total}` }),
    );

  const bars = h(
    'div',
    { class: 'cw-card cw-results__bars' },
    bar(
      'PATH CLEARED',
      stats.pathCleared ? info.obstaclesTotal : 0,
      info.obstaclesTotal,
      'go',
      false,
    ),
    bar('BUILDINGS', stats.buildingsDestroyed, stats.buildingsTotal, 'hazard', true),
    stats.beaconsTotal > 0
      ? bar('BEACONS', stats.beaconsFound, stats.beaconsTotal, 'signal', true)
      : null,
    stats.dishExists
      ? bar(
          'RELAY DISH',
          stats.dishFound ? 1 : 0,
          1,
          'signal',
          false,
          stats.dishFound ? 'FOUND' : 'NOT FOUND',
        )
      : null,
    h('div', {
      class: 'cw-body',
      text: 'White marker = silver at 80%',
      style: { 'font-size': '11px', color: 'var(--cw-muted)' },
    }),
  );

  let goal: HTMLElement | null = null;
  if (medal !== 'gold' && stats.pathCleared) {
    const target = medal === 'silver' ? 'gold' : 'silver';
    const need = shortfallFor(stats, target);
    const parts = [
      need.buildings > 0 ? `${need.buildings} more building${need.buildings === 1 ? '' : 's'}` : '',
      need.beacons > 0 ? `${need.beacons} beacon${need.beacons === 1 ? '' : 's'}` : '',
      need.dish ? 'the relay dish' : '',
    ].filter(Boolean);
    goal = h(
      'div',
      { class: 'cw-results__goal' },
      medalBadge(target, 'cw-medal-pip'),
      h('div', {}, h('b', { text: `For ${target}: ` }), `${parts.join(', ')}.`),
    );
  }

  const element = h(
    'section',
    { class: 'cw-screen cw-screen--solid cw-results', attrs: { 'aria-label': 'Results' } },
    h(
      'div',
      { class: 'cw-results__medal' },
      chip(`LEVEL ${String(info.level.index).padStart(2, '0')} · ${info.level.name.toUpperCase()}`),
      medalBadge(medal),
      h('h1', { class: 'cw-heading', text: medal ?? 'No medal' }),
      info.newBest && stats.clearTime !== null
        ? chip(`NEW BEST · ${formatClock(stats.clearTime)}`, 'go')
        : null,
      h(
        'div',
        { class: 'cw-results__score' },
        stat('SCORE', formatScore(stats.score), 'hazard'),
        stats.score > info.previousBestScore && info.previousBestScore > 0
          ? chip('NEW HIGH SCORE', 'hazard')
          : info.previousBestScore > 0
            ? chip(`BEST ${formatScore(info.previousBestScore)}`)
            : null,
      ),
    ),
    h(
      'div',
      { class: 'cw-results__main' },
      bars,
      goal,
      h(
        'div',
        { class: 'cw-results__actions' },
        button('Replay', 'secondary', actions.replay),
        button(info.hasNext ? 'NEXT LEVEL' : 'CAMPAIGN', 'primary', actions.next),
      ),
    ),
  );
  return { element };
}

/* Settings --------------------------------------------------------------- */

type Tab = 'controls' | 'display' | 'audio';

export function settingsScreen(
  settings: () => Settings,
  change: (patch: Partial<Settings>) => void,
  back: () => void,
): Screen {
  let tab: Tab = 'controls';
  const body = h('div', { class: 'cw-settings__body' });
  const tabs = (['controls', 'display', 'audio'] as const).map((id) =>
    h('button', {
      class: 'cw-tab',
      text: id.charAt(0).toUpperCase() + id.slice(1),
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(id === tab) },
      on: {
        click: () => {
          tab = id;
          for (const t of tabs)
            t.setAttribute('aria-selected', String(t.textContent.toLowerCase() === id));
          render();
        },
      },
    }),
  );

  const segmented = <T extends string>(
    label: string,
    options: readonly { value: T; label: string }[],
    value: T,
    pick: (value: T) => void,
  ): HTMLElement => {
    const group = h('div', {
      class: 'cw-segmented',
      attrs: { role: 'group', 'aria-label': label },
    });
    for (const option of options) {
      group.append(
        h('button', {
          text: option.label,
          attrs: { type: 'button', 'aria-pressed': String(option.value === value) },
          on: {
            click: () => {
              pick(option.value);
              render();
            },
          },
        }),
      );
    }
    return h(
      'div',
      { style: { display: 'flex', 'flex-direction': 'column', gap: '8px' } },
      h('div', { class: 'cw-label', text: label }),
      group,
    );
  };

  const render = (): void => {
    const s = settings();
    const content: HTMLElement[] = [];
    if (tab === 'controls') {
      const layout = (id: 'point' | 'classic', name: string, desc: string): HTMLElement =>
        h(
          'button',
          {
            class: 'cw-card cw-layout',
            attrs: { type: 'button', 'aria-pressed': String(s.controlLayout === id) },
            on: {
              click: () => {
                change({ controlLayout: id });
                render();
              },
            },
          },
          h('span', { class: 'cw-layout__name', text: name }),
          h('span', { class: 'cw-layout__desc', text: desc }),
        );
      content.push(
        h(
          'div',
          { style: { display: 'flex', 'flex-direction': 'column', gap: '8px' } },
          h('div', { class: 'cw-label', text: 'TOUCH LAYOUT' }),
          h(
            'div',
            { class: 'cw-layouts' },
            layout('point', 'Point-to-drive', 'One stick: point where to go. Default.'),
            layout('classic', 'Classic', 'Steering stick plus gas and brake pedals.'),
          ),
        ),
        h(
          'div',
          {},
          toggle('Left-handed', 'Mirror the stick and action buttons', s.leftHanded, (on) =>
            change({ leftHanded: on }),
          ),
          toggle('Steering assist', 'Eases your heading toward the route', s.steeringAssist, (on) =>
            change({ steeringAssist: on }),
          ),
          toggle(
            'Auto-skid (Fishtail)',
            'Straightens the truck up after a skid',
            s.autoSkid,
            (on) => change({ autoSkid: on }),
          ),
          toggle('Easy mode', 'The Hauler drives a quarter slower', s.easyMode, (on) =>
            change({ easyMode: on }),
          ),
          toggle('Haptics', 'Vibrate on impacts and warnings', s.haptics, (on) =>
            change({ haptics: on }),
          ),
        ),
      );
    } else if (tab === 'display') {
      content.push(
        segmented(
          'GRAPHICS QUALITY',
          [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'ultra', label: 'Ultra' },
          ] as const,
          s.graphics,
          (graphics) => change({ graphics }),
        ),
        h(
          'div',
          {},
          toggle('Mini-map', 'Collapsible on phones', s.minimap, (on) => change({ minimap: on })),
          toggle('Full camera shake', 'Off = reduced shake', s.fullShake, (on) =>
            change({ fullShake: on }),
          ),
          toggle(
            'Pattern markings',
            'Chevrons on the route and obstacles, not colour alone',
            s.patternMarkings,
            (on) => change({ patternMarkings: on }),
          ),
        ),
      );
    } else {
      content.push(
        slider('music', 'Music', { min: 0, max: 100, step: 1, value: s.music }, (music) =>
          change({ music }),
        ),
        slider('sfx', 'Effects', { min: 0, max: 100, step: 1, value: s.sfx }, (sfx) =>
          change({ sfx }),
        ),
        slider('voice', 'Crew radio', { min: 0, max: 100, step: 1, value: s.voice }, (voice) =>
          change({ voice }),
        ),
        h(
          'div',
          {},
          toggle('Tension music', 'Tempo rises as the Hauler closes in', s.tensionMusic, (on) =>
            change({ tensionMusic: on }),
          ),
          toggle('Subtitles', 'Show crew radio lines', s.subtitles, (on) =>
            change({ subtitles: on }),
          ),
        ),
      );
    }
    body.replaceChildren(...content);
  };

  const element = h(
    'section',
    { class: 'cw-screen cw-screen--solid cw-settings', attrs: { 'aria-label': 'Settings' } },
    h(
      'nav',
      { class: 'cw-settings__nav', attrs: { role: 'tablist', 'aria-label': 'Settings sections' } },
      h(
        'div',
        { class: 'cw-screen__head' },
        button('', 'ghost', back, { icon: icon('back'), ariaLabel: 'Back', class: 'cw-back' }),
        h('h1', { class: 'cw-heading', text: 'Settings' }),
      ),
      h('div', { class: 'cw-label', text: 'CONFIGURE', style: { margin: '0 4px 4px' } }),
      ...tabs,
    ),
    body,
  );
  render();
  return { element };
}
