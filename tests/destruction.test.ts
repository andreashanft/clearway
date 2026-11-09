import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier } from '../src/engine/physics';
import { STRENGTH_HP } from '../src/game/damage';
import type { Effects } from '../src/game/fx/effects';
import { type BuildingDefinition, Buildings, RUBBLE_AFTER } from '../src/game/world/buildings';
import { Heightfield } from '../src/game/world/heightfield';

/** Effects are visual only; the tests replace them with no-ops. */
const quietEffects = {
  dustBurst: () => undefined,
  debrisBurst: () => undefined,
  explosion: () => undefined,
  update: () => undefined,
} as unknown as Effects;

const flat = new Heightfield(3, 100, new Float32Array(9));

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

function setup(defs: BuildingDefinition[]) {
  const physics = new Physics(rapier);
  const ground = physics.world.createRigidBody(rapier.RigidBodyDesc.fixed());
  physics.world.createCollider(
    rapier.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0),
    ground,
  );
  const destroyed: string[] = [];
  const buildings = new Buildings(defs, flat, physics, quietEffects, {
    onDamaged: () => undefined,
    onDestroyed: (b) => destroyed.push(b.def.id),
    register: () => undefined,
    unregister: () => undefined,
  });
  const run = (seconds: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      buildings.step(1 / 60);
      physics.step(1 / 60);
      buildings.afterStep();
    }
  };
  return { physics, buildings, destroyed, run };
}

const hit = { point: new Vector3(0, 1, 5), direction: new Vector3(0, 0, -1), speed: 10 };

describe('Buildings', () => {
  it('builds every style with a collider per piece', () => {
    const styles = ['shed', 'house', 'barn', 'stone-barn', 'kiosk', 'silo', 'fence'] as const;
    const { buildings } = setup(
      styles.map((style, i) => ({
        id: style,
        style,
        strength: 'house',
        pos: [i * 30 - 90, 0] as const,
        size: style === 'fence' ? ([10, 1.2, 0.3] as const) : ([8, 6, 7] as const),
      })),
    );
    for (const building of buildings.list) {
      expect(building.chunks.length).toBeGreaterThan(2);
      expect(building.colliders.length).toBe(building.chunks.length);
      expect(building.state).toBe('intact');
    }
  });

  it('cracks at half health, collapses at zero and settles into rubble', () => {
    const { buildings, physics, destroyed, run } = setup([
      { id: 'cottage', style: 'house', strength: 'house', pos: [0, 0], size: [8, 6, 7] },
    ]);
    const [cottage] = buildings.list;
    if (!cottage) throw new Error('missing building');
    const source = { kind: 'vehicle', vehicle: 'bruiser' } as const;
    const bodiesBefore = physics.bodyCount;

    buildings.damage(cottage, STRENGTH_HP.house * 0.4, source, hit);
    expect(cottage.state).toBe('intact');
    buildings.damage(cottage, STRENGTH_HP.house * 0.2, source, hit);
    expect(cottage.state).toBe('cracked');

    expect(buildings.damage(cottage, STRENGTH_HP.house, source, hit)).toBe(true);
    expect(cottage.state).toBe('collapsing');
    expect(cottage.colliders).toHaveLength(0);
    expect(destroyed).toEqual(['cottage']);
    // The intact body is gone and every piece now flies on its own.
    expect(physics.bodyCount).toBe(bodiesBefore - 1 + cottage.chunks.length);

    run(RUBBLE_AFTER + 0.2);
    expect(cottage.state).toBe('rubble');
    expect(physics.bodyCount).toBe(bodiesBefore - 1);
    // Rubble rests near the ground rather than falling through it.
    for (const chunk of cottage.chunks) expect(chunk.currPosition.y).toBeGreaterThan(-1);
  });

  it('shrugs off vehicles on concrete but not explosions', () => {
    const { buildings } = setup([
      { id: 'barn', style: 'stone-barn', strength: 'concrete', pos: [0, 0], size: [12, 7, 9] },
    ]);
    const [barn] = buildings.list;
    if (!barn) throw new Error('missing building');
    buildings.damage(barn, 5000, { kind: 'vehicle', vehicle: 'bruiser' }, hit);
    expect(barn.hp).toBe(STRENGTH_HP.concrete);
    buildings.damage(barn, 800, { kind: 'explosion' }, hit);
    expect(barn.destroyed).toBe(true);
  });

  it('measures distance to the footprint, not the centre', () => {
    const { buildings } = setup([
      { id: 'shed', style: 'shed', strength: 'shed', pos: [10, 0], size: [6, 4, 4], yaw: 90 },
    ]);
    const [shed] = buildings.list;
    if (!shed) throw new Error('missing building');
    // Turned 90°, the 6 m side runs along z, so the footprint spans x 8–12.
    expect(shed.distanceTo(10, 0)).toBeCloseTo(0);
    expect(shed.distanceTo(5, 0)).toBeCloseTo(3);
    expect(shed.distanceTo(10, 5)).toBeCloseTo(2);
  });
});
