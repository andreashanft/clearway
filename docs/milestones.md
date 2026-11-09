# Milestones

This log records what each milestone delivers, what is still stubbed, how to test it, and where the build deviates from the [code brief](https://claude.ai/artifact/U7WFTEkYCNBqoMbKc4wo36) or the [design brief](https://claude.ai/artifact/CReom8skdLyjWosVMxfHDk), and why.

## Milestone 1: scaffold

### What works

- Vite, TypeScript, Three.js and Rapier, with strict ESLint rules, Prettier and Vitest.
- `WebGPURenderer` with automatic WebGL2 fallback, a `?webgl` override, device pixel ratio capped at 2, and a dynamic resolution scale hook.
- Rapier physics stepped by a fixed 60 Hz loop. Rendering interpolates between steps, and the loop pauses while the tab is hidden.
- A typed event bus for game-to-UI events and UI-to-game commands.
- The `?debug` overlay: frame rate, frame time, backend, draw calls, triangles, physics step time, body count and a time-scale slider.
- Design tokens from the design system as CSS variables, and self-hosted fonts.
- PWA manifest (fullscreen, landscape), offline cache and app icons.
- A test scene with 24 falling crates that proves rendering, physics and interpolation work together.

### Stubbed

- The test scene stands in for the game; milestone 2 replaces it with terrain and a vehicle.

### How to test

1. Run `npm run dev` and open the network URL on a phone.
2. Add `?debug` to the URL and check that the overlay shows about 60 fps.
3. Add `?debug&webgl` and check that the overlay shows `WEBGL2`.

### Deviations

- **Three.js r187 instead of r185.** r187 is the current release; the brief named the release that was current when it was written.
- **TypeScript 6.0.3, not 7.0.** `typescript-eslint` supports TypeScript below 6.1 only, and strict type-aware linting is worth more than the newer compiler.
- **Fonts come from `@fontsource` packages.** Vite bundles them, so they're self-hosted and cached offline as the brief asks.
- **Howler.js isn't installed yet.** Audio arrives in milestone 7.
- **The generic event bus lives in `src/engine/events.ts`.** The game's own event list will live in `src/game/events.ts`, as the brief's file layout shows.
- **Development-only audit warnings.** `npm audit` reports moderate issues in ESLint's and Workbox's build-time dependencies. The shipped game has no known vulnerabilities (`npm audit --omit=dev`).

## Milestone 2: drive

### What works

- Hollow Creek's terrain: a 256 × 256 heightmap at 4 m per pixel (1,020 m square), a baked colour map with fields, the dirt route and the creek, about 1,200 trees, bushes and rocks, and a water strip. `npm run terrain` bakes these from `levels/<id>.terrain.json`.
- Faceted low-poly ground in 64 chunks that the camera culls, a matching Rapier heightfield collider, and walls at the map edge.
- Morning, dusk and noon lighting presets with a shadow box that follows the camera, and a sky-to-ground environment map so metal and glass reflect.
- The Bruiser: a detailed procedural bulldozer with animated crawler tracks, a liftable blade with a glowing edge, cab, exhaust and lights, driven by Rapier's ray-cast vehicle controller.
- Point-to-drive on the touch stick and the gamepad stick: the vehicle turns towards the stick, slows for sharp turns and reverses when the stick points behind it.
- Classic controls on the keyboard (W/S or arrows to drive and reverse, A/D to steer), Shift to brake, Space for Action. On a gamepad, holding a trigger switches to classic: stick steers, right trigger accelerates, left trigger brakes and reverses.
- Floating touch stick, Action and Brake buttons as in the phone mock, shown only after touch input.
- Follow camera: 30° field of view across the shorter screen side, pitched 55°, look-ahead in the direction of travel, three zoom presets and 45° rotation steps. Pinch and twist on touch, Q/R and Z/X or the mouse wheel on the keyboard, bumpers and the d-pad on a gamepad.
- The Bruiser's Action toggles push mode, which lifts the blade and its collider.

### Stubbed

- Steering assist towards the route waits for the route in milestone 4.
- Trees and bushes don't collide yet; milestone 3 makes them knockable.
- The Enter/Exit button and the classic and left-handed touch layouts arrive with milestones 5 and 6.

### How to test

1. Run `npm run dev` and open the network URL on a phone in landscape.
2. Put your left thumb anywhere in the lower-left area and point where you want to drive.
3. Hold **BRAKE**, and tap **BLADE** to lift and lower the blade.
4. Pinch to change zoom and twist two fingers to rotate the view.
5. On a desktop, drive with W/A/S/D, zoom with the mouse wheel and rotate with Q and R.
6. Add `?debug` to see speed, steering and throttle. The debug build also exposes `window.clearway` for console checks.

Measured on a desktop browser with WebGPU: 24–35 draw calls and 15–20k triangles across the three zoom presets.

### Deviations

- **Zoom presets are ground spans, not camera distances.** At a 30° field of view, a 45 m camera distance shows only about 24 m of ground, far tighter than the mocks. The presets now mean 25, 45 and 70 m of ground across the shorter screen side (camera distances of about 47, 84 and 131 m).
- **The keyboard uses classic steering.** Eight keyboard directions make point-to-drive jerky, so W/S drive and reverse and A/D steer. Touch and gamepad sticks use point-to-drive as the brief asks.
- **Level positions are `[x, z]` ground points.** Heights always come from the terrain, so the brief's `[x, 0, z]` triples became pairs.
- **Terrain is baked from a recipe.** The heightmap stays a hand-editable 8-bit PNG as the brief asks, but a script generates it, the colour map and the props from slopes, hills, channels and fields, and flattens the route and building pads.
- **The Bruiser runs on four hidden ray-cast wheels.** Front and rear wheels steer in opposite directions and a yaw assist lets it pivot like a crawler.
- **All props share one `BatchedMesh`.** Each prop is culled on its own and there is one material, which keeps draw calls low.

## Milestone 3: destroy

### What works

- Parametric buildings in seven styles: shed, house, open hay barn, stone barn, fuel kiosk, octagonal silo and fence. Each is built from pre-fractured pieces (wall panels with windows and doors, roof slabs, gables, chimneys, posts, hay bales, silo rings) and sits on a concrete foundation.
- The four strengths from the brief: shed 100, house 250, brick 600 and concrete 1500 HP.
- Impact damage of ½ × mass × speed² along the contact normal, scaled at 3,500 J per HP, with a 3 m/s minimum and a 0.4 s cooldown per vehicle and building. Concrete ignores every vehicle except the Tumbler.
- At 50% HP the pieces shift and darken so seams open up. At 0 HP every piece becomes a physics chunk thrown away from the hit, and the vehicle smashes on through at 80% of its speed.
- After 4 s each chunk turns into non-colliding rubble, and a settled building is baked back into a single mesh. At most 200 chunks fly at once.
- TNT crates that the Bruiser lights on first contact, with a 10 s fuse shown as a ring that shrinks from cyan to red. The blast deals 800 damage within 8 m, pushes bodies away and sets off nearby crates.
- The fuel kiosk explodes when destroyed and takes the nearby fence with it.
- Dust, debris, fireballs, smoke, a ground shockwave and a light flash.
- Trees topple and bushes flatten as vehicles drive through them or explosions go off.
- Hollow Creek's obstacles at the brief's route distances (90, 150, 210, 330, 390 and 450 m), eight more farm buildings for free roam, and two TNT crates by the stone barn.
- A vehicle that ends up below the terrain is put back on top of it.

### Stubbed

- Obstacles aren't linked to the Hauler yet; milestone 4 adds it.
- Hit-stop and camera shake arrive in milestone 7. The game already sends `impact` events for them.

### How to test

1. Run `npm run dev` and drive the Bruiser into the tool shed at 30 km/h or faster. One ram brings it down.
2. Ram the farmhouse twice. After the first ram its seams open and dust rises.
3. Ram the fuel kiosk and watch it explode and flatten the fence beside it.
4. Push a TNT crate against the stone barn (east of the creek) and back off. The ring counts down for 10 s.
5. Drive through trees and bushes.

`npm test` includes headless destruction tests that run real Rapier physics: cracking, collapse, rubble conversion and concrete immunity.

### Deviations

- **Blasts do full damage within 2 m, and concrete takes double damage from explosions.** With 800 TNT damage and 1500 HP concrete, one crate can't drop a concrete building. Level 2's concrete signal box has only one crate, so the brief needs one crate to be enough. A crate against a concrete wall now deals 1,600.
- **3,500 J per HP.** The brief says "scaled to HP" without a scale. At this value a shed falls to one ram at 30 km/h and a house to two rams at the 37 km/h a short run-up gives.
- **The Bruiser's push mode halves its impact damage.** The brief names the action but not its effect. Push mode lifts the blade so it nudges crates instead of ramming them.
- **Kiosk blast: 450 damage within 9 m.** The brief says "small radius". This size reaches the fence the level design says it damages.
- **Buildings share one batched mesh and vehicles one vertex-attribute material.** Each intact or flattened building is a single draw; a vehicle is about five. A frame costs 15–35 draws and under 30k triangles on Hollow Creek.

## Milestone 4: Hauler loop

### What works

- The Hauler: a long autonomous carrier with an armoured tractor unit, a caged reactor vessel with a pulsing red core and light, four corner beacons that strobe under 5 s to impact, rear hazard chevrons and twelve spinning wheels.
- It runs as a kinematic body along the route spline at the level's speed, pitched to the terrain, and never steers or stops. A sensor ahead of the bumper fails the level on touching a building, vehicle or TNT crate. Rubble never counts.
- Route obstacles come from sweeping the sensor's footprint along the route; twin buildings share one obstacle. The countdown to the next impact runs from the Hauler's nose.
- The route shows as red chevrons that scroll at the Hauler's pace (shape plus colour, for colour-blind players), over a faint band as wide as the Hauler. Each obstacle has a red ground outline and a numbered floating marker that disappear when it is cleared.
- The level flow: a 5 s start delay, then clearing, "Path clear" (the Hauler hurries to the safe zone), free roam with a Finish button, and Results with the medal and what silver or gold still need.
- Failure: the Hauler explodes (damaging everything nearby), the game plays 2.2 s of slow motion, and the "Hauler destroyed" panel offers Retry and Quit.
- Bronze, silver and gold rules from the brief, with tests.
- Steering assist: stick directions within 25° of the route are eased onto it near the road.
- Camera nudge: under 5 s to impact, the camera pulls towards the Hauler to keep both in view.
- Easy-mode Hauler stall (8 s, once per level) is implemented; Settings turns it on in milestone 5.
- Retry and Next restart with a fresh physics world.
- Debug tools under `?debug`: level select, invincible Hauler, collider wireframes, a session readout, Finish free roam and Print arrivals.
- `node scripts/level-report.ts <level> [--fix]` prints each obstacle's arrival against the brief and can slide obstacles along the route to match. A test fails if any level drifts more than ±10%. Hollow Creek now matches exactly: 0:30, 0:50, 1:10, 1:50, 2:10 and 2:30.

### Stubbed

- The HUD and panels are functional placeholders on the design tokens; milestone 5 replaces them with the designed screens, a pause menu, the Hauler pointer and the mini-map.
- Beacons and the relay dish arrive in milestone 7; until then they count as complete for medals.
- Best times and medals aren't saved yet (milestone 5).
- The short replay after a failure and hit-stop arrive in milestone 7.

### How to test

1. Run `npm run dev`. The Hauler waits 5 s, then rolls; the route bar counts down to the tool shed.
2. Do nothing: at 0:35 the Hauler hits the tool shed, explodes in slow motion and the fail panel appears. Choose **RETRY**.
3. Clear all six obstacles in time (the stone barn needs a TNT crate). "PATH CLEAR" plays, then free roam starts.
4. Flatten more buildings, then choose **FINISH** to see the medal.
5. With `?debug`, tick **Invincible Hauler** to practise, or choose **Print arrivals** to log arrival times.

### Deviations

- **Arrival times count from when the Hauler starts rolling.** They exclude the 5 s start delay, as the brief's tables do (90 m at 3 m/s is 0:30).
- **A route distance is where the Hauler's nose meets the obstacle.** The level files place buildings so the first contact happens at the brief's distance.
- **Only the front sensor fails the level.** Brushing the Hauler's side pushes your vehicle away instead. The brief puts the sensor "slightly ahead of its bumper".
- **After "Path clear" the Hauler speeds up 2.5×** to reach the safe zone while the banner plays.
- **Fixed in milestone 3's blasts:** explosions now push bodies away. Applying impulses inside Rapier's shape query left the world borrowed, so the push silently did nothing and the world couldn't be freed. A regression test covers it.
