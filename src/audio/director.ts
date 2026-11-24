import type { Game } from '../game/game';
import type { BuildingClass, VehicleType } from '../game/level';
import type { AudioEngine, Loop } from './engine';

/** What a hit on each class of building sounds like: wood, wood, masonry, metal on concrete. */
const IMPACT_SOUNDS: Record<BuildingClass, string[]> = {
  shed: ['crack-1', 'crack-2', 'impact-4'],
  house: ['impact-4', 'crack-2', 'impact-3'],
  block: ['thud-1', 'thud-2', 'impact-1'],
  tower: ['thud-2', 'metal-1', 'impact-2'],
};
/** A piece of at least this volume, in cubic metres, adds a deep boom to its fall. */
const BIG_PIECE_VOLUME = 1500;
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
  private readonly skid: Loop;

  constructor(private readonly audio: AudioEngine) {
    this.hauler = audio.loop('hauler');
    this.alarm = audio.loop('alarm');
    this.fuse = audio.loop('fuse');
    this.skid = audio.loop('skid');
    audio.preload([
      ...IMPACT_SOUNDS.shed,
      ...IMPACT_SOUNDS.block,
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

    game.events.on('impact', ({ position, strength, material, broke }) => {
      const volume = (0.5 + strength * 0.5) * near(position);
      this.audio.play(pick(IMPACT_SOUNDS[material]), {
        volume: volume * (broke ? 1 : 0.8),
        rate: 0.9 + Math.random() * 0.25,
      });
    });
    game.events.on('buildingCracked', ({ position }) => {
      this.audio.play(pick(['crack-1', 'crack-2']), { volume: 0.7 * near(position), rate: 0.8 });
    });
    game.events.on('pieceDestroyed', ({ position, volume: size }) => {
      const volume = near(position);
      const big = size >= BIG_PIECE_VOLUME;
      this.audio.play(pick(COLLAPSE_SOUNDS), {
        volume: 0.9 * volume,
        rate: (big ? 0.75 : 0.9) + Math.random() * 0.25,
      });
      this.audio.play(pick(RUBBLE_SOUNDS), { volume: 0.6 * volume });
      if (big) {
        this.audio.play('boom', { volume: 0.55 * volume, rate: 1.2 });
      }
    });
    game.events.on('towerCollapsing', ({ position }) => {
      const volume = Math.max(0.4, near(position));
      this.audio.play('boom', { volume });
      this.audio.play('bass-drop', { volume: 0.8 * volume });
      this.audio.play(pick(COLLAPSE_SOUNDS), { volume, rate: 0.65 });
    });
    game.events.on('towerFloor', ({ position, floor }) => {
      // Every other floor rumbles, a little lower each time.
      if (floor % 2 === 0) {
        this.audio.play(pick(RUBBLE_SOUNDS), {
          volume: 0.7 * Math.max(0.3, near(position)),
          rate: Math.max(0.55, 1 - floor * 0.01),
        });
      }
    });
    game.events.on('towerFell', ({ position }) => {
      const volume = Math.max(0.3, near(position));
      this.audio.play(pick(COLLAPSE_SOUNDS), { volume, rate: 0.55 });
      this.audio.play('boom', { volume: 0.7 * volume, rate: 0.8 });
    });
    let lastMultiplier = 1;
    game.events.on('scored', ({ multiplier }) => {
      // The combo chimes higher with each step of the multiplier.
      if (multiplier > lastMultiplier) {
        this.audio.play('chime', { volume: 0.5, rate: 2 ** ((multiplier - 1) / 6) });
      }
      lastMultiplier = multiplier;
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

    // The tyres screech while the vehicle slides. The tracks of the bulldozer grind lower.
    // After a crash or the end of a level, the world stands still.
    const driving = game.phase !== 'failed' && game.phase !== 'ended';
    const sliding =
      driving && vehicle.grounded
        ? vehicle.slide * Math.min(1, Math.abs(vehicle.forwardSpeed) / 12)
        : 0;
    this.skid.set(sliding * 0.55, vehicle.spec.type === 'dozer' ? 0.7 : 0.9 + speed * 0.2);

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
    for (const loop of [this.hauler, this.alarm, this.fuse, this.skid]) {
      loop.set(0);
    }
  }
}
