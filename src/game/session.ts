import type { GameBus } from './events';
import type { Hauler } from './hauler/hauler';
import type { RouteObstacle } from './hauler/route-sweep';
import { type LevelStats, medalFor } from './scoring';
import type { Buildings } from './world/buildings';

export type Phase = 'countdown' | 'clearing' | 'pathClear' | 'freeRoam' | 'results' | 'failed';
export type Difficulty = 'easy' | 'normal';

export interface ObstacleState {
  readonly id: string;
  readonly label: string;
  readonly memberIds: readonly string[];
  /** Nose distance along the route at which the Hauler meets it. */
  readonly distance: number;
  cleared: boolean;
}

/** Seconds the "Path clear" banner plays before free roam. */
export const PATH_CLEAR_BANNER = 3;
/** Easy mode: the Hauler stalls once for this long when an impact is this close. */
export const EASY_STALL_SECONDS = 8;
export const EASY_STALL_TRIGGER = 3;
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

/**
 * The rules of one attempt at a level: start delay, the race against the Hauler, path
 * clear, free roam, results, or failure. It reads the Hauler and buildings and reports
 * progress on the event bus.
 */
export class LevelSession {
  phase: Phase = 'countdown';
  readonly obstacles: ObstacleState[];
  /** Ignore Hauler contact (debug). */
  invincible = false;
  /** Seconds since the Hauler started rolling. */
  elapsed = 0;
  clearTime: number | null = null;
  private delayLeft: number;
  private bannerLeft = 0;
  private stallUsed = false;

  constructor(
    obstacles: readonly RouteObstacle[],
    private readonly hauler: Hauler,
    private readonly buildings: Buildings,
    private readonly bus: GameBus,
    startDelay: number,
    private readonly difficulty: Difficulty = 'normal',
  ) {
    this.delayLeft = startDelay;
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
    if (!next || (this.phase !== 'countdown' && this.phase !== 'clearing')) return null;
    const travel = (next.distance - this.hauler.distance) / this.hauler.speed;
    return Math.max(0, travel + (this.phase === 'countdown' ? this.delayLeft : 0));
  }

  get stats(): LevelStats {
    return {
      pathCleared: this.clearTime !== null,
      clearTime: this.clearTime,
      buildingsDestroyed: this.buildings.list.filter((b) => b.destroyed).length,
      buildingsTotal: this.buildings.list.length,
      beaconsFound: 0,
      beaconsTotal: 0,
      dishFound: false,
      dishExists: false,
    };
  }

  step(dt: number): void {
    switch (this.phase) {
      case 'countdown':
        this.delayLeft -= dt;
        if (this.delayLeft <= 0) {
          this.hauler.start();
          this.setPhase('clearing');
        }
        break;
      case 'clearing':
        this.elapsed += dt;
        this.maybeStall();
        break;
      case 'pathClear':
        this.elapsed += dt;
        this.bannerLeft -= dt;
        if (this.bannerLeft <= 0) this.setPhase('freeRoam');
        break;
      case 'freeRoam':
      case 'results':
      case 'failed':
        break;
    }
    this.hauler.setAlarm(urgencyFor(this.countdown) === 'red' ? 1 : 0);
  }

  /** Call when a building falls; clears its obstacle once every member is down. */
  buildingDestroyed(buildingId: string): void {
    for (const obstacle of this.obstacles) {
      if (obstacle.cleared || !obstacle.memberIds.includes(buildingId)) continue;
      const down = obstacle.memberIds.every((id) =>
        this.buildings.list.some((b) => b.def.id === id && b.destroyed),
      );
      if (!down) continue;
      obstacle.cleared = true;
      this.bus.emit('obstacle:cleared', { id: obstacle.id });
    }
    if (
      (this.phase === 'clearing' || this.phase === 'countdown') &&
      this.obstacles.every((o) => o.cleared)
    ) {
      this.clearTime = this.elapsed;
      this.bannerLeft = PATH_CLEAR_BANNER;
      this.hauler.headForSafeZone();
      this.setPhase('pathClear');
    }
  }

  /** The Hauler touched something solid. Returns true if this fails the level. */
  haulerContact(): boolean {
    if (this.invincible || (this.phase !== 'clearing' && this.phase !== 'countdown')) return false;
    this.setPhase('failed');
    return true;
  }

  /** Ends free roam and shows the results. */
  finish(): void {
    if (this.phase !== 'freeRoam' && this.phase !== 'pathClear') return;
    this.setPhase('results');
    const stats = this.stats;
    this.bus.emit('session:results', { stats, medal: medalFor(stats) });
  }

  private maybeStall(): void {
    if (this.difficulty !== 'easy' || this.stallUsed) return;
    const countdown = this.countdown;
    if (countdown !== null && countdown < EASY_STALL_TRIGGER) {
      this.stallUsed = true;
      this.hauler.stall(EASY_STALL_SECONDS);
      this.bus.emit('hauler:stalled', { seconds: EASY_STALL_SECONDS });
    }
  }

  private setPhase(phase: Phase): void {
    this.phase = phase;
    this.bus.emit('session:phase', { phase });
  }
}
