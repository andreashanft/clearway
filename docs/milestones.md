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
