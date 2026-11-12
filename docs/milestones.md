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
