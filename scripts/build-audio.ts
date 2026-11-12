/**
 * Builds the game's sound files from public-domain recordings.
 *
 * Run it with `npm run build:audio`. It needs macOS (`afconvert` decodes the sources) and
 * `lame` (`brew install lame`). You only need it to change the samples: its output is in
 * the repository.
 *
 * For each entry in `SAMPLES` the script downloads the source into `.cache/audio-sources`
 * (once), trims it, sets its level, makes loops seamless and writes
 * `public/audio/NAME.mp3`. It also writes `src/game/audio/sample-data.ts`, which tells the
 * game what exists, and `public/audio/CREDITS.md`.
 *
 * Every source carries the Creative Commons 0 licence: Sonic Pi's sample set and
 * recordings from freesound.org.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'audio-sources');
const OUT = join(ROOT, 'public', 'audio');
const DATA = join(ROOT, 'src', 'game', 'audio', 'sample-data.ts');
const RATE = 44100;
/** Seconds of the loop repeated before and after it, so loop points need not be exact. */
const LOOP_PAD = 0.25;
const SONIC_PI = 'https://raw.githubusercontent.com/sonic-pi-net/sonic-pi/dev/etc/samples/';
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (Macintosh)' };

type Source =
  | { kind: 'sonic-pi'; name: string }
  | { kind: 'freesound'; id: number; author: string; title: string };

interface Options {
  src: Source;
  from?: number;
  to?: number;
  peak?: number;
  rms?: number;
  fadeOut?: number;
  loop?: number;
  cross?: number;
  highpass?: number;
}

interface Processed {
  samples: Float32Array;
  loop?: [number, number];
}

/** A sample from Sonic Pi's set. */
const sp = (name: string): Source => ({ kind: 'sonic-pi', name });
/** A recording from freesound.org. */
const fs = (id: number, author: string, title: string): Source => ({
  kind: 'freesound',
  id,
  author,
  title,
});

/**
 * Every sound file. Options, all optional:
 * - `from`, `to`: the part of the source to use, in seconds. Without them the script
 *   cuts the silence off both ends.
 * - `peak`: level of the loudest sample in dB (default −1).
 * - `rms`: average level in dB; used for loops in place of `peak`.
 * - `fadeOut`: seconds of fade at the end (default 0.03).
 * - `loop`: seconds of seamless loop to make, starting at `from`; `cross` is the
 *   crossfade that closes it (default 0.4).
 * - `highpass`: removes rumble below this frequency (Hz).
 */
const SAMPLES: Record<string, Options> = {
  // Drums.
  kick: { src: sp('drum_heavy_kick') },
  'kick-hard': { src: sp('drum_bass_hard') },
  boom: { src: sp('bd_boom') },
  'tom-low': { src: sp('drum_tom_lo_hard') },
  'tom-mid': { src: sp('drum_tom_mid_hard') },
  'tom-high': { src: sp('drum_tom_hi_hard') },
  'fuzz-tom': { src: sp('elec_fuzz_tom') },
  snare: { src: sp('drum_snare_hard') },
  'snare-noise': { src: sp('elec_filt_snare'), to: 0.6, fadeOut: 0.2 },
  hat: { src: sp('drum_cymbal_closed') },
  'hat-metal': { src: sp('hat_metal'), to: 0.3, fadeOut: 0.1 },
  'hat-noise': { src: sp('hat_noiz') },
  crash: { src: sp('drum_cymbal_hard') },
  // Metal and machinery.
  slam: { src: sp('perc_impact1') },
  clank: { src: sp('perc_impact2') },
  door: { src: sp('perc_door') },
  'glitch-2': { src: sp('glitch_perc2'), to: 0.5, fadeOut: 0.1 },
  'glitch-4': { src: sp('glitch_perc4'), to: 0.4, fadeOut: 0.1 },
  'glitch-5': { src: sp('glitch_perc5'), to: 0.4, fadeOut: 0.1 },
  'ind-a': { src: sp('loop_industrial'), from: 0, to: 0.4, fadeOut: 0.02 },
  'ind-b': { src: sp('loop_industrial'), from: 0.4, to: 0.88, fadeOut: 0.05 },
  anvil: { src: fs(270588, 'michorvath', 'Anvil Hit 2') },
  pipe: { src: fs(244983, 'ani_music', 'ANI Big Pipe Hit') },
  kabong: { src: fs(845939, 'craigsmith', 'Heavy Kabong Metal Hit.') },
  machine: { src: sp('loop_3d_printer'), from: 1, loop: 5, cross: 0.6, rms: -20 },
  // Bass.
  'bass-hard': { src: sp('bass_hard_c') },
  'bass-thick': { src: sp('bass_thick_c') },
  'bass-sub': { src: sp('bass_woodsy_c') },
  'bass-drop': { src: sp('bass_drop_c') },
  // Drones and swells.
  'pad-low': { src: sp('tbd_pad_1'), from: 0.05, loop: 1.4, cross: 0.5, rms: -18 },
  'pad-mid': { src: sp('tbd_pad_2'), from: 0.05, loop: 2.4, cross: 0.7, rms: -18 },
  'pad-tense': { src: sp('tbd_pad_3'), from: 0.05, loop: 2.2, cross: 0.7, rms: -18 },
  drone: { src: sp('loop_drone_g_97'), from: 0, loop: 4.4, cross: 0.5, rms: -18 },
  woosh: { src: sp('ambi_dark_woosh') },
  hum: { src: sp('ambi_haunted_hum') },
  'bell-low': { src: sp('perc_bell2'), to: 3.5, fadeOut: 1 },
  chime: { src: sp('elec_chime') },
  click: { src: sp('tbd_perc_tap_1') },
  // Engines.
  'engine-tractor': { src: fs(149193, 'videog', 'tractor idling'), from: 2, loop: 4, rms: -18 },
  'engine-truck': {
    src: fs(186940, 'ReadeOnly', 'engine3_idle_loop.wav'),
    from: 0.2,
    loop: 3,
    rms: -18,
  },
  'engine-idle': {
    src: fs(186935, 'ReadeOnly', 'engine_idle_loop.wav'),
    from: 0.5,
    loop: 4,
    rms: -18,
  },
  'engine-tank': {
    src: fs(187676, 'qubodup', 'Driving Tank Engine'),
    from: 0.5,
    loop: 4,
    rms: -18,
  },
  'engine-generator': {
    src: fs(748274, 'KVV_Audio', 'MOTRComb_Diesel Generator 03_KVV AUDIO_FREE'),
    from: 1,
    loop: 4,
    rms: -18,
  },
  'engine-load': {
    src: fs(186962, 'ReadeOnly', 'engine2_up.wav'),
    from: 4.8,
    loop: 1.9,
    rms: -18,
  },
  hauler: { src: fs(186934, 'ReadeOnly', 'engine4_loop.wav'), from: 1, loop: 6, rms: -18 },
  // Machine actions.
  skid: {
    src: fs(481668, 'craigsmith', 'R03-19-Old Auto Tire Skid.wav'),
    from: 3.3,
    loop: 1.3,
    cross: 0.3,
    rms: -18,
  },
  rocket: {
    src: fs(146770, 'qubodup', 'Rocket Boost Engine Loop.wav'),
    from: 0.3,
    loop: 3.6,
    rms: -18,
  },
  tracks: { src: fs(329800, 'greatmganga', 't26_moving_01.wav'), from: 2, loop: 5, rms: -18 },
  // Hits.
  'impact-1': { src: fs(151624, 'qubodup', 'Clank Car Crash Collision') },
  'impact-2': { src: fs(194193, 'T.42', 'TankDoorCrashBones.wav') },
  'impact-3': { src: fs(532874, 'FFeller', 'CartImpact1.wav') },
  'impact-4': { src: fs(723974, 'Saladsounds', 'Wooden Door breaks') },
  'thud-1': { src: fs(522098, 'magnuswaker', 'Concrete SMASH') },
  'thud-2': { src: fs(522099, 'magnuswaker', 'Concrete SMASH 2') },
  'crack-1': { src: fs(443293, 'Deathscyp', 'Wood Break.wav') },
  'crack-2': { src: fs(66780, 'kevinkace', 'Crate Break 4.wav') },
  'metal-1': { src: fs(562198, 'gristi', 'snd_metal_smash.wav') },
  'metal-2': { src: fs(841804, 'OOF9', 'Metallic Slam (Anvil)'), to: 2.2, fadeOut: 0.6 },
  // Collapsing buildings.
  'collapse-1': { src: fs(721600, 'DasWaff', 'Bakers house collapse'), to: 4.4, fadeOut: 1 },
  'collapse-2': { src: fs(845932, 'craigsmith', 'Building Collapse'), to: 5.4, fadeOut: 1.2 },
  'collapse-3': { src: fs(712918, 'greyfeather', 'building collapse / demolition') },
  'rubble-1': { src: fs(567249, 'iwanPlays', 'Bricks/Stones/Rocks/Gravel Falling') },
  'rubble-2': { src: fs(703247, 'xkeril', 'Big falling debris (crash)'), to: 3.4, fadeOut: 0.8 },
  'rubble-3': { src: fs(758582, 'magnuswaker', 'Rubble Trouble 3') },
  glass: { src: fs(540450, 'Za-Games', 'Breaking Glass 1') },
  // Explosions.
  'blast-1': {
    src: fs(841831, 'Robo9418', 'Deep Explosion with Falling Debris'),
    to: 3.6,
    fadeOut: 0.8,
  },
  'blast-2': {
    src: fs(132929, 'deleted_user_1887925', 'Explosion and Rubble/Debris'),
    to: 4.5,
    fadeOut: 1.2,
  },
  'blast-3': { src: fs(840508, 'qubodup', 'Illegal Explosion'), to: 5, fadeOut: 1.2 },
  'blast-crack': { src: fs(587887, 'SamsterBirdies', 'Explosion in a can'), to: 2, fadeOut: 0.6 },
  fuse: { src: fs(45650, 'elonen', 'fuse_burning_48khz.wav'), from: 0.2, to: 7.6, fadeOut: 0.2 },
  // Signals.
  alarm: { src: fs(832414, 'qubodup', 'Factory Warning Buzzer') },
  radio: { src: fs(47646, 'ReadeOnly', 'End radio transmission') },
};

const db = (value: number): number => (value > 0 ? 20 * Math.log10(value) : -120);
const fromDb = (value: number): number => Math.pow(10, value / 20);

async function download(url: string, path: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { headers: BROWSER });
    if (response.ok) {
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (response.status !== 429) throw new Error(`${url}: HTTP ${response.status}`);
    // freesound.org asks hurried clients to slow down.
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  throw new Error(`${url}: still rate-limited`);
}

/** Path of the cached source file, downloading it first if it is missing. */
async function source(src: Source): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  if (src.kind === 'sonic-pi') {
    const path = join(CACHE, `sp-${src.name}.flac`);
    if (!existsSync(path)) await download(`${SONIC_PI}${src.name}.flac`, path);
    return path;
  }
  const path = join(CACHE, `fs-${src.id}.mp3`);
  if (!existsSync(path)) {
    // The sound's page names the preview file, which needs no account to download.
    const page = await fetch(`https://freesound.org/s/${src.id}/`, { headers: BROWSER });
    const html = await page.text();
    if (!html.includes('creativecommons.org/publicdomain/zero')) {
      throw new Error(`freesound ${src.id} is not CC0`);
    }
    const preview = /data-mp3="([^"]+)"/.exec(html)?.[1];
    if (preview === undefined) throw new Error(`freesound ${src.id}: no preview found`);
    await download(preview.replace('-lq', '-hq'), path);
  }
  return path;
}

/** Decodes a file to mono samples at 44.1 kHz. */
function decode(path: string, scratch: string): Float32Array {
  const wav = join(scratch, 'decoded.wav');
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${RATE}`, '-c', '1', path, wav]);
  const bytes = readFileSync(wav);
  let at = 12;
  while (at < bytes.length) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'data') {
      const samples = new Float32Array(Math.floor(size / 2));
      for (let i = 0; i < samples.length; i++)
        samples[i] = bytes.readInt16LE(at + 8 + i * 2) / 32768;
      return samples;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`${path}: no audio data`);
}

function encode(samples: Float32Array, path: string, scratch: string): void {
  const wav = join(scratch, 'encoded.wav');
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + samples.length * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]!));
    bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  writeFileSync(wav, bytes);
  execFileSync('lame', ['--quiet', '-m', 'm', '-V', '3', wav, path]);
}

function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  return peak;
}

function rmsOf(samples: Float32Array): number {
  let sum = 0;
  for (const value of samples) sum += value * value;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** A first-order high-pass filter, run twice, to take out rumble. */
function highpass(samples: Float32Array, frequency: number): void {
  const k = Math.exp((-2 * Math.PI * frequency) / RATE);
  for (let pass = 0; pass < 2; pass++) {
    let low = 0;
    for (let i = 0; i < samples.length; i++) {
      low = samples[i]! + k * (low - samples[i]!);
      samples[i]! -= low;
    }
  }
}

/** Cuts the silence off both ends: everything more than 45 dB below the peak. */
function trimSilence(samples: Float32Array): Float32Array {
  const floor = peakOf(samples) * fromDb(-45);
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]!) < floor) start++;
  let end = samples.length;
  while (end > start && Math.abs(samples[end - 1]!) < floor) end--;
  const lead = Math.floor(RATE * 0.002);
  return samples.slice(
    Math.max(0, start - lead),
    Math.min(samples.length, end + Math.floor(RATE * 0.02)),
  );
}

function fade(samples: Float32Array, seconds: number, atEnd: boolean): void {
  const count = Math.min(samples.length, Math.floor(RATE * seconds));
  for (let i = 0; i < count; i++) {
    const gain = i / count;
    if (atEnd) samples[samples.length - 1 - i]! *= gain;
    else samples[i]! *= gain;
  }
}

/**
 * Makes `seconds` of seamless loop: the end of the loop fades into the sound that came
 * before its start, so the last sample leads into the first.
 */
function makeLoop(samples: Float32Array, seconds: number, cross: number): Float32Array {
  const length = Math.floor(RATE * seconds);
  const overlap = Math.floor(RATE * cross);
  if (samples.length < length + overlap) throw new Error('source too short for the loop');
  const loop = samples.slice(overlap, overlap + length);
  for (let i = 0; i < overlap; i++) {
    const t = i / overlap;
    const at = length - overlap + i;
    // Equal-power crossfade: two unrelated stretches of noise keep their level.
    loop[at] = loop[at]! * Math.cos((t * Math.PI) / 2) + samples[i]! * Math.sin((t * Math.PI) / 2);
  }
  return loop;
}

function process(samples: Float32Array, options: Options): Processed {
  if (options.highpass) highpass(samples, options.highpass);
  if (options.loop) {
    const cross = options.cross ?? 0.4;
    const start = Math.floor(RATE * (options.from ?? 0));
    const loop = makeLoop(samples.slice(start), options.loop, cross);
    const gain = fromDb(options.rms ?? -18) / rmsOf(loop);
    const limit = fromDb(-1) / peakOf(loop);
    for (let i = 0; i < loop.length; i++) loop[i]! *= Math.min(gain, limit);
    const pad = Math.floor(RATE * LOOP_PAD);
    const padded = new Float32Array(loop.length + pad * 2);
    padded.set(loop.subarray(loop.length - pad), 0);
    padded.set(loop, pad);
    padded.set(loop.subarray(0, pad), pad + loop.length);
    return { samples: padded, loop: [LOOP_PAD, LOOP_PAD + loop.length / RATE] };
  }
  let cut = samples;
  if (options.from !== undefined || options.to !== undefined) {
    cut = samples.slice(
      Math.floor(RATE * (options.from ?? 0)),
      options.to === undefined ? samples.length : Math.floor(RATE * options.to),
    );
  }
  if (options.from === undefined) cut = trimSilence(cut);
  fade(cut, 0.002, false);
  fade(cut, options.fadeOut ?? 0.03, true);
  const gain = fromDb(options.peak ?? -1) / peakOf(cut);
  for (let i = 0; i < cut.length; i++) cut[i]! *= gain;
  return { samples: cut };
}

const scratch = join(CACHE, 'scratch');
mkdirSync(scratch, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.mp3')) rmSync(join(OUT, file));
}

const data: Record<string, { seconds: number; loop?: number[] }> = {};
const credits = new Map<string, string>();
let bytes = 0;
for (const [name, options] of Object.entries(SAMPLES)) {
  const path = await source(options.src);
  const result = process(decode(path, scratch), options);
  const out = join(OUT, `${name}.mp3`);
  encode(result.samples, out, scratch);
  bytes += readFileSync(out).length;
  const seconds = Math.round((result.samples.length / RATE) * 1000) / 1000;
  data[name] = result.loop
    ? { seconds, loop: result.loop.map((value) => Math.round(value * 1000) / 1000) }
    : { seconds };
  const { src } = options;
  const credit =
    src.kind === 'sonic-pi'
      ? `\`${src.name}\` from [Sonic Pi's sample set](https://github.com/sonic-pi-net/sonic-pi/tree/dev/etc/samples)`
      : `[${src.title}](https://freesound.org/s/${src.id}/) by ${src.author} on freesound.org`;
  credits.set(name, credit);
  console.log(
    `${name.padEnd(18)} ${seconds.toFixed(2).padStart(6)} s  peak ${db(peakOf(result.samples)).toFixed(1)} dB  rms ${db(rmsOf(result.samples)).toFixed(1)} dB`,
  );
}
rmSync(scratch, { recursive: true });

const lines = Object.entries(data).map(([name, info]) => {
  const loop = info.loop ? `, loop: [${info.loop.join(', ')}]` : '';
  const key = /^[a-z]+$/.test(name) ? name : `'${name}'`;
  return `  ${key}: { seconds: ${info.seconds}${loop} },`;
});
writeFileSync(
  DATA,
  `// Generated by scripts/build-audio.ts. Do not edit: change the script and run \`npm run build:audio\`.
import type { SampleInfo } from '../../engine/samples';

/** Every sound file in \`public/audio\`. */
export const SAMPLES = {
${lines.join('\n')}
} as const satisfies Record<string, SampleInfo>;

export type SampleName = keyof typeof SAMPLES;
`,
);

writeFileSync(
  join(OUT, 'CREDITS.md'),
  `# Sound credits

Every recording in this folder is in the public domain under the
[Creative Commons 0 licence](https://creativecommons.org/publicdomain/zero/1.0/).
\`scripts/build-audio.ts\` trims each one, sets its level and encodes it as MP3.

The table lists the source of each file.

| File | Source |
| --- | --- |
${[...credits].map(([name, credit]) => `| \`${name}.mp3\` | ${credit} |`).join('\n')}
`,
);

console.log(`\n${Object.keys(data).length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
