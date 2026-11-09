/** Launch options read from the page URL, for example `?debug&webgl&level=hollow-creek`. */
export interface LaunchFlags {
  /** Shows the debug overlay and debug drawing. */
  readonly debug: boolean;
  /** Forces the WebGL2 backend even when WebGPU is available. */
  readonly forceWebGL: boolean;
  /** Level id to load directly, skipping the menus. */
  readonly level: string | null;
}

const TRUE_VALUES = new Set(['', '1', 'true', 'on', 'yes']);

function isOn(params: URLSearchParams, name: string): boolean {
  const value = params.get(name);
  return value !== null && TRUE_VALUES.has(value.toLowerCase());
}

/** Parses launch flags from a query string such as `location.search`. */
export function parseFlags(search: string): LaunchFlags {
  const params = new URLSearchParams(search);
  const level = params.get('level');
  return {
    debug: isOn(params, 'debug'),
    forceWebGL: isOn(params, 'webgl'),
    level: level !== null && level.length > 0 ? level : null,
  };
}
