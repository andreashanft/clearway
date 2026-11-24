# Clearway

Clearway is a demolition game for the browser. You clear a straight path through a city before an unstoppable carrier with antimatter arrives. The game runs on phones, tablets and desktops as an installable progressive web app (PWA).

The game is being rebuilt in a new direction. The finished game lets you pick a real location on a world map, recreates that area from OpenStreetMap data, and gives you one of three vehicles: a bulldozer, a flail car or a rocket buggy.

Today the build contains the first step of that rebuild: a test yard in which you drive the three vehicles. The [milestones](#milestones) section lists what works and what comes next.

## Run the game

You need Node.js 22.12 or later.

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open the address that the server prints.

To test on a phone or tablet in the same network, start the server with `npm run dev -- --host` and open the network address on the device.

## Build the game

The following command checks the types and writes a static site to `dist/`:

```bash
npm run build
```

You can host the `dist/` folder on any static web server. All asset paths are relative.

## Check the code

The following command runs the type check, the linter, the format check and the unit tests:

```bash
npm run check
```

## Controls

The vehicles use car controls. The steering is relative to the vehicle, as in a racing game.

| Action                | Touch                           | Keyboard          | Gamepad     |
| --------------------- | ------------------------------- | ----------------- | ----------- |
| Accelerate            | **GAS**                         | W or ↑            | RT          |
| Brake, then reverse   | **BRAKE**                       | S or ↓            | LT          |
| Steer                 | Left thumb: slide left or right | A and D, or ← →   | Left stick  |
| Handbrake             | **DRIFT**                       | Shift             | X           |
| Switch camera view    | **Chase view** in the yard bar  | C                 | Y           |
| Rotate the fixed view | Two-finger twist                | Q and R           | LB and RB   |
| Zoom                  | Pinch                           | Wheel, or Z and X | Right stick |
| Pause                 | Pause button                    | Esc               | Start       |

The handbrake makes the vehicle slide. A fast turn at nearly full lock with the throttle held makes it slide too. In a slide, the steering sets how far the nose points into the turn. Steer to the centre or against the slide to straighten out. The buggy slides furthest, and the bulldozer barely slides.

The camera has two views. The chase view stays behind the vehicle. The fixed view looks down from a high point and keeps its direction.

## Test yard

The test yard is a flat area for trying out how the vehicles drive. **Play** on the title screen opens it. It holds a main straight with a line every 10 m, two slalom lanes with cones, three turning circles, a small street grid and a row of buildings to ram.

The bar at the top of the yard switches the vehicle and the camera view, resets the yard and counts the cones that you knocked over. On a keyboard, the keys 1, 2 and 3 choose the vehicle and Backspace resets the yard.

With `?debug` in the address, the debug overlay adds two panels:

- **Handling** changes the tuning of the current vehicle while the game runs, for example the top speed, the turning circle, the grip and the slide. **Copy values** puts the values on the clipboard.
- **Chase camera** changes the distance, the pitch and the field of view of the chase view.

A reload of the page restores the built-in values. `src/game/vehicles/specs.ts` holds them.

**Measure handling** in the debug overlay, or `clearway.measure()` in the browser console, drives each vehicle through a scripted test. It reports the top speed, the time to top speed, the stopping distance, the turning circles, the slide angle, a handbrake turn and the slalom time.

## URL parameters

| Parameter | Effect                                                                |
| --------- | --------------------------------------------------------------------- |
| `?yard`   | Skips the title screen and starts in the test yard.                   |
| `?debug`  | Shows the debug overlay and adds the `window.clearway` console tools. |
| `?webgl`  | Forces the WebGL2 backend. Without it, the game prefers WebGPU.       |
| `?touch`  | Shows the touch controls on a device without a touch screen.          |

## Technology

The project pins exact package versions.

| Layer     | Package                                         | Version |
| --------- | ----------------------------------------------- | ------- |
| Rendering | `three` (`WebGPURenderer` with WebGL2 fallback) | 0.187.0 |
| Physics   | `@dimforge/rapier3d-compat`                     | 0.21.0  |
| Language  | `typescript`                                    | 6.0.3   |
| Build     | `vite`                                          | 8.3.8   |
| Audio     | `howler`                                        | 2.2.4   |
| PWA       | `vite-plugin-pwa`                               | 2.0.0   |
| Tests     | `vitest`                                        | 5.1.0   |
| Linting   | `eslint` with `typescript-eslint`               | 10.14.0 |
| Format    | `prettier`                                      | 3.10.1  |

The user interface is plain DOM and CSS above the canvas. `src/ui/tokens.css` holds the design tokens.

## Project layout

| Path          | Content                                                     |
| ------------- | ----------------------------------------------------------- |
| `src/main.ts` | Boot sequence.                                              |
| `src/app.ts`  | Application shell: renderer, input devices, frame loop.     |
| `src/engine/` | Renderer, physics world, fixed-step loop and input devices. |
| `src/game/`   | Game simulation: the area, the vehicles and the camera.     |
| `src/ui/`     | Design tokens, fonts and DOM user interface.                |
| `src/debug/`  | Debug overlay, tuning panels and console tools.             |
| `tests/`      | Unit tests.                                                 |
| `tools/`      | Script that generates the app icons.                        |
| `public/`     | Static files: icons, the favicon and the sounds.            |
| `docs/`       | Milestone notes.                                            |

`src/game/yard.ts` builds the test yard in code. All positions are `[x, z]` pairs in metres: X points east and Z points south. `src/game/level.ts` documents every field of an area.

## Milestones

[docs/milestones.md](docs/milestones.md) lists, for each milestone, what works, what is stubbed, how to test it, and where the build deviates from the plan on purpose.

| #   | Milestone                                                 | State     |
| --- | --------------------------------------------------------- | --------- |
| 1   | Car controls and faster, more precise handling            | In review |
| 2   | Destruction with one-hit breaks, collapse and score       | Open      |
| 3   | Weapons: boost, flail, and rockets with ammunition crates | Open      |
| 4   | 3D world of a real location from OpenStreetMap tiles      | Open      |
| 5   | Seeded path, antimatter carrier and black hole            | Open      |
| 6   | Screens: location picker, vehicle selection, HUD, results | Open      |
| 7   | Sound, performance, offline cache and documentation       | Open      |

The game still contains parts of an earlier prototype that later milestones replace: the Hauler, the medals and the results screens. No area uses them at the moment.

## Licence

Clearway is free software under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE). The fonts use the SIL Open Font License 1.1. The sound recordings are in the public domain under the Creative Commons 0 licence; [public/audio/CREDITS.md](public/audio/CREDITS.md) lists their sources.
