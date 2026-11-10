import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/engine/events';
import type { GameEvents } from '../src/game/events';
import type { Hauler } from '../src/game/hauler/hauler';
import { LevelSession } from '../src/game/session';
import type { Buildings } from '../src/game/world/buildings';

const ROUTE_LENGTH = 300;

/** A session over two obstacles, with a stand-in Hauler the test moves by hand. */
function setup(): {
  session: LevelSession;
  hauler: { distance: number; cruiseSpeed: number; pastEnd: boolean };
  destroy: (id: string) => void;
  events: string[];
} {
  const hauler = {
    distance: -15,
    cruiseSpeed: 3,
    get pastEnd(): boolean {
      return this.distance >= ROUTE_LENGTH;
    },
    setAlarm: (): void => undefined,
  };
  const list = ['shed', 'barn'].map((id) => ({ def: { id }, destroyed: false }));
  const bus = new EventBus<GameEvents>();
  const events: string[] = [];
  bus.on('session:phase', ({ phase }) => events.push(phase));
  bus.on('session:results', () => events.push('results-shown'));
  const session = new LevelSession(
    [
      { id: 'shed', memberIds: ['shed'], distance: 90 },
      { id: 'barn', memberIds: ['barn'], distance: 150 },
    ],
    hauler as unknown as Hauler,
    { list } as unknown as Buildings,
    bus,
    ROUTE_LENGTH,
  );
  const destroy = (id: string): void => {
    const building = list.find((b) => b.def.id === id);
    if (building) building.destroyed = true;
    session.buildingDestroyed(id);
  };
  return { session, hauler, destroy, events };
}

describe('LevelSession', () => {
  it('counts down to the next obstacle from the first moment, lead-in included', () => {
    const { session } = setup();
    expect(session.phase).toBe('clearing');
    expect(session.countdown).toBeCloseTo((90 + 15) / 3);
  });

  it('keeps the run going after the path is clear, until the Hauler leaves', () => {
    const { session, hauler, destroy, events } = setup();
    destroy('shed');
    expect(session.countdown).toBeCloseTo((150 + 15) / 3);
    destroy('barn');
    expect(session.phase).toBe('pathClear');
    expect(session.countdown).toBeNull();
    expect(session.timeLeft).toBeCloseTo((ROUTE_LENGTH + 15) / 3);

    hauler.distance = ROUTE_LENGTH - 1;
    session.step(1 / 60);
    expect(session.phase).toBe('pathClear');
    hauler.distance = ROUTE_LENGTH;
    session.step(1 / 60);
    expect(session.phase).toBe('results');
    expect(events).toEqual(['pathClear', 'results', 'results-shown']);
  });

  it('fails on contact while clearing, and ignores contact once the path is clear', () => {
    const failing = setup();
    expect(failing.session.haulerContact()).toBe(true);
    expect(failing.session.phase).toBe('failed');

    const cleared = setup();
    cleared.destroy('shed');
    cleared.destroy('barn');
    expect(cleared.session.haulerContact()).toBe(false);
    expect(cleared.session.phase).toBe('pathClear');
  });
});
