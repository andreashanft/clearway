import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/engine/flags';

describe('parseFlags', () => {
  it('defaults everything off', () => {
    expect(parseFlags('')).toEqual({ debug: false, forceWebGL: false, level: null });
  });

  it('treats a bare flag as on', () => {
    expect(parseFlags('?debug&webgl')).toMatchObject({ debug: true, forceWebGL: true });
  });

  it('accepts common true values and rejects others', () => {
    expect(parseFlags('?debug=1').debug).toBe(true);
    expect(parseFlags('?debug=TRUE').debug).toBe(true);
    expect(parseFlags('?debug=0').debug).toBe(false);
    expect(parseFlags('?debug=no').debug).toBe(false);
  });

  it('reads a level id and ignores an empty one', () => {
    expect(parseFlags('?level=hollow-creek').level).toBe('hollow-creek');
    expect(parseFlags('?level=').level).toBeNull();
  });
});
