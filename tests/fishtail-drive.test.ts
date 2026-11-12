import { beforeAll, describe, expect, it } from 'vitest';
import { COLLISION } from '../src/engine/collision-groups';
import { type ControlFrame, IDLE_FRAME } from '../src/engine/input/controls';
import { loadRapier, Physics, type Rapier } from '../src/engine/physics';
import { wrapAngle } from '../src/game/drive';
import { Fishtail, SLIP_ANGLE } from '../src/game/vehicles/fishtail';

const DT = 1 / 60;
const DEG = Math.PI / 180;

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

/** A Fishtail on flat ground, facing south (+z), and a way to drive it for a while. */
function setup() {
  const physics = new Physics(rapier);
  const ground = physics.world.createRigidBody(rapier.RigidBodyDesc.fixed());
  physics.world.createCollider(
    rapier.ColliderDesc.cuboid(2000, 1, 2000)
      .setTranslation(0, -1, 0)
      .setCollisionGroups(COLLISION.ground),
    ground,
  );
  const truck = new Fishtail(physics);
  truck.place(0, 0, 0, 0);
  const drive = (seconds: number, frame: Partial<ControlFrame>): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      truck.control({ ...IDLE_FRAME, ...frame }, 0, DT);
      truck.step(DT);
      physics.step(DT);
      truck.afterStep();
    }
  };
  const motion = () => {
    const v = truck.body.linvel();
    return { speed: Math.hypot(v.x, v.z), course: Math.atan2(v.x, v.z) };
  };
  return { truck, drive, motion };
}

describe('Fishtail slide', () => {
  it('swings broadside and keeps its course and most of its speed', () => {
    const { truck, drive, motion } = setup();
    drive(2, { throttle: 1 });
    const before = motion();
    drive(1, { throttle: 1, action: true });
    const after = motion();
    expect(truck.isSkidding).toBe(true);
    expect(Math.abs(wrapAngle(truck.heading - after.course))).toBeCloseTo(SLIP_ANGLE, 1);
    expect(Math.abs(wrapAngle(after.course - before.course))).toBeLessThan(2 * DEG);
    expect(Math.abs(truck.body.translation().x)).toBeLessThan(1);
    expect(after.speed).toBeGreaterThan(before.speed * 0.8);
  });

  it('straightens up and drives on when Action is let go', () => {
    const { truck, drive, motion } = setup();
    drive(2, { throttle: 1 });
    drive(1, { throttle: 1, action: true });
    const sliding = motion();
    drive(0.6, { throttle: 1 });
    const after = motion();
    expect(truck.isSkidding).toBe(false);
    expect(Math.abs(wrapAngle(truck.heading))).toBeLessThan(6 * DEG);
    expect(Math.abs(wrapAngle(after.course))).toBeLessThan(6 * DEG);
    expect(after.speed).toBeGreaterThan(sliding.speed * 0.9);
  });

  it('follows the steering while it slides', () => {
    const { truck, drive, motion } = setup();
    drive(2, { throttle: 1 });
    drive(1, { throttle: 1, action: true, steer: 1 });
    expect(truck.isSkidding).toBe(true);
    // Steering right turns the course clockwise, which is a falling heading.
    expect(wrapAngle(motion().course)).toBeLessThan(-40 * DEG);
  });

  it('leaves the slide the way it points with auto-skid off', () => {
    const { truck, drive, motion } = setup();
    truck.autoSkid = false;
    drive(2, { throttle: 1 });
    drive(1, { throttle: 1, action: true, steer: 1 });
    const heading = truck.heading;
    drive(0.5, { throttle: 1 });
    expect(Math.abs(wrapAngle(motion().course - heading))).toBeLessThan(15 * DEG);
  });

  it('needs speed, and a fresh press after a slide runs out', () => {
    const { truck, drive } = setup();
    drive(0.2, { throttle: 1, action: true });
    expect(truck.isSkidding).toBe(false);
    drive(0.1, { throttle: 1 });
    drive(1.5, { throttle: 1 });
    drive(0.2, { throttle: 1, action: true });
    expect(truck.isSkidding).toBe(true);
    // Hold on until the slide runs out of speed: it must not start again by itself.
    drive(12, { action: true });
    expect(truck.isSkidding).toBe(false);
    drive(2, { throttle: 1, action: true });
    expect(truck.isSkidding).toBe(false);
  });
});
