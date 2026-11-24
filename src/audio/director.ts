import type { Game } from '../game/game';
import type { Strength, VehicleType } from '../game/level';
import type { AudioEngine, Loop } from './engine';

/** What a hit on each building strength sounds like: wood, wood, masonry, metal on concrete. */
const IMPACT_SOUNDS: Record<Strength, string[]> = {
  shed: ['crack-1', 'crack-2', 'impact-4'],
  house: ['impact-4', 'crack-2', 'impact-3'],
  brick: ['thud-1', 'thud-2', 'impact-1'],
  concrete: ['thud-2', 'metal-1', 'impact-2'],
};
const BLOCKED_SOUNDS = ['anvil', 'kabong', 'metal-2', 'pipe'];
const COLLAPSE_SOUNDS = ['collapse-1', 'collapse-2', 'collapse-3'];
const RUBBLE_SOUNDS = ['rubble-1', 'rubble-2', 'rubble-3'];
const BLAST_SOUNDS = ['blast-1', 'blast-2', 'blast-3'];

/** The engine recording of each vehicle type, and the pitch at standstill and at top speed. */
const ENGINES: Record<VehicleType, { sound: string; low: number; high: number }> = {
  dozer: { sound: 'engine-tank', low: 0.8, high: 1.35 },
  flail: { sound: 'engine-truck', low: 0.8, high: 1.5 },
  buggy: { sound: 'engine-idle', low: 1.0, high: 2.0 },
};

/** Sounds beyond this distance from the camera focus are silent, in metres. */
const HEARING_RANGE = 170;

function pick(sounds: readonly string[]): string {
  return sounds[Math.floor(Math.random() * sounds.length)];
}

/**
 * Turns what happens in the game into sound: impacts, collapses, explosions, engines, the
 * Hauler and pickups. It only listens to the event bus and reads the game state.
 */
export class SoundDirector {
  private game: Game | undefined;
  private engine: { type: VehicleType; loop: Loop } | undefined;
  private readonly hauler: Loop;
  private readonly alarm: Loop;
  private readonly fuse: Loop;

  constructor(private readonly audio: AudioEngine) {
    this.hauler = audio.loop('hauler');
    this.alarm = audio.loop('alarm');
    this.fuse = audio.loop('fuse');
    audio.preload([
      ...IMPACT_SOUNDS.shed,
      ...IMPACT_SOUNDS.brick,
      ...COLLAPSE_SOUNDS,
      ...BLAST_SOUNDS,
      'chime',
      'click',
      'radio',
    ]);
  }

  /** A short tick for buttons. */
  click(): void {
    this.audio.play('click', { volume: 0.6 });
  }

  /** Listens to a freshly loaded level. */
  attach(game: Game): void {
    this.game = game;
    const near = (position: { x: number; z: number }): number => {
      const focus = game.cameraRig.focusPoint;
      const distance = Math.hypot(position.x - focus.x, position.z - focus.z);
      return Math.max(0, 1 - distance / HEARING_RANGE);
    };

    game.events.on('impact', ({ position, strength, material, blocked, broke }) => {
      const volume = (0.5 + strength * 0.5) * near(position);
      if (blocked) {
        this.audio.play(pick(BLOCKED_SOUNDS), { volume, rate: 0.9 + Math.random() * 0.2 });
      } else {
        this.audio.play(pick(IMPACT_SOUNDS[material]), {
          volume: volume * (broke ? 1 : 0.8),
          rate: 0.9 + Math.random() * 0.25,
        });
      }
    });
    game.events.on('buildingCracked', ({ position }) => {
      this.audio.play(pick(['crack-1', 'crack-2']), { volume: 0.7 * near(position), rate: 0.8 });
    });
    game.events.on('segmentDestroyed', ({ building, position }) => {
      const volume = near(position);
      const glass = building.data.kind === 'greenhouse';
      this.audio.play(glass ? 'glass' : pick(COLLAPSE_SOUNDS), {
        volume: 0.85 * volume,
        rate: 0.9 + Math.random() * 0.25,
      });
      this.audio.play(pick(RUBBLE_SOUNDS), { volume: 0.5 * volume });
    });
    game.events.on('explosion', ({ position, source }) => {
      const volume = Math.max(0.35, near(position));
      this.audio.play(pick(BLAST_SOUNDS), { volume, rate: source === 'tank' ? 1.25 : 1 });
      this.audio.play('blast-crack', { volume: volume * 0.7 });
    });
    game.events.on('haulerDestroyed', () => {
      this.audio.play('blast-1', { volume: 1, rate: 0.8 });
      this.audio.play('boom', { volume: 1 });
      this.audio.play('bass-drop', { volume: 0.8 });
    });
    game.events.on('tntLit', ({ position }) => {
      this.audio.play('glitch-4', { volume: 0.7 * near(position) });
    });
    game.events.on('tntRespawned', ({ position }) => {
      this.audio.play('glitch-2', { volume: 0.4 * near(position) });
    });
    game.events.on('beaconLit', ({ lit }) => {
      // Each beacon of a run chimes a little higher than the last.
      this.audio.play('chime', { volume: 0.5, rate: 2 ** (((lit - 1) % 8) / 12) });
    });
    game.events.on('dishFound', () => {
      this.audio.play('bell-low', { volume: 0.9 });
      this.audio.play('chime', { volume: 0.7, rate: 1.5 });
    });
    game.events.on('obstacleCleared', () => {
      this.audio.play('tom-high', { volume: 0.6 });
    });
    game.events.on('pathClear', () => {
      this.audio.play('radio', { volume: 0.8, bus: 'voice' });
      this.audio.play('chime', { volume: 0.9, rate: 1 });
      this.audio.play('chime', { volume: 0.8, rate: 1.5 });
      this.audio.play('crash', { volume: 0.5 });
    });
    game.events.on('levelEnded', ({ result }) => {
      this.audio.play('bell-low', { volume: 0.8, rate: result.medal === 'gold' ? 1.5 : 1 });
    });
    game.events.on('vehicleChanged', () => {
      this.audio.play('door', { volume: 0.7 });
    });
    game.events.on('hint', () => {
      this.audio.play('radio', { volume: 0.45, bus: 'voice' });
    });
  }

  /** Updates the loops. Call it once per frame. */
  update(playing: boolean): void {
    const game = this.game;
    if (!game || !playing) {
      this.silenceLoops();
      return;
    }
    const vehicle = game.activeVehicle;
    const speed = Math.min(1, Math.abs(vehicle.forwardSpeed) / vehicle.spec.topSpeed);

    // Engine: one loop for the vehicle that the player drives.
    const engine = ENGINES[vehicle.spec.type];
    if (this.engine && this.engine.type !== vehicle.spec.type) {
      this.engine.loop.stop();
      this.engine = undefined;
    }
    this.engine ??= { type: vehicle.spec.type, loop: this.audio.loop(engine.sound) };
    this.engine.loop.set(0.3 + speed * 0.35, engine.low + (engine.high - engine.low) * speed);

    // The Hauler rumbles louder the closer it is, and its alarm sounds in the last seconds.
    const { hauler } = game;
    if (hauler && !hauler.destroyed) {
      const focus = game.cameraRig.focusPoint;
      const distance = Math.hypot(hauler.center.x - focus.x, hauler.center.z - focus.z);
      this.hauler.set(Math.max(0, 1 - distance / HEARING_RANGE) * 0.8, 0.9);
    } else {
      this.hauler.set(0);
    }
    const urgency = game.urgency;
    this.alarm.set(urgency === 'critical' && game.phase === 'playing' ? 0.55 : 0);
    this.fuse.set(game.tnt.crates.some((crate) => crate.state === 'lit') ? 0.5 : 0);
  }

  private silenceLoops(): void {
    this.engine?.loop.set(0);
    for (const loop of [this.hauler, this.alarm, this.fuse]) {
      loop.set(0);
    }
  }
}
