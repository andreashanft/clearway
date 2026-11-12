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
