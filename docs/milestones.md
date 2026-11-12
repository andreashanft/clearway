# Milestones

This file records each milestone of the Clearway prototype: what works, what is stubbed, how to test it on a phone, and where the build deviates from the briefs on purpose.

To test on a phone, start the development server with `npm run dev -- --host` and open the network address on the phone. Both devices must be in the same network.

## Milestone 1: scaffold

**Works**

- Vite, TypeScript, Three.js and Rapier run together with pinned versions.
- The simulation advances in fixed 60 Hz steps. The renderer interpolates between steps.
- The renderer uses WebGPU and falls back to WebGL2. `?webgl` forces WebGL2.
- The PWA manifest, the service worker, the app icons and the self-hosted fonts are in place.
- `?debug` shows the backend, the frame rate, the draw calls, the triangle count and the body count.

**Stubbed**

- The scene was a test scene with falling crates. Milestone 2 replaced it.

**Test on a phone**

- Open the address with `?debug` appended. The overlay reports about 60 frames per second.

## Milestone 2: drive

**Works**

- Hollow Creek loads from `levels/hollow-creek.json` and its heightmap: fields, the county road, the farm lane, the yard, the creek, the pond, hedges and trees.
- The Bruiser drives with point-to-drive on touch and keyboard, and with classic controls on a gamepad.
- The Action button fires the ram burst: 0.5 seconds of extra speed, then a 4 second recharge. The blade edge and the button show the charge.
- The camera follows with look-ahead, zooms between three presets and rotates in 45° steps.
- On a portrait screen the camera turns so that the Hauler's line runs up the screen.
- The touch controls show a floating stick and round Action and Brake buttons. A pinch zooms and a two-finger twist rotates.

**Stubbed**

- Buildings, TNT, the Hauler and the head-up display are not in the level yet.
- Hedges do not react to vehicles yet. Trees are solid.
- The ram burst does not deal damage yet.

**Test on a phone**

- Drive across the fields with the left thumb. Point the stick behind the Bruiser to reverse.
- Tap **RAM** and check that the button shows the recharge.
- Pinch to zoom and twist two fingers to rotate the view. Turn the phone to portrait and back.

**Deviations from the briefs**

- **Vehicle model.** The code brief recommends Rapier's ray-cast vehicle controller. The build uses its own arcade model on a Rapier body instead. The body only turns around the vertical axis, and the model sets speed, grip and turn rate directly. The reason is feel: the vehicles must drive like toy cars, reach top speed in about half a second, turn sharply and never flip. Rapier still resolves every collision.
- **Scale.** The level maps of the design fix the size of the world: Hollow Creek is about 525 m wide and its farmhouse is 24 m long. The vehicles are scaled to match, so the Bruiser is 8.4 m long. The camera distances are 48, 66 and 96 m instead of 25, 45 and 70 m, which keeps the vehicle at the same size on the screen.
- **Heightmap resolution.** A heightmap pixel covers 2.5 m instead of about 4 m, so that ramps and the creek banks have clean edges.
- **Ground texture.** The level file describes the ground as vector shapes, and the game paints them into a texture at load time. This is the look of the scene artboard, draped over the 3D terrain.

## Milestone 3: destroy

**Works**

- The 14 buildings of Hollow Creek stand in the level: houses, barns, sheds, silos, a greenhouse and a diesel tank.
- A building is cut into segments along its longer side. A house has two segments and the hay barn has three.
- Buildings come in four strengths: shed (100 hit points per segment), house (250), brick (600) and concrete (1500).
- A ram deals damage by speed and mass. A segment cracks at half of its hit points and falls at zero.
- When a segment falls, the damage that is left over passes to its neighbours, and each neighbour loses half of its hit points. One ram charge therefore drops a whole house.
- A fallen segment breaks into chunks that tumble for 4 seconds, then lose their collider and shrink away. A dust patch and loose rubble without colliders stay behind.
- A vehicle that breaks through a wall keeps 82 % of its speed. A vehicle that a wall stops bounces back.
- Concrete ignores every vehicle except the Tumbler. A hit throws sparks.
- TNT crates: the first touch lights a 10 second fuse, and a ring on the ground burns down. The explosion damages buildings, throws vehicles and debris, and lights other crates.
- The diesel tank explodes shortly after it is destroyed.
- Heavy hits freeze the world for a few hundredths of a second and shake the camera.
- Vehicles flatten hedges.

**Stubbed**

- The Hauler, the route obstacles and the head-up display come in milestone 4.
- There is no sound yet.

**Test on a phone**

- Ram the tool shed north-east of the start. It falls in one hit.
- Ram the farmhouse twice, or tap **RAM** just before the impact and drop it in one hit.
- Ram the stone barn. Nothing happens except sparks. Push a TNT crate against it and drive away.
- Ram the diesel tank and watch the Bruiser get thrown back.

**Deviations from the briefs**

- **TNT numbers.** The code brief gives 800 damage within 8 m. With those numbers, two crates cannot drop one 1500-point concrete segment, and the brief asks for tuning towards an arcade feel. The build uses 3000 damage at the centre, falling to zero at 22 m. One crate against the wall drops the stone barn.
- **TNT failsafe.** A crate comes back at its starting place 6 seconds after it explodes or leaves the map. The brief asks for a failsafe and names this option.
- **Collapse.** The spread of damage between segments is an addition. It makes "one ram charge drops a house" true although every segment has the full hit points of its strength.
- **Ram burst.** The burst raises the top speed by 25 % for 0.5 seconds. Together with the 1.8 times damage bonus, a charged ram deals 2.8 times the damage of a plain ram. A larger burst would drop brick on flat ground and make the "ram with downhill speed" solution of the twin silos pointless.
- **Hit-stop and camera shake** are listed under milestone 7 in the brief. Basic versions are in now, because impacts feel weak without them.

## Milestone 4: Hauler loop

**Works**

- The Hauler enters at the map edge already rolling and drives one straight line at 3 m/s. It follows the terrain and flattens hedges.
- At level load, the game sweeps the Hauler's footprint along the line and lists the route obstacles. The order and the timing are computed from the level data.
- A sensor box around the Hauler and slightly ahead of its bumper ends the level when it touches a building, a vehicle, a TNT crate or a tree. Rubble does not count. An explosion close to the Hauler also destroys it.
- The next-obstacle pointer sits beside the vehicle. It is yellow, amber under 15 seconds and red and pulsing under 5 seconds.
- Route obstacles have a red outline on the ground. The next one has an amber outline.
- When the last obstacle falls, the Path clear banner shows the clear time and the bonus time. Bonus time runs until the Hauler leaves the map or the player selects **Finish level**.
- The 30 beacons light up when the vehicle drives past. The relay dish hides under hay bales behind the stone barn.
- The result awards bronze, silver or gold by the rules of the design brief, and counts points for every destroyed segment, beacon and the dish.
- The head-up display shows the counters, the mini-map, the pointer, the Path clear banner, tutorial hints and, on desktops, the vehicle card.
- The camera leans towards the Hauler in the last 5 seconds before an impact.
- The steering assist bends the heading towards the next obstacle when the player already aims at it.
- Hollow Creek can be played from start to result.

**Stubbed**

- The fail panel and the result panel are placeholders with a **Retry** button. Milestone 5 replaces them.
- There is no pause, no title, no campaign map and no saving yet.

**Test on a phone**

- Wait at the start. The Hauler hits the tool shed after about 35 seconds and the level fails.
- Clear the six obstacles in order. The stone barn needs a TNT crate.
- After Path clear, light beacons along the hedges until the Hauler leaves, or tap **Finish level**.

**Checks**

- `npm run report:route` prints when the Hauler reaches each obstacle. For Hollow Creek, every arrival is within 3.1 % of the design brief.
- `tests/route.test.ts` fails when an arrival of any level is more than 10 % off.
- With `?debug`, the overlay offers an invincible Hauler, the route line, collider wireframes, a time-scale slider and a level select.

**Deviations from the briefs**

- **Beacons and the relay dish** are listed under milestone 7 in the brief. They are in now, because the medals and the counters need them.
- **Mini-map.** The code brief suggests a second 3D render. The build draws a 2D schematic instead, which is what the mocks show: navy ground, water and roads as strokes, and dots for the obstacles, the Hauler and the player.
- **Pointer and outlines.** The pointer is an SVG in the DOM layer, placed by projecting the vehicle onto the screen. That keeps it crisp at every size. The outlines are flat frames on the ground.
- **Vehicle in the way.** A vehicle that stands on the line destroys the Hauler, also in bonus time. The brief says that the Hauler detonates when it touches anything solid.

## Milestone 5: screens

**Works**

- All ten screens of the flow exist as DOM views over the canvas, styled only with the design tokens: title, campaign map, level briefing, gameplay with the head-up display, pause, Hauler destroyed, the Path clear banner, bonus time, results and settings. How to play is an eleventh, small screen behind the button on the title.
- A small state machine runs the flow: `title → campaign → briefing → playing ⇄ paused`, and `playing → failed`, or `playing → results` once the Hauler has left. Settings returns to where it was opened from. Escape and the Start button go back.
- The 3D scene keeps running behind the title, the briefing, the pause screen and the fail screen. It is not drawn behind the screens that cover it completely.
- The briefing flies the camera along the Hauler's line, with a progress bar and **Skip**. It shows the obstacle count, the first hit, the best medal and the vehicles on the map.
- The fail screen names what the Hauler hit and gives one tip for that kind of crash. The crash plays in slow motion, and **Watch again** replays the last 1.3 seconds before it.
- The results screen shows the medal, the four progress rows with the 80 % marks for silver, what gold still needs, and the score.
- Settings: touch layout (point-to-drive or classic), left-handed, steering assist, auto-skid, haptics, mini-map, full camera shake, pattern markings, tension music, subtitles and three volumes.
- The classic touch layout steers with the stick and has separate GAS and BRAKE pedals. On a keyboard, W and S then drive and A and D steer.
- Medals, best times, building percentages, beacons, the dish and the settings persist in `localStorage` under `clearway.save.v1`, with a version number and a migration stub.
- A level unlocks when the level before it has a bronze medal.
- The layouts reflow for phone landscape (844 × 390, down to 667 × 375), phone portrait (390 × 844), iPad (1180 × 820 and 820 × 1180) and desktop (1440 × 900). They respect the safe areas.

**Stubbed**

- The volumes, the tension music and the subtitles are stored but have no effect until milestone 7 adds audio.
- Auto-skid has no effect until milestone 6 adds the Fishtail.
- The campaign map shows one level until milestone 6 adds the other two.

**Test on a phone**

- Walk through title, campaign, briefing and **START**. Pause with the pause button and open Settings from there.
- Let the Hauler hit the tool shed, read the tip, and tap **Watch again**.
- Clear the level, check the medal, reload the page and check that the campaign card still shows the medal and the best time.
- Turn the phone on every screen.

**Deviations from the briefs**

- **Restart** on the pause screen restarts the level at once. The mock links it to the briefing. A restart is a quick retry, so the briefing would only be in the way.
- **Next level** on the results screen opens the campaign map with the next level marked **NEXT UP**, as the mock links it and the design brief describes.
- **Blur.** The pause screen blurs the canvas with a CSS filter while the scene stands still. The head-up display uses no `backdrop-filter`.
- **Replay.** The replay shows the recorded poses of the Hauler and the vehicles. Debris and buildings stay as they are after the crash.
- **Finish level** sits under the mini-map when touch controls are on the screen, because the Action button occupies the corner that the mock uses. Without touch controls it sits in that corner.
- **HUD scale.** The design brief lists an adjustable HUD scale under accessibility, but the settings mock has no control for it. The build follows the mock.

## Milestone 6: vehicles and levels

**Works**

- **Pilot on foot.** **EXIT** (or E, or Y) puts the pilot beside the driver's door. The pilot walks, deals no damage and can enter any free vehicle within 6.5 m with the same button, which then reads **ENTER**. The Hauler also blows up when it hits the pilot.
- **Fishtail.** Hold the Action button above 25 km/h to skid: the engine cuts out, the truck slides on with its momentum and turns across its line. The armoured tail damages every building segment that it sweeps along, by the speed of the truck. One fast pass along a terrace drops house after house. With auto-skid on, the tail swings towards the nearest wall by itself. A front ram is weak.
- **Liftoff.** The boost lasts 1 second, raises the top speed by 45 % and recharges in 3 seconds. It also pushes in the air. A landing on a roof deals seven times the damage of a ram at the same speed.
- **Tumbler.** The roll lasts 1.5 seconds at 90 km/h. A roll that does not break a wall bounces off and pounds it again. Rolls that hit within 2 seconds of each other add 25 % damage each, up to three times. It is the only vehicle that breaks concrete. It waits inside the equipment hangar and is free once the part of the hangar around it has fallen.
- **Railbed.** It only drives forwards and backwards on its track. Near the glowing slot it rolls into place by itself. In the slot, its deck closes the route gap and the outline turns solid green.
- **Route gaps.** A gap counts as a route obstacle. The Hauler is destroyed at the edge of an open gap. It drives across the Railbed deck when the gap is closed.
- **Road bridges** carry vehicles over the rail cutting.
- **Level 2, Ferrow Junction:** a town at dusk with 16 terraced rows, a station, a chapel, a pub, goods sheds and a warehouse, split by a rail cutting. Start vehicle: Fishtail. Also on the map: Railbed, Bruiser and one TNT crate.
- **Level 3, Cinder Quarry:** a quarry at noon with a rim above the plant floor, a pit with benches and a lake, kicker ramps along the rim, stockpiles and a settling pond. Start vehicle: Liftoff. Also on the map: the locked Tumbler, a Bruiser and two TNT crates.
- Vehicles cannot climb banks steeper than about 41°, so the quarry rim is a real edge. They can still drop off it.
- A terrace is one building with one segment per house.

**Checks**

- `npm run report:route`: every arrival of Ferrow Junction is within 7.6 % of the design brief, and every arrival of Cinder Quarry within 3.7 %.
- All three levels were driven to their result in the browser with the debug tools: the skid pass along Station Road, the Railbed into its slot and the Hauler across it, the Liftoff jump onto the site cabins and onto the hangar roof, and the Tumbler against the crusher blocks.

**Test on a phone**

- Level 2: hold **SKID** while you pass the Station Road terraces. Tap **EXIT**, walk to the Railbed at the south end of the cutting, tap **ENTER** and drive it north into the slot.
- Level 3: drive south over the rim and land on the site cabins. Boost over the rim onto the hangar roof, then walk to the Tumbler and roll into the crushers.

**Deviations from the briefs**

- **Pilot speed.** The pilot walks at 24 km/h instead of 12 km/h. The world is about twice life-size, and the walks between vehicles would otherwise eat a third of a level.
- **Skid damage.** The code brief makes the tail collider the damage dealer. The build tests a tail zone against the building footprints instead, and takes the speed of the whole truck. A contact-based test only sees the small speed at which the tail meets the wall, which made the skid feel weak.
- **Tumbler.** The brief describes a kinematic character controller that turns into a rolling capsule. The build keeps one arcade body and changes speed, turn rate and damage for the roll. The model tucks its limbs in and spins.
- **Railbed deck.** The deck is as wide as the rail cutting, 15.5 m, so that it carries the Hauler, which crosses the cutting at an angle. The mock draws a narrower wagon.
- **Rail cutting.** The cutting is 12 m wide and 3 m deep, narrower than on the level map, so that one wagon can bridge it.
- **Town density.** The level map shows about 85 terraced houses. The build keeps them, grouped into 16 rows. A row counts as one building for the medals.
- **Hangar and gantry heights** are 9 m and 8 m, so that a boosted jump from the rim lands on the hangar roof.

## Milestone 7: polish

**Works**

- **Sound.** 72 public-domain recordings play through Howler, which unlocks audio on the first tap. Hits sound by material: wood for sheds and houses, masonry for brick, metal on concrete. Segments collapse with rubble, TNT and tanks blast, the fuse hisses, beacons chime upwards and every button ticks.
- **Engines.** Each vehicle has its own engine loop whose pitch follows the speed. The Hauler rumbles louder the closer it is, and its alarm sounds in the last 5 seconds before an impact. The skid and the rocket boost have their own loops.
- **Music.** A step sequencer plays a funk bass riff over drums from the recordings. The same riff runs at 104 beats per minute while the Hauler is far, at 124 under 15 seconds and at 152 with extra layers under 5 seconds. Bonus time and the menus have their own grooves. The Tension music setting keeps the calm tempo.
- **Volumes.** The Music, Effects and Crew voice sliders work. The sound stops while the page is hidden.
- **Crew captions.** With Subtitles on, the crew's radio lines show as captions: "Hauler is rolling.", "Fifteen seconds to impact." and "Path clear!".
- **Haptics.** Hits, explosions and the crash vibrate on devices that support it.
- **Dust.** Fast vehicles, skids, hard landings and the Hauler kick up dust.
- **Dynamic resolution.** When frames stay above 18 ms for a second, the render scale drops by 10 %, down to 50 %. After 5 seconds without slow frames it rises by one step. When a rise does not hold, the next one waits twice as long.
- **Phone budget.** Phones draw the terrain with a quarter of the triangles, use a 2048 px ground texture and one 1024 px shadow map. Larger screens use the full terrain, a 4096 px ground texture and a 2048 px shadow map.
- **Clean reloads.** A level frees its physics world, geometries, materials and textures when the next one loads.
- **Debug autoplay.** `clearway.arrivals()` in the console, or **Measure arrivals** in the debug overlay, runs the level with an invincible Hauler and reports when it reaches each obstacle.

**Not done**

- **Crew voice.** There are no voice recordings. The radio lines are captions with a radio click.
- **Tilt-shift depth of field** at far zoom is not in. It needs a post-processing pass that costs fill rate on phones.
- **The 60 fps cap on battery** is not in. A web page cannot read the power source reliably.
- **Compressed textures and glTF models** are not needed yet: the world is built from generated geometry and painted textures.

**Review**

A second reviewer read the game code after the milestone was built and reported twelve defects. All twelve are fixed:

- A level that the player quit kept running behind the menus, and its crash or result could replace the campaign map. The simulation now only runs during play, the crash, the title and the briefing, and the delayed screens check that their level is still the current one.
- The dynamic resolution could only go down on 60 Hz displays. It now recovers by trying a higher scale.
- Bonus time did not end when the Railbed left its slot. The level now returns to the blocked state.
- The pilot could step out of the Railbed into the Hauler's lane. The exit spot is now chosen clear of the lane, of buildings and of drops.
- A level did not free its shadow map, its crack texture and a few materials. It does now.
- A second level load during a running one continued with the old level. It is now ignored.
- Space did not activate a focused menu button.
- Switching tabs during a load could leave the level frozen.
- Debris passed through the Hauler's hull.
- Vehicles on the floor of the rail cutting were lifted onto the decks above them.
- The campaign map focused the first button instead of the next level.
- The slow-motion tag on the fail screen now stays on for as long as the scene runs in slow motion.

**Deviations from the briefs**

- **Dynamic resolution recovery.** The code brief recovers when frames fall below 14 ms. The time between two frames never falls below the refresh period of the display, which is 16.7 ms at 60 Hz, so the build recovers after a stretch without slow frames instead.

**Device testing**

The build was checked in a desktop Chromium browser at 844 × 390, 390 × 844, 1180 × 820 and 1440 × 900, on WebGPU and with `?webgl` on WebGL2. It was not run on a physical iPhone, Android phone or iPad. Before a release, play every level on real devices and check the frame rate with `?debug`.

## Acceptance checklist

| Criterion of the code brief                                                                | State                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| All 3 levels can be finished with touch only, in both orientations, and with keyboard only | Every level runs from start to result with scripted input. Not played by hand on a phone.   |
| Each level's Hauler arrival times match the design brief within ±10 %                      | Met. The worst arrival is 7.6 % off. `tests/route.test.ts` guards it.                       |
| The Hauler touching any obstacle fails the level; rubble never does                        | Met.                                                                                        |
| Every screen in the flow is reachable and matches the mocks at all four sizes              | Met in the browser at the four sizes.                                                       |
| Medals, best times and settings persist across reloads                                     | Met. `tests/save.test.ts` covers the storage.                                               |
| 60 fps on an iPhone 13-class phone in Level 3's busiest moment                             | Not measured on a device. Dynamic resolution and the phone budget are in place.             |
| Installs to the home screen and launches fullscreen in either orientation                  | The manifest, the icons and the service worker are in the build. Not installed on a device. |
| No Blast Corps names, art or audio anywhere in the repository                              | Met. All names, models and levels are original, and the recordings are CC0.                 |
