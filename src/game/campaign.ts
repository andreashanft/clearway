/**
 * The campaign as the menus present it: three levels in order, with the brief's facts.
 * A level is playable once its data file exists (see `level-data.ts`).
 */
export interface CampaignLevel {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  /** Short setting tag, such as "FARMLAND". */
  readonly tag: string;
  readonly setting: string;
  readonly tagline: string;
  /** Route length (m) and time for the Hauler to drive it (s), from the brief. */
  readonly routeLength: number;
  readonly routeSeconds: number;
  /** Map thumbnail drawn from the level maps in the design canvas (400 × 300 units). */
  readonly thumbnail: string;
}

const ROUTE = (d: string): string =>
  `<path d="${d}" stroke="#FF3D5A" stroke-opacity="0.22" stroke-width="18" fill="none" stroke-linecap="round"/>` +
  `<path d="${d}" stroke="#FF3D5A" stroke-width="3" fill="none" stroke-dasharray="8 6"/>`;

const box = (x: number, y: number, colour = '#FF3D5A'): string =>
  `<rect x="${x}" y="${y}" width="18" height="18" rx="3" fill="${colour}"/>`;

export const CAMPAIGN: readonly CampaignLevel[] = [
  {
    id: 'hollow-creek',
    index: 1,
    name: 'Hollow Creek',
    tag: 'FARMLAND',
    setting: 'Farmland · Morning',
    tagline: 'Ram, push TNT, learn the ropes.',
    routeLength: 540,
    routeSeconds: 180,
    thumbnail:
      '<rect width="400" height="300" fill="#4E6B3C"/>' +
      '<polygon points="0,0 120,0 100,80 0,95" fill="#B9B565"/>' +
      '<path d="M262 0 C 250 60, 278 100, 262 150 S 280 240, 270 300" stroke="#3D7FA0" stroke-width="16" fill="none"/>' +
      '<g fill="#4F7F3E"><circle cx="40" cy="150" r="14"/><circle cx="70" cy="170" r="12"/><circle cx="330" cy="220" r="14"/><circle cx="360" cy="250" r="12"/><circle cx="160" cy="40" r="13"/></g>' +
      ROUTE('M20 270 C 100 250, 130 190, 180 170 S 250 130, 270 120 S 350 70, 385 30') +
      box(66, 243) +
      box(121, 196) +
      box(166, 163) +
      box(281, 99) +
      box(316, 76) +
      box(346, 49),
  },
  {
    id: 'ferrow-junction',
    index: 2,
    name: 'Ferrow Junction',
    tag: 'RAIL TOWN · DUSK',
    setting: 'Rail town · Dusk',
    tagline: 'Skid the terraces, bridge the rail cutting.',
    routeLength: 640,
    routeSeconds: 160,
    thumbnail:
      '<rect width="400" height="300" fill="#2E2D52"/>' +
      '<rect x="186" y="0" width="30" height="300" fill="#1E1D38"/>' +
      '<path d="M193 0 V300 M209 0 V300" stroke="#8E95C0" stroke-width="2"/>' +
      '<g fill="#6C5E8A"><rect x="40" y="168" width="22" height="14"/><rect x="66" y="168" width="22" height="14"/><rect x="92" y="166" width="22" height="14"/><rect x="118" y="164" width="22" height="14"/><rect x="40" y="214" width="22" height="14"/><rect x="66" y="214" width="22" height="14"/><rect x="92" y="212" width="22" height="14"/><rect x="118" y="208" width="22" height="14"/></g>' +
      '<rect x="300" y="160" width="90" height="120" rx="4" fill="#4C4470"/>' +
      ROUTE('M20 200 C 100 200, 140 180, 200 160 S 300 150, 385 100') +
      '<rect x="186" y="146" width="30" height="28" fill="none" stroke="#2EE6FF" stroke-width="3" stroke-dasharray="5 3"/>' +
      '<circle cx="60" cy="40" r="22" fill="#FF9A2E" fill-opacity="0.3"/>',
  },
  {
    id: 'cinder-quarry',
    index: 3,
    name: 'Cinder Quarry',
    tag: 'QUARRY · NOON',
    setting: 'Open-pit quarry · Noon',
    tagline: 'Jump the terraces, free the mech.',
    routeLength: 760,
    routeSeconds: 152,
    thumbnail:
      '<rect width="400" height="300" fill="#5A4E3C"/>' +
      '<rect x="20" y="40" width="360" height="245" rx="40" fill="#6A5C46"/>' +
      '<rect x="45" y="80" width="300" height="195" rx="34" fill="#776850"/>' +
      '<rect x="80" y="125" width="230" height="130" rx="28" fill="#84755B"/>' +
      ROUTE('M20 60 H250 C 330 60, 330 180, 250 180 H120 C 60 180, 60 260, 120 260 H385') +
      box(81, 51) +
      box(191, 51) +
      box(300, 104) +
      box(191, 171) +
      box(70, 208) +
      box(241, 251),
  },
];

export function campaignLevel(id: string): CampaignLevel | undefined {
  return CAMPAIGN.find((level) => level.id === id);
}
