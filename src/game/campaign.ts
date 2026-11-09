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
  /** Map thumbnail (400 × 300 units), drawn from the level and terrain files. */
  readonly thumbnail: string;
}

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
      '<rect width="400" height="300" fill="#4E6B3C"/><path d="M-21 163 L124 163 L124 62 L-21 62 Z" fill="#C2BB68" fill-opacity="0.75"/><path d="M271 62 L413 62 L413 -68 L271 -68 Z" fill="#A47B50" fill-opacity="0.75"/><path d="M-21 248 L103 248 L103 345 L-21 345 Z" fill="#8DB466" fill-opacity="0.75"/><path d="M234 182 L385 182 L385 276 L234 276 Z" fill="#C2BB68" fill-opacity="0.75"/><path d="M210 -220 L201 -68 L205 35 L198 110 L204 166 L197 241 L202 345 L209 496" stroke="#3D7FA0" stroke-width="12" fill="none"/><path d="M-145 173 L558 173" stroke="#B9A57E" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M111 173 L111 365" stroke="#B9A57E" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M260 173 L260 -89" stroke="#B9A57E" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M260 80 L558 80" stroke="#B9A57E" stroke-width="4" fill="none" stroke-linejoin="round"/><rect x="119" y="207" width="6" height="6" fill="#2F3F28"/><rect x="138" y="193" width="4" height="4" fill="#2F3F28"/><rect x="98.5" y="231.5" width="5" height="5" fill="#2F3F28"/><rect x="145.5" y="182.5" width="11" height="11" fill="#2F3F28"/><rect x="152" y="188" width="10" height="10" fill="#2F3F28"/><rect x="192" y="179" width="6" height="6" fill="#2F3F28"/><rect x="128" y="192" width="8" height="8" fill="#2F3F28"/><rect x="270" y="84" width="6" height="6" fill="#2F3F28"/><rect x="249" y="144" width="4" height="4" fill="#2F3F28"/><rect x="282" y="115" width="4" height="4" fill="#2F3F28"/><rect x="336.5" y="86.5" width="5" height="5" fill="#2F3F28"/><rect x="318.5" y="66.5" width="7" height="7" fill="#2F3F28"/><path d="M34 234 L366 66" stroke="#FF3D5A" stroke-opacity="0.22" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M34 234 L366 66" stroke="#FF3D5A" stroke-width="3" fill="none" stroke-dasharray="8 6"/><rect x="84" y="196" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="122" y="176" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="158" y="158" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="232" y="120" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="269" y="101" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="306" y="82" width="18" height="18" rx="3" fill="#FF3D5A"/>',
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
      '<rect width="400" height="300" fill="#2E2D52"/><path d="M297 93 L371 93 L371 133 L297 133 Z" fill="#7E7B74" fill-opacity="0.75"/><path d="M131 54 L141 80 L151 107 L160 134 L170 161 L180 188 L190 214 L199 241 L209 268" stroke="#1E1D38" stroke-width="4" fill="none"/><path d="M131 54 L141 80 L151 107 L160 134 L170 161 L180 188 L190 214 L199 241 L209 268" stroke="#8E95C0" stroke-width="2" fill="none"/><path d="M11 182 L173 182" stroke="#4C4A72" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M183 182 L299 182" stroke="#4C4A72" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M91 110 L91 264" stroke="#4C4A72" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M135 110 L135 264" stroke="#4C4A72" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M231 64 L231 230" stroke="#4C4A72" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M231 114 L388 114" stroke="#4C4A72" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="M74 127 L74 241" stroke="#4C4A72" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M152 142 L152 235" stroke="#4C4A72" stroke-width="3" fill="none" stroke-linejoin="round"/><rect x="82" y="199" width="6" height="6" fill="#6C5E8A"/><rect x="94" y="199" width="6" height="6" fill="#6C5E8A"/><rect x="94" y="210" width="6" height="6" fill="#6C5E8A"/><rect x="126" y="158" width="6" height="6" fill="#6C5E8A"/><rect x="138" y="158" width="6" height="6" fill="#6C5E8A"/><rect x="138" y="189" width="6" height="6" fill="#6C5E8A"/><rect x="222" y="127" width="6" height="6" fill="#6C5E8A"/><rect x="234" y="146" width="6" height="6" fill="#6C5E8A"/><rect x="60" y="173" width="6" height="6" fill="#6C5E8A"/><rect x="141.5" y="112.5" width="11" height="11" fill="#6C5E8A"/><rect x="334.5" y="120.5" width="7" height="7" fill="#6C5E8A"/><rect x="263" y="104" width="4" height="4" fill="#6C5E8A"/><rect x="263" y="102" width="4" height="4" fill="#6C5E8A"/><rect x="268" y="102" width="4" height="4" fill="#6C5E8A"/><path d="M29 212 L371 88" stroke="#FF3D5A" stroke-opacity="0.22" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M29 212 L371 88" stroke="#FF3D5A" stroke-width="3" fill="none" stroke-dasharray="8 6"/><rect x="82" y="181" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="126" y="165" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="222" y="130" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="269" y="113" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="320" y="94" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="158" y="149" width="24" height="24" fill="none" stroke="#2EE6FF" stroke-width="3" stroke-dasharray="5 3"/>',
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
      '<rect width="400" height="300" fill="#5A4E3C"/><rect x="47" y="76" width="232" height="116" rx="14" fill="#6A5C46"/><rect x="60" y="90" width="205" height="88" rx="12" fill="#776850"/><rect x="74" y="103" width="177" height="61" rx="10" fill="#84755B"/><path d="M-38 63 L307 63 L307 157" stroke="#8C7B5C" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M293 63 L270 80 L256 99 L242 117 L214 123" stroke="#8C7B5C" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M-38 164 L47 164 L47 131" stroke="#8C7B5C" stroke-width="3" fill="none" stroke-linejoin="round"/><path d="M293 157 L438 157" stroke="#8C7B5C" stroke-width="3" fill="none" stroke-linejoin="round"/><rect x="30" y="127" width="4" height="4" fill="#3E3528"/><rect x="37" y="124" width="4" height="4" fill="#3E3528"/><rect x="189" y="119" width="4" height="4" fill="#3E3528"/><rect x="305.5" y="126.5" width="7" height="7" fill="#3E3528"/><rect x="284.5" y="128.5" width="9" height="9" fill="#3E3528"/><rect x="293" y="163" width="4" height="4" fill="#3E3528"/><rect x="293" y="165" width="4" height="4" fill="#3E3528"/><rect x="338" y="163" width="4" height="4" fill="#3E3528"/><rect x="344" y="163" width="4" height="4" fill="#3E3528"/><rect x="351" y="131" width="4" height="4" fill="#3E3528"/><rect x="363.5" y="163.5" width="5" height="5" fill="#3E3528"/><path d="M23 150 L377 150" stroke="#FF3D5A" stroke-opacity="0.22" stroke-width="18" fill="none" stroke-linecap="round"/><path d="M23 150 L377 150" stroke="#FF3D5A" stroke-width="3" fill="none" stroke-dasharray="8 6"/><rect x="62" y="141" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="108" y="141" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="158" y="145" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="215" y="141" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="280" y="141" width="18" height="18" rx="3" fill="#FF3D5A"/><rect x="328" y="141" width="18" height="18" rx="3" fill="#FF3D5A"/>',
  },
];

export function campaignLevel(id: string): CampaignLevel | undefined {
  return CAMPAIGN.find((level) => level.id === id);
}
