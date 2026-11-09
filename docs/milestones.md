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

## Milestone 5: screens

### What works

- Every screen in the brief's flow, built on the design tokens and checked against the mocks at phone landscape (844 × 390), phone portrait (390 × 844) and desktop (1440 × 900):
  - **Title** over a live Hollow Creek where the Hauler crosses the first field, with a portrait layout.
  - **Campaign** with map thumbnails, medal, best time, NEXT UP and lock states (next level unlocks on bronze).
  - **Briefing** with a camera fly-over of the route, Skip, route length, first impact, best medal, vehicles and TNT, then a 3-2-1 countdown.
  - **Gameplay HUD**: pause button, counters (with the level name on large screens), route bar with amber next-impact tick, hint pill, mini-map (tap to collapse on phones, double-tap or double-click to recentre), an edge pointer to the Hauler with its distance, and on keyboard the vehicle card and key hints.
  - **Pause** over the blurred scene: Resume, Restart, Settings, Quit to map and live stats.
  - **Hauler destroyed**: what it hit and when, how many obstacles were cleared, a level tip, Retry and Quit to map.
  - **Path clear** banner, then free roam with a Finish level button.
  - **Results**: medal, new best time, progress bars with the 80% silver marker, what the next medal needs, and Keep exploring, Replay and Campaign.
  - **Settings** in three tabs: touch layout (point-to-drive or classic), left-handed, steering assist, auto-skid, easy mode, haptics, graphics quality, HUD scale, mini-map, camera shake, pattern markings, volumes, tension music and subtitles.
  - **Rotate device** card that pauses play on a phone held upright and resumes on landscape.
  - **How to play** summary.
- Settings apply at once: HUD scale, graphics quality (pixel ratio and shadow resolution), classic and left-handed touch layouts, steering assist, mini-map, route chevrons, haptics on impacts, and easy mode from the next attempt.
- Local save in `clearway.save.v1`: per-level best medal, best clear time, building and beacon shares, dish, and settings, with a version number and a migration hook. It falls back to defaults when storage is blocked.
- Level hints (start and per obstacle), fail tips and a briefing description in the level file.

### Stubbed

- Levels 2 and 3 show as "built in milestone 6" on the campaign map.
- Beacons, the relay dish, the failure replay ("Watch again"), music, effects volume and subtitles take effect in milestone 7.
- Auto-skid applies to the Fishtail in milestone 6.

### How to test

1. Open the game; the title shows the Hauler crossing Hollow Creek. Choose **PLAY**.
2. Choose **BRIEFING**, watch or skip the fly-over, then **START**.
3. Press Esc (or the pause button) and try **Settings**: switch to **Classic** and change **HUD scale**.
4. Let the Hauler hit something to see the fail screen, or clear the route and choose **Finish level** for Results.
5. Reload: the medal and best time stay on the campaign card.
6. On a phone, hold it upright during play to see the rotate card.

### Deviations

- **The mini-map is drawn with Canvas 2D from game data**, not a second orthographic 3D render. It reuses the baked colour map as its background and costs no draw calls.
- **Medal count on the title and campaign counts bronze 1, silver 2 and gold 3**, out of 9 for three levels. The mocks show "1/9" next to a silver medal, which doesn't add up under either reading.
- **"Watch again" is left out of the fail screen** until milestone 7 adds the replay.
- **Next level goes to the campaign map**, as the mock's link does, where the newly unlocked level shows NEXT UP.

## Milestone 6: vehicles and levels

### What works

- **Pilot on foot.** Press E (or the context button) to get out, walk at 12 km/h and climb into any unlocked vehicle within reach. The context pill names what Enter does, such as "Enter Railbed".
- **Fishtail**, the Ferrow Junction starter. Hold Action to skid: the armoured tail does 1.8× damage while skidding and 0.9× otherwise, and the cab only 0.4×. The auto-skid setting skids on hard turns, and skids leave ghost trails.
- **Liftoff**, the Cinder Quarry starter. It reaches 110 km/h, and Action fires a 1-second boost that recharges in 3 seconds. Landing on a roof does 14× damage and ramming does 2.5×.
- **Tumbler.** Action curls it into a 90 km/h roll for 1.5 seconds. Rolls that hit within 2 seconds of each other do 25% more damage per hit, up to three times. It's the only vehicle that damages concrete, and it stays locked in its hangar until the hangar falls.
- **Railbed.** It drives only along its rails. Stop it within 3 m of the glowing slot and it locks in, folds down two side plates and bridges the rail cutting; the slot turns green. The Hauler crosses only a bridged cutting, and an open one ends the run.
- **Twelve new building styles:** terrace row, corner shop, signal box, warehouse, station, site cabin, conveyor gantry, hangar, crusher, chimney, workers' hut and shipping container.
- **Ferrow Junction** (640 m at 4 m/s, dusk) and **Cinder Quarry** (760 m at 5 m/s, noon), with every obstacle at the brief's distance, hints, fail tips and briefing text. The campaign unlocks them in order, and the briefing lists every machine, including the Railbed and the locked Tumbler.
- **Terrain baker additions:** rounded-rectangle pits for the quarry terraces, channels cut after the road is levelled (the rail cutting), per-channel colours, and trees kept out of the pit.
- **Level checks in the unit tests:** each level's route length and Hauler time match the campaign, no vehicle or crate starts in the Hauler's path, a locked vehicle starts inside the building that frees it, and the Railbed slot sits across the route gap.

### Stubbed

- Beacons and the relay dish (on the station roof in Ferrow Junction and on a ledge in Cinder Quarry), sound and music, hit-stop and camera shake, and the failure replay arrive in milestone 7.
- The station and the stacked containers are scenery until the relay dish needs them.

### How to test

1. Open `/?level=ferrow-junction`, or earn a medal on Hollow Creek to unlock it.
2. Hold Space to skid the Fishtail's tail into terrace A on both sides of the street.
3. Drive south along the rails to the Railbed, press E to get out and E again to climb in. Drive it into the glowing slot over the cutting and watch the plates fold down.
4. Open `/?level=cinder-quarry`. Drive the Liftoff off the rim onto the site cabins, then boost off the spoil heap beside the road into the conveyor gantry.
5. Land on the hangar roof, switch to the freed Tumbler and roll it into the crushers twice in quick succession.
6. Run `npm test` for the level layout checks.

### Deviations

- **The rail crosses the route at 260 m**, as the obstacle table requires. The level map draws the crossing at x ≈ 201, which on a 640 m route falls at about 310 m, so the rail moves to x ≈ 174 and the campaign thumbnail follows it.
- **The Railbed tops out at 45 km/h, not 30 km/h.** The shop and pub fall at about 0:50 and the Hauler reaches the cutting at 1:10. At 30 km/h, driving the Railbed 150 m alone takes 21 seconds, which leaves no time to reach it. At 45 km/h the run takes 14 seconds.
- **Drive to the Railbed rather than walk.** The brief's "walk to the Railbed 150 m down the line" takes 45 seconds at the pilot's 12 km/h. Drive the Fishtail there and get out beside it.
- **The Railbed folds down side plates.** Its 3 m deck is narrower than the cutting that a 2 m heightmap can draw, so two hinged plates span the banks once it locks in. The deck sits flush with the road, within 0.1 m.
- **The rail cutting counts as an obstacle.** It has a number, an outline and a place in the obstacle count, and it clears when the Railbed locks in.
- **The Tumbler stands about 5.5 m tall, not 12 m.** At 12 m it would not fit in a hangar the Liftoff can land on, and it would hide the road at the closest zoom.
- **Landings are measured from the wheels.** Ray-cast wheels touch a roof without the chassis ever colliding, so the vehicle reports a touchdown on a building with its fall speed, and the building takes damage as if hit from above.
- **The quarry floor ends at y = 245 on the level map, not 255**, so the last straight runs on the second terrace instead of along the edge of the floor.
- **The conveyor gantry's belt runs 3.8–6.3 m above the ground** and spans 32 m, so a boost off the spoil heap hits it rather than flying over.
- **The site cabins fall to a plain drop off the rim.** A boost from the rim carries the Liftoff over them, so the hint says to drive off at a moderate speed.

## Milestone 7: polish

### What works

- **Beacons and relay dishes.** Hollow Creek has 30 beacons along its hedgerows and a dish under hay bales behind the stone barn. Ferrow Junction has 40 in the back lanes, beside the rails and round the goods yard, and a dish on the station roof. Cinder Quarry has 50 on the rim, the terraces, the floor and the spoil heap, and a dish on a rock ledge that only a long Liftoff boost reaches.
  - Drive or walk past a beacon to light it: it chimes, turns green and counts on the HUD, with each beacon in a quick run chiming a note higher.
  - The mini-map shows the beacons still to find, and the free-roam strip lists what gold still needs.
  - The pause screen, results, medals and the save all count beacons and the dish.
- **Hit-stop and camera shake.** Hard hits and blasts freeze the action for 30–100 ms and shake the camera in proportion to the impact. The **Camera shake** setting switches between full and reduced shake.
- **Sound and dynamic music**, all synthesised with Web Audio:
  - A funk/surf loop (drums, bass, organ stabs and a twangy lead) that speeds up from 104 to 144 beats per minute and adds layers as the countdown shrinks. An alarm beeps on the beat in the last seconds before an impact. **Tension music** off keeps an even pace.
  - Stingers for Path clear, a failure and a medal; the music fades on failure and muffles in menus and pause.
  - Engine hum per machine that follows speed, skid, boost and roll loops, the Hauler's drone growing as it gets close, hits, collapses, blasts, lit fuses, beacon chimes, a radio squelch before crew hints, and button clicks.
  - Music, effects and voice volumes from Settings. Audio starts on the first tap or key press and suspends while the page is hidden.
- **Performance.**
  - Dynamic resolution drops the render scale by 10% steps when frames take longer than 18 ms and raises it below 14 ms, down to half resolution. On a 60 Hz display, it tries a step up after 6 steady seconds and backs off for twice as long if that fails.
  - Rendering caps at 60 fps on battery (phones and tablets, and laptops that report it).
  - The debug overlay shows the render scale.

### Measured

These numbers come from the built-in browser on a desktop with `?debug`:

| Scene                                           | Backend | Draw calls | Triangles | CPU per frame                 |
| ----------------------------------------------- | ------- | ---------- | --------- | ----------------------------- |
| Cinder Quarry, four crushers collapsing at once | WebGPU  | about 50   | about 26k | 2.1 ms median, 9 ms 95th pct. |
| Ferrow Junction, the high street                | WebGL2  | 24         | about 33k | not measured                  |
| Ferrow Junction, the shop, pub and rail cutting | WebGPU  | 59         | about 45k | not measured                  |

Every scene is well inside the phone budget of 150 draw calls and 300k triangles.

### Stubbed

- **Voice lines.** Crew hints show as text, with a radio squelch on the voice volume, but nothing is spoken: there are no recorded lines yet.
- **The failure replay ("Watch again").** The Hauler's explosion plays in slow motion as a freeze-frame, then the fail screen offers Retry and Quit.

### How to test on devices

The brief asks for a check on a real iPhone, an Android phone, an iPad and a desktop browser at every milestone. Real devices weren't available while building, so work through this list on each one:

1. Start the dev server with `npm run dev`; it listens on your local network.
2. On each device, open the **Network** address that Vite prints, such as `http://192.168.1.20:5173/`.
3. Play each level to a medal with touch only (phones and iPad) and with the keyboard only (desktop).
4. Check that sound starts after the first tap and stops when you switch apps.
5. Add `?debug` and watch the frame rate and render scale in Cinder Quarry while the crushers fall.
6. For the installed app, build with `npm run build`, host `dist/` on any static host with HTTPS, add it to the home screen, and check that it launches fullscreen in landscape.

### Acceptance checklist

This is where each item in the code brief's checklist stands:

| Item                                                                | Status                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| All 3 levels can be finished with touch only and with keyboard only | Keyboard and touch controls work in the browser and in phone emulation. A full touch-only run needs a real device. |
| Hauler arrivals within ±10% of the brief                            | Verified: every obstacle within 0.1%, checked by unit tests.                                                       |
| The Hauler touching any obstacle fails the level; rubble never does | Verified in play; unit tests cover the rubble conversion.                                                          |
| Every screen reachable and matching the mocks at all four sizes     | Verified in milestone 5 at phone landscape, phone portrait and desktop; the HUD counters adapt at iPad widths.     |
| Medals, best times and settings persist across reloads              | Verified.                                                                                                          |
| 60 fps on an iPhone 13-class phone in Level 3's busiest moment      | Budgets met on desktop and dynamic resolution in place. Needs a real-device run.                                   |
| Installs to the home screen and launches fullscreen in landscape    | Manifest and service worker in place. Needs a real-device run.                                                     |
| No _Blast Corps_ names, art or audio in the repo                    | Verified: every name, model, sound and piece of music is original.                                                 |

### Deviations

- **Sound is synthesised with Web Audio, not played through Howler.js.** The brief suggests Howler with free sound effects. Synthesis needs no downloaded files, which keeps the repository free of third-party audio and its licences, and Howler's main features (sprite sheets and file decoding) don't apply. The engine handles the iOS unlock-on-tap itself.
- **The Ferrow Junction dish falls when the station falls.** The brief puts it on the station roof, reached by a ramp of stacked containers. Buildings can't stack yet, so destroy the station and collect the dish from the rubble, which gold needs anyway.
- **The Hollow Creek dish peeks out of the hay bales.** It can only be collected once the bales fall, and the glimpse hints at where it is.
- **The HUD shows the level name only from 1400 px wide.** Between iPad and desktop widths, the obstacles and beacons counters need the room beside the route panel.

## After milestone 7: straight routes, points and debris

These changes follow play-testing feedback and replace parts of the brief's level design.

### What changed

- **The Hauler drives one straight line across each level.** It still never steers. Each level keeps its theme and the brief's obstacle distances, but now has a believable layout that the line cuts across, instead of buildings standing on a winding road:
  - **Hollow Creek:** two farms along Hollow Lane and Ridge Lane, a filling station on Creek Road, the creek (which the Hauler fords) and a grain yard on Mill Road.
  - **Ferrow Junction:** a street grid with terraces facing each other across Station Road and Victoria Street, a corner shop and pub at the High Street crossroads, the railway in its cutting at right angles to the line, and the goods yard.
  - **Cinder Quarry:** the line runs due east down the terraces, across the pit floor and out through the crushing plant and the workers' village. The map grows to 1 km so the 760 m line fits.
- **Only buildings on the line are obstacles.** Every other building is a bonus.
- **Points.**
  - Every destroyed building scores by strength: shed 50, house 100, brick 250, concrete 500. Fences score 20, hay bales 30 and containers 80.
  - Knocked-over trees score 10, and bushes and rocks 5.
  - Each beacon scores 25, the relay dish 500 and clearing the path 1,000.
  - The HUD shows the score, with a pop-up over each building as it falls (cyan for a bonus). The pause screen, results and campaign cards show the score, and the best score is saved per level.
  - Medals still follow the brief's rules.
- **Debris no longer gets in the way.** Flying chunks land on the ground, on buildings and on each other, but pass through vehicles, the pilot and crates. After 4 seconds they shrink into the ground over 0.8 s and disappear, leaving the foundation.

### Tooling

- The terrain baker draws roads (`roads` in the terrain file, levelled and painted). The Hauler's line can be graded without paint (`route.level`, `route.paint`), as in the quarry. Building pads now sit at the graded height, and water sits under any road that crosses it.
- The mini-map frames the whole play area at its own shape.
- The campaign thumbnails are drawn from the level and terrain files.

### Deviations

- **The routes are straight.** The brief describes an S-curve for Hollow Creek and hairpins for Ferrow Junction and Cinder Quarry; the obstacle distances and arrival times are unchanged.
- **The Hauler fords the creek** in Hollow Creek rather than crossing on a road.
