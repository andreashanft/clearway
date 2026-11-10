import type { GameBus } from './events';
import type { Hauler } from './hauler/hauler';
import type { RouteObstacle } from './hauler/route-sweep';
import { type LevelStats, medalFor } from './scoring';
import type { Buildings } from './world/buildings';

export type Phase = 'clearing' | 'pathClear' | 'results' | 'failed';
export type Difficulty = 'easy' | 'normal';

export interface ObstacleState {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
  /** Nose distance along the route at which the Hauler meets it. */
  readonly distance: number;
  cleared: boolean;
}

/** Easy mode: the Hauler drives at this share of the level's speed for the whole run. */
export const EASY_SPEED_FACTOR = 0.75;
/** Countdown thresholds for the HUD: amber under 15 s, red under 5 s. */
export const AMBER_SECONDS = 15;
export const RED_SECONDS = 5;

export type Urgency = 'calm' | 'amber' | 'red';

export function urgencyFor(countdown: number | null): Urgency {
  if (countdown === null) return 'calm';
  if (countdown < RED_SECONDS) return 'red';
  if (countdown < AMBER_SECONDS) return 'amber';
  return 'calm';
}

/** "tool-shed" → "Tool shed". */
export function labelFor(id: string): string {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the session needs to know about the level's pickups for the medal. */
export interface PickupCounts {
  readonly beaconsFound: number;
  readonly beaconsTotal: number;
  readonly dishFound: boolean;
  readonly dishExists: boolean;
}

/**
 * The rules of one attempt at a level. The Hauler rolls from the first moment. The player
 * clears its path, then has until the Hauler leaves the level to destroy more for a
 * better medal. Touching anything fails the run. It reads the Hauler and buildings and
 * reports progress on the event bus.
 */
export class LevelSession {
  phase: Phase = 'clearing';
  readonly obstacles: ObstacleState[];
  /** Ignore Hauler contact (debug). */
  invincible = false;
  /** Seconds since the run began. */
  elapsed = 0;
  clearTime: number | null = null;

  constructor(
    obstacles: readonly RouteObstacle[],
    private readonly hauler: Hauler,
    private readonly buildings: Buildings,
    private readonly bus: GameBus,
    /** Length of the Hauler's route; the run ends when its nose passes this. */
    private readonly routeLength: number,
  ) {
    this.obstacles = obstacles.map((o) => ({
      id: o.id,
      label: labelFor(o.id),
      memberIds: o.memberIds,
      distance: o.distance,
      cleared: false,
    }));
  }

  /** The next uncleared obstacle the Hauler will meet. */
  get next(): ObstacleState | null {
    return (
      this.obstacles.find((o) => !o.cleared && o.distance >= this.hauler.distance - 0.5) ?? null
    );
  }

  /** Seconds until the Hauler reaches the next obstacle, or null when there is none. */
  get countdown(): number | null {
    const next = this.next;
    if (!next || this.phase !== 'clearing') return null;
    return Math.max(0, (next.distance - this.hauler.distance) / this.hauler.cruiseSpeed);
  }

  /** Seconds until the Hauler leaves the level and the run ends. */
  get timeLeft(): number {
    return Math.max(0, (this.routeLength - this.hauler.distance) / this.hauler.cruiseSpeed);
  }

  /** Beacon and relay dish counts, when the level has pickups. */
  pickups: PickupCounts | null = null;
  /** Points scored so far this run. */
  score = 0;

  /** True while destroying things still scores: not after a failure or the results. */
  get scoring(): boolean {
    return this.phase !== 'failed' && this.phase !== 'results';
  }

  get stats(): LevelStats {
    return {
      pathCleared: this.clearTime !== null,
      clearTime: this.clearTime,
      buildingsDestroyed: this.buildings.list.filter((b) => b.destroyed).length,
      buildingsTotal: this.buildings.list.length,
      beaconsFound: this.pickups?.beaconsFound ?? 0,
      beaconsTotal: this.pickups?.beaconsTotal ?? 0,
      dishFound: this.pickups?.dishFound ?? false,
      dishExists: this.pickups?.dishExists ?? false,
      score: this.score,
    };
  }

  step(dt: number): void {
    if (this.phase === 'clearing' || this.phase === 'pathClear') {
      this.elapsed += dt;
      // The Hauler is through: whatever still stands, the run is over.
      if (this.hauler.pastEnd && this.phase === 'pathClear') this.finish();
    }
    this.hauler.setAlarm(urgencyFor(this.countdown) === 'red' ? 1 : 0);
  }

  /** Call when a building falls; clears its obstacle once every member is down. */
  buildingDestroyed(buildingId: string): void {
    for (const obstacle of this.obstacles) {
      if (obstacle.memberIds.length === 0) continue;
      if (obstacle.cleared || !obstacle.memberIds.includes(buildingId)) continue;
      const down = obstacle.memberIds.every((id) =>
        this.buildings.list.some((b) => b.def.id === id && b.destroyed),
      );
      if (!down) continue;
      obstacle.cleared = true;
      this.bus.emit('obstacle:cleared', { id: obstacle.id });
    }
    this.checkPathClear();
  }

  /** Clears an obstacle that isn't a building, such as a bridged route gap. */
  clearObstacle(id: string): void {
    const obstacle = this.obstacles.find((o) => o.id === id);
    if (!obstacle || obstacle.cleared) return;
    obstacle.cleared = true;
    this.bus.emit('obstacle:cleared', { id });
    this.checkPathClear();
  }

  private checkPathClear(): void {
    if (this.phase !== 'clearing' || !this.obstacles.every((o) => o.cleared)) return;
    this.clearTime = this.elapsed;
    this.setPhase('pathClear');
    this.bus.emit('path:cleared', { seconds: this.elapsed, timeLeft: this.timeLeft });
  }

  /** The Hauler touched something solid. Returns true if this fails the level. */
  haulerContact(): boolean {
    if (this.invincible || this.phase !== 'clearing') return false;
    this.setPhase('failed');
    return true;
  }

  /** Ends the run and shows the results. The path must be clear. */
  finish(): void {
    if (this.phase !== 'pathClear') return;
    this.setPhase('results');
    const stats = this.stats;
    this.bus.emit('session:results', { stats, medal: medalFor(stats) });
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.bus.emit('session:phase', { phase });
  }
}
