# Clearway

Clearway is a demolition-puzzle game for the browser. An unstoppable Hauler drives one straight line across each level, and you clear everything in its way before it arrives. The game runs on phones, tablets and desktops as an installable progressive web app (PWA).

The game is a prototype. The [milestones](#milestones) section lists what works today.

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

| Action                 | Touch                       | Keyboard          | Gamepad                      |
| ---------------------- | --------------------------- | ----------------- | ---------------------------- |
| Drive                  | Left thumb: point the stick | W A S D or arrows | Left stick steers, RT and LT |
| Vehicle action         | Large round button          | Space             | A                            |
| Brake                  | **BRAKE**                   | Shift             | LT                           |
| Enter or leave vehicle | **EXIT**                    | E                 | Y                            |
| Rotate the view by 45° | Two-finger twist            | Q and R           | LB and RB                    |
| Zoom                   | Pinch                       | Wheel, or Z and X | Right stick                  |
| Pause                  | Pause button                | Esc               | Start                        |

Touch and keyboard use point-to-drive: you point where the vehicle should go, and it accelerates and turns there. To reverse, point behind the vehicle.

## URL parameters

| Parameter   | Effect                                                                |
| ----------- | --------------------------------------------------------------------- |
| `?debug`    | Shows the debug overlay and adds the `window.clearway` console tools. |
| `?webgl`    | Forces the WebGL2 backend. Without it, the game prefers WebGPU.       |
| `?touch`    | Shows the touch controls on a device without a touch screen.          |
| `?level=ID` | Starts in the level with this id, for example `?level=hollow-creek`.  |

## Technology

The project pins exact package versions.

| Layer     | Package                                         | Version |
| --------- | ----------------------------------------------- | ------- |
| Rendering | `three` (`WebGPURenderer` with WebGL2 fallback) | 0.187.0 |
| Physics   | `@dimforge/rapier3d-compat`                     | 0.21.0  |
| Language  | `typescript`                                    | 6.0.3   |
| Build     | `vite`                                          | 8.3.8   |
| PWA       | `vite-plugin-pwa`                               | 2.0.0   |
| Tests     | `vitest`                                        | 5.1.0   |
| Linting   | `eslint` with `typescript-eslint`               | 10.14.0 |
| Format    | `prettier`                                      | 3.10.1  |

The user interface is plain DOM and CSS above the canvas. `src/ui/tokens.css` holds the design tokens.

## Project layout

| Path          | Content                                                        |
| ------------- | -------------------------------------------------------------- |
| `src/main.ts` | Boot sequence.                                                 |
| `src/app.ts`  | Application shell: renderer, input devices, frame loop.        |
| `src/engine/` | Renderer, physics world, fixed-step loop and input devices.    |
| `src/game/`   | Game simulation: level, terrain, vehicles and camera.          |
| `src/ui/`     | Design tokens, fonts and DOM user interface.                   |
| `src/debug/`  | Debug overlay and console tools.                               |
| `levels/`     | One JSON file, one terrain recipe and one heightmap per level. |
| `tests/`      | Unit tests.                                                    |
| `tools/`      | Scripts that generate assets: app icons and heightmaps.        |
| `public/`     | Static files: icons and the favicon.                           |
| `docs/`       | Milestone notes.                                               |

## Levels

Each level is one file, `levels/ID.json`. All positions are `[x, z]` pairs in metres: X points east and Z points south. `src/game/level.ts` documents every field.

The terrain comes from a greyscale heightmap, `levels/ID.height.png`. A tool paints the heightmap from the recipe in `levels/ID.terrain.json`. After you change a recipe or move a building, repaint the heightmaps:

```bash
npm run build:terrain
```

## Milestones

[docs/milestones.md](docs/milestones.md) lists, for each milestone, what works, what is stubbed, how to test it on a phone, and where the build deviates from the briefs on purpose.

| #   | Milestone           | State   |
| --- | ------------------- | ------- |
| 1   | Scaffold            | Done    |
| 2   | Drive               | Done    |
| 3   | Destroy             | Done    |
| 4   | Hauler loop         | Planned |
| 5   | Screens             | Planned |
| 6   | Vehicles and levels | Planned |
| 7   | Polish              | Planned |

## Licence

Clearway is free software under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE). The fonts use the SIL Open Font License 1.1.
