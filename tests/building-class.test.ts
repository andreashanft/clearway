import { describe, expect, it } from 'vitest';
import {
  SECTION_HEIGHT,
  TOWER_HEIGHT,
  classifyBuilding,
  sectionCount,
} from '../src/game/world/building-class';

describe('classifyBuilding', () => {
  it('calls a building taller than the tower height a tower', () => {
    expect(classifyBuilding(TOWER_HEIGHT + 1, 400)).toBe('tower');
    expect(classifyBuilding(TOWER_HEIGHT, 400)).toBe('block');
  });

  it('tells sheds and houses apart by size', () => {
    expect(classifyBuilding(4, 40)).toBe('shed');
    expect(classifyBuilding(8, 120)).toBe('house');
  });
});

describe('sectionCount', () => {
  it('keeps a low building in one section', () => {
    expect(sectionCount(8)).toBe(1);
    expect(sectionCount(TOWER_HEIGHT)).toBe(1);
  });

  it('gives a tower at least two sections', () => {
    expect(sectionCount(TOWER_HEIGHT + 1)).toBe(2);
  });

  it('cuts a tall tower into sections of about four floors', () => {
    expect(sectionCount(120)).toBe(10);
    expect(120 / sectionCount(120)).toBe(SECTION_HEIGHT);
    expect(54 / sectionCount(54)).toBeGreaterThan(SECTION_HEIGHT * 0.8);
    expect(54 / sectionCount(54)).toBeLessThan(SECTION_HEIGHT * 1.25);
  });
});
