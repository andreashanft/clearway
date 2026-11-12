import { Howl, Howler } from 'howler';

/** The three volume groups of the Settings screen. */
export type Bus = 'music' | 'effects' | 'voice';

export interface PlayOptions {
  /** Volume from 0 to 1, before the bus volume. */
  volume?: number;
  /** Playback rate. 1 is the recorded pitch. */
  rate?: number;
  bus?: Bus;
}

/** A sound that plays in a loop until it is stopped, for example an engine. */
export interface Loop {
  /** Sets the volume from 0 to 1 and the playback rate. A volume of 0 pauses the loop. */
  set(volume: number, rate?: number): void;
  stop(): void;
}

/**
 * Plays the recordings in `public/audio/`.
 *
 * Howler loads each file on first use and unlocks audio on the first tap, which iOS requires.
 */
export class AudioEngine {
  private readonly sounds = new Map<string, Howl>();
  private readonly volumes: Record<Bus, number> = { music: 0.7, effects: 0.85, voice: 0.8 };

  /** Sets the volume of each group from 0 to 1. */
  setVolumes(volumes: Partial<Record<Bus, number>>): void {
    Object.assign(this.volumes, volumes);
  }

  /** Volume of a group from 0 to 1. */
  volume(bus: Bus): number {
    return this.volumes[bus];
  }

  /** Loads sounds ahead of time, so that their first use does not come late. */
  preload(names: readonly string[]): void {
    for (const name of names) {
      this.sound(name);
    }
  }

  /** Plays a sound once. */
  play(name: string, options: PlayOptions = {}): void {
    const volume = (options.volume ?? 1) * this.volumes[options.bus ?? 'effects'];
    if (volume <= 0.001) {
      return;
    }
    const sound = this.sound(name);
    const id = sound.play();
    sound.volume(Math.min(1, volume), id);
    sound.rate(options.rate ?? 1, id);
  }

  /** Starts a silent loop. Raise its volume with `set`. */
  loop(name: string, bus: Bus = 'effects'): Loop {
    const sound = new Howl({ src: [url(name)], loop: true, volume: 0 });
    let playing = false;
    return {
      set: (volume, rate = 1) => {
        const level = Math.min(1, volume * this.volumes[bus]);
        if (level <= 0.001) {
          if (playing) {
            sound.pause();
            playing = false;
          }
          return;
        }
        if (!playing) {
          sound.play();
          playing = true;
        }
        sound.volume(level);
        sound.rate(rate);
      },
      stop: () => {
        sound.stop();
        sound.unload();
        playing = false;
      },
    };
  }

  /** Silences everything, for example while the page is hidden. */
  setMuted(muted: boolean): void {
    Howler.mute(muted);
  }

  private sound(name: string): Howl {
    let sound = this.sounds.get(name);
    if (!sound) {
      sound = new Howl({ src: [url(name)] });
      this.sounds.set(name, sound);
    }
    return sound;
  }
}

function url(name: string): string {
  return `${import.meta.env.BASE_URL}audio/${name}.mp3`;
}
