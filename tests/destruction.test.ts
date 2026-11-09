import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier } from '../src/engine/physics';
import { STRENGTH_HP } from '../src/game/damage';
import type { Effects } from '../src/game/fx/effects';
import { BUILDING_STYLES } from '../src/game/world/building-styles';
import {
  type BuildingDefinition,
  Buildings,
  FADE_SECONDS,
  RUBBLE_AFTER,
} from '../src/game/world/buildings';
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
    const styles = BUILDING_STYLES;
    const { buildings } = setup(
      styles.map((style, i) => ({
        id: style,
        style,
        strength: 'house',
        pos: [(i % 5) * 30 - 60, Math.floor(i / 5) * 30 - 45] as const,
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

    run(RUBBLE_AFTER + FADE_SECONDS + 0.2);
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

describe('DestructionSystem.explode', () => {
  it('pushes nearby bodies away and leaves the world disposable', async () => {
    const { DestructionSystem } = await import('../src/game/destruction-system');
    const { Props } = await import('../src/game/world/props');
    const { EventBus } = await import('../src/engine/events');
    const { Scene } = await import('three');
    const physics = new Physics(rapier);
    const props = new Props({ props: [], water: [] }, flat);
    const system = new DestructionSystem(
      { buildings: [], tnt: [] } as never,
      new Scene(),
      physics,
      flat,
      props,
      quietEffects,
      new EventBus(),
    );
    const body = physics.world.createRigidBody(
      rapier.RigidBodyDesc.dynamic().setTranslation(3, 1, 0),
    );
    physics.world.createCollider(rapier.ColliderDesc.ball(0.5), body);
    physics.step(1 / 60);

    system.explode(new Vector3(0, 1, 0), 8, 800);
    expect(body.linvel().x).toBeGreaterThan(1);

    system.dispose();
    expect(() => physics.dispose()).not.toThrow();
  });
});

describe('DestructionSystem landings', () => {
  it('damages a roof the wheels land on, which never touches the chassis', async () => {
    const { DestructionSystem } = await import('../src/game/destruction-system');
    const { Props } = await import('../src/game/world/props');
    const { EventBus } = await import('../src/engine/events');
    const { Liftoff } = await import('../src/game/vehicles/liftoff');
    const { Scene } = await import('three');
    const physics = new Physics(rapier);
    const ground = physics.world.createRigidBody(rapier.RigidBodyDesc.fixed());
    physics.world.createCollider(
      rapier.ColliderDesc.cuboid(200, 1, 200).setTranslation(0, -1, 0),
      ground,
    );
    const system = new DestructionSystem(
      {
        buildings: [
          { id: 'cabin', style: 'cabin', strength: 'shed', pos: [0, 0], size: [9, 3, 8] },
        ],
        tnt: [],
      } as never,
      new Scene(),
      physics,
      flat,
      new Props({ props: [], water: [] }, flat),
      quietEffects,
      new EventBus(),
    );
    const liftoff = new Liftoff(physics);
    system.addVehicle(liftoff);
    // A flat roof, so only the wheel rays touch it.
    liftoff.place(0, 6, 0, 0);
    liftoff.body.setLinvel({ x: 0, y: -7, z: 0 }, true);

    const [cabin] = system.buildings.list;
    for (let i = 0; i < 90 && !cabin?.destroyed; i++) {
      liftoff.step(1 / 60);
      system.step(1 / 60, [liftoff]);
      physics.step(1 / 60);
      system.afterStep();
      liftoff.afterStep();
    }
    expect(cabin?.destroyed).toBe(true);

    system.dispose();
    liftoff.dispose();
    expect(() => physics.dispose()).not.toThrow();
  });
});
