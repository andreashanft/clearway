/*
 * Inline SVG icons of the design system. They are simple stroke or fill shapes, never emoji.
 * Every icon is decorative: the element that holds it carries the accessible name.
 */

const svg = (size: number, viewBox: string, body: string): string =>
  `<svg width="${size}" height="${size}" viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  pause: svg(
    16,
    '0 0 18 18',
    '<rect x="3" y="2" width="4" height="14" rx="1" fill="currentColor"/><rect x="11" y="2" width="4" height="14" rx="1" fill="currentColor"/>',
  ),
  back: svg(
    18,
    '0 0 18 18',
    '<path d="M11 3 L5 9 L11 15" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  /** Route obstacle: a red square outline. */
  obstacle: svg(
    16,
    '0 0 16 16',
    '<rect x="2" y="2" width="12" height="12" fill="none" stroke="var(--cw-alarm)" stroke-width="2.5"/>',
  ),
  /** Beacon: a cyan dot with a halo. */
  beacon: svg(
    16,
    '0 0 16 16',
    '<circle cx="8" cy="8" r="7" fill="var(--cw-signal)" fill-opacity="0.3"/><circle cx="8" cy="8" r="3.5" fill="var(--cw-signal)"/>',
  ),
  /** Relay dish: a ring with a centre dot, in the current colour. */
  dish: svg(
    16,
    '0 0 16 16',
    '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  ),
  /** The Hauler from above, with its glowing core. */
  hauler:
    '<svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true" focusable="false"><rect x="1" y="2" width="14" height="10" rx="2" fill="#2B3038" stroke="var(--cw-alarm)" stroke-width="1.5"/><rect x="15" y="3" width="4" height="8" rx="1" fill="#3A414B"/><circle cx="7" cy="7" r="2.5" fill="var(--cw-alarm)"/></svg>',
  check: svg(
    40,
    '0 0 40 40',
    '<path d="M9 21 L17 29 L31 12" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  star: svg(
    64,
    '0 0 64 64',
    '<path d="M32 8 L38 24 L56 25 L42 36 L47 54 L32 44 L17 54 L22 36 L8 25 L26 24 Z" fill="currentColor"/>',
  ),
  /** The next-obstacle pointer: a chevron with a soft halo, in the current colour. */
  chevron:
    '<svg width="56" height="56" viewBox="-28 -28 56 56" aria-hidden="true" focusable="false"><polygon points="-22,-26 24,0 -22,26 -10,0" fill="currentColor" fill-opacity="0.28"/><polygon points="-15,-19 17,0 -15,19 -7,0" fill="currentColor" stroke="var(--cw-ground)" stroke-width="2.5" stroke-linejoin="round"/></svg>',
} as const;

/** Top-down vehicle icons, drawn like the vehicle sheet. */
export const VEHICLE_ICONS: Record<string, string> = {
  dozer:
    '<rect x="8" y="9" width="26" height="5" rx="1" fill="#3A4A70"/><rect x="8" y="34" width="26" height="5" rx="1" fill="#3A4A70"/><rect x="10" y="13" width="22" height="22" rx="3" fill="#FFD23F"/><rect x="34" y="6" width="5" height="36" rx="1.5" fill="#E0A800"/><path d="M39 10 l5 2 -5 2z M39 22 l5 2 -5 2z M39 34 l5 2 -5 2z" fill="#C9CED6"/><rect x="14" y="17" width="9" height="14" rx="2" fill="#0B1430"/>',
  flail:
    '<rect x="6" y="11" width="8" height="6" rx="2" fill="#3A414B"/><rect x="6" y="31" width="8" height="6" rx="2" fill="#3A414B"/><rect x="26" y="11" width="8" height="6" rx="2" fill="#3A414B"/><rect x="26" y="31" width="8" height="6" rx="2" fill="#3A414B"/><rect x="5" y="14" width="31" height="20" rx="3" fill="#FFD23F"/><rect x="11" y="18" width="14" height="12" rx="2" fill="#0B1430"/><rect x="36" y="16" width="6" height="2" fill="#8E95A0"/><rect x="36" y="30" width="6" height="2" fill="#8E95A0"/><rect x="41" y="12" width="4" height="24" rx="2" fill="#C9CED6"/>',
  buggy:
    '<circle cx="13" cy="13" r="5" fill="#3A414B"/><circle cx="13" cy="35" r="5" fill="#3A414B"/><circle cx="35" cy="13" r="5" fill="#3A414B"/><circle cx="35" cy="35" r="5" fill="#3A414B"/><rect x="9" y="17" width="32" height="14" rx="6" fill="#FFD23F"/><rect x="14" y="22.5" width="22" height="3" fill="#F04848"/><rect x="17" y="19" width="9" height="10" rx="2" fill="#0B1430"/>',
};

/** Returns the icon of a vehicle type as an SVG string. */
export function vehicleIcon(type: string, size: number): string {
  return svg(size, '0 0 48 48', VEHICLE_ICONS[type] ?? VEHICLE_ICONS.buggy);
}
