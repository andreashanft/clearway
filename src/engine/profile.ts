/**
 * Named timings of the boot and of each level load. They are User Timing measures, so
 * they also show up in the browser's performance panel. `?debug` prints them as a table.
 */

const PREFIX = 'cw:';

export interface Timing {
  readonly name: string;
  /** Milliseconds since the page started loading. */
  readonly start: number;
  readonly ms: number;
}

/** Times a synchronous piece of work. */
export function timed<T>(name: string, work: () => T): T {
  const start = performance.now();
  try {
    return work();
  } finally {
    record(name, start);
  }
}

/** Times a piece of work that waits, such as a download. */
export async function timedAsync<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    record(name, start);
  }
}

/** Records a timing that began at `start` (from `performance.now()`) and ends now. */
export function record(name: string, start: number): void {
  performance.measure(PREFIX + name, { start, end: performance.now() });
}

/** Every timing recorded so far, in the order the work began. */
export function timings(): Timing[] {
  return performance
    .getEntriesByType('measure')
    .filter((entry) => entry.name.startsWith(PREFIX))
    .map((entry) => ({
      name: entry.name.slice(PREFIX.length),
      start: Math.round(entry.startTime),
      ms: Math.round(entry.duration * 10) / 10,
    }))
    .sort((a, b) => a.start - b.start);
}

/** Milliseconds the latest timing with this name took, or 0 when there is none. */
export function lastTiming(name: string): number {
  const entry = performance.getEntriesByName(PREFIX + name, 'measure').at(-1);
  return entry ? Math.round(entry.duration) : 0;
}
