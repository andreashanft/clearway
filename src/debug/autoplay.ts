import type { App } from '../app';
import { STEP_SECONDS } from '../engine/loop';

/** One line of the arrival report. */
export interface ArrivalRow {
  obstacle: string;
  /** When the design brief says the Hauler arrives, in seconds. */
  expected: number | undefined;
  /** When the Hauler's front reached the obstacle in the running game, in seconds. */
  measured: number;
  /** Difference in percent of the expected time. */
  offPercent: number | undefined;
  /** True when the arrival is within the ±10 % that the code brief allows. */
  ok: boolean;
}

/**
 * Debug autoplay for level tuning: runs the current level with an invincible Hauler and nobody
 * at the controls, and reports when the Hauler reaches each obstacle.
 *
 * The simulation runs as fast as the browser allows and is not drawn. Call it on a level that
 * has just started, for example after opening the page with `?debug&level=ID`.
 */
export function measureArrivals(app: App): ArrivalRow[] {
  const game = app.game;
  if (!game) {
    return [];
  }
  game.invincibleHauler = true;
  game.start();
  const pending = game.obstacles.map((obstacle) => ({
    id: obstacle.def.id,
    distance: obstacle.def.distance,
  }));
  const rows: ArrivalRow[] = [];
  const limit = (game.route.length / game.route.speed + 5) / STEP_SECONDS;
  for (let step = 0; step < limit && pending.length > 0; step += 1) {
    game.step(STEP_SECONDS);
    while (pending.length > 0 && game.hauler.distance >= pending[0].distance) {
      const reached = pending.shift();
      if (!reached) {
        break;
      }
      const expected = game.level.expected.arrivals.find(
        (arrival) => arrival.obstacle === reached.id,
      )?.seconds;
      const offPercent =
        expected === undefined ? undefined : ((game.time - expected) / expected) * 100;
      rows.push({
        obstacle: reached.id,
        expected,
        measured: Number(game.time.toFixed(2)),
        offPercent: offPercent === undefined ? undefined : Number(offPercent.toFixed(1)),
        ok: offPercent !== undefined && Math.abs(offPercent) <= 10,
      });
    }
  }
  console.table(rows);
  return rows;
}
