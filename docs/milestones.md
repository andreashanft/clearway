# Milestones

This file records each milestone of Clearway: what works, what is stubbed, how to test it, and where the build deviates from the plan on purpose.

Clearway changed direction on 2026-11-23. The first part of this file covers the new direction: a run through a real city with three vehicles. The second part keeps the notes of the first prototype, which the new direction replaces step by step.

To test on a phone, start the development server with `npm run dev -- --host` and open the network address on the phone. Both devices must be in the same network.

## City direction

### Milestone 3: weapons

Each vehicle gets its own way to destroy buildings on one action button: Space on a keyboard, A on a gamepad and **ACTION** on touch. The user chose rockets that come from crates and from large buildings. After two playtests, the flail ball sits on the back of the car, and the button lets it out on a chain.

**Works**

- The bulldozer boosts on a press: it gains 6 m/s at once, and for 2 seconds it drives at full throttle with 60 % more top speed and 150 % more acceleration, also from standstill. The next boost is ready 4 seconds later. Flames burst from the exhaust stacks. A faster ram hits harder, by the usual square of the speed.
- The bulldozer's spiked blade deals 50 % more damage with a forward ram. It is 7 m wide, wider than the tracks, and it breaks every section in an 8 m strip in front of the bulldozer before the physics step, so the bulldozer clears a lane as wide as the carrier's in one pass.
- The flail car carries a spiked ball on a winch at its back. While the button is up, the ball sits on the car. While the button is held, the chain pays out to 7 m at 12 m/s, and the ball becomes a physics body of 600 kg that swings out in turns and whips round in a slide. The ball does not turn, so it slides over the ground instead of rolling, and the chain always holds the same point of it. The tight chain pulls the car with 45 % of its impulse: after a turn with the chain out, the car swings 20° further than with the ball docked, and it slows from 100 to 87 km/h in a full turn. When the button is up, the chain winds in at 9 m/s and the ball docks again. A hit deals 150 damage at 16 m/s along the contact, by the square of the speed and at most 1.6 times that. A hit that breaks a section lets the ball fly on, and a wall that holds throws it back. A section takes one hit per 0.3 seconds. The ball pushes cones and crates and bounces off its own car.
- The buggy fires a rocket on a press, at most one per 0.3 seconds. A rocket flies at 90 m/s and explodes on the first thing it hits. After 240 m its fuel is gone: the flame goes out, and the rocket falls in an arc and explodes where it lands. The explosion deals 280 damage at its centre within a radius of 9 m, and it does not freeze the game. The aim assist bends a rocket towards the standing column closest to the line of fire, within 18° and 170 m. The buggy starts with 6 rockets and carries at most 12. Two pods of tubes on the roll cage hold them.
- Ammunition crates give 4 rockets each. They show and work only while the buggy is the active vehicle. A crate at a fixed place comes back after 25 seconds. A break of at least 1,000 m³ drops a crate with a chance of its volume divided by 20,000, at most 35 %. At most 4 dropped crates lie around at once, and each disappears after 25 seconds.
- The HUD card shows the weapon with a meter: the boost and its cooldown, the spin of the flail, or the rockets left. On touch, the **ACTION** button above **BRAKE** shows the same with a ring.
- Each weapon has its sounds: a whoosh for the boost, a whistle that rises with the speed of the flail's ball, metal clanks for flail hits, a launch for each rocket, and a click and a chime for a crate.
- The test yard has a reference street along its north edge, and five ammunition crates.

**Measured**

`clearway.measureStreet()` drives each vehicle along the reference street with a simple driver model and measures the time to clear a strip as wide as the carrier's, 8.8 m. A turn at the end of the street would count 3 seconds, but no vehicle needed one.

| Vehicle   | Seconds to clear | Passes | Weapon use                 |
| --------- | ---------------- | ------ | -------------------------- |
| Bulldozer | 21.6             | 1      | 3 boosts                   |
| Flail car | 30.5             | 2      | 7.2 seconds with chain out |
| Buggy     | 10.3             | 1      | 10 rockets                 |

The planned range for the street is 10 to 25 seconds. The bulldozer is slower than the buggy, because its top speed of 62 km/h stays as the user approved it in milestone 1. Its blade and its boost make up for part of that. The buggy is the fastest while it has rockets, and it used 10 of them on this short street, including one crate.

The flail car is outside the range with the driver model. The model drives straight with the chain out, so the ball only follows behind the car and misses a shed beside the line, which takes a second pass. A player swings the ball out in turns and slides, which the model does not do. With the spinning flail of the first build, the flail car took 16.8 seconds.

- At top speed, every vehicle still breaks a house with one ram and keeps 97 % or more of its speed. With the blade, the bulldozer deals 328 at three quarters of its top speed.
- One rocket into the 36 m tower of the reference street brought down 2 of its 4 columns.
- In a test with the buggy, rockets, explosions and a crate pickup compiled no new shader during play.
- A slide with the chain out whipped the ball to 20 m/s, enough for 1.6 times the hit damage.

**Stubbed**

- The flail car was planned as an all-terrain car that drives over rubble without losing speed. Since milestone 2, every vehicle drives through debris and rubble has no collider, so there is nothing to drive over. The flail car has no special terrain handling.
- The driver model of the street measurement is simple. It does not slow the bulldozer or the buggy for walls that hold, and it fires rockets only at sections straight ahead.

**Review fixes**

An independent review of the change found these defects, and the build fixes them:

- A press of Space on a menu button, such as **Resume**, waited in the input queue and fired the weapon when play went on. A press now counts only while the button is still down.
- A rocket that flew under a bridge exploded, because it took the deck for the ground.
- The flail pushed a cone or a crate again in every step while it touched it, which threw it high into the air. A loose body now takes one push per 0.6 seconds.
- A break of a tower rolled twice for an ammunition crate, and a crate could land inside a part of a building that still stood. A break now rolls once, and a crate never drops inside a building.
- The ends of the wide blade passed through walls that hold. The blade now has its own collider.
- A change of vehicle refilled or cut the buggy's rockets to 6. The game now keeps the count.
- The blade's damage factor also counted when the bulldozer slid into a wall sideways. It now counts only for a forward ram.
- A rocket that missed its target turned back towards it and could fly back at the buggy. It now flies on straight once it has passed the target.

**Test it**

1. Open the game with `?yard` appended. Choose a vehicle with the keys 1, 2 and 3, or in the bar at the top.
2. Drive to the reference street along the north edge, and clear it with each vehicle.
3. With the bulldozer, press Space for a boost before a building, also from standstill.
4. With the flail car, hold Space to let the chain out, and swing the ball into the houses beside the street with turns and slides.
5. With the buggy, fire at the tower, and collect the crate between the sheds and the block.
6. Optional: open the address with `?yard&debug` appended, and select **Measure street**.

### Milestone 2: destruction

The destruction felt weak in both earlier builds: a building took too many hits, the collapse had too little spectacle, and nothing rewarded it. This milestone rebuilds the buildings so that they break fast and visibly, and so that the map data of milestone 4 can feed them.

**Works**

- A building is a footprint polygon with a height and a base height, as OpenStreetMap gives it. The strength classes, the hand-made kinds and the segments along one side are gone.
- The game draws a building in its own style: walls with a window texture by floor, a flat roof, or a gabled roof on a small rectangular house. The colours come from a palette by size: shed, house, block or tower.
- A footprint is cut into pieces of about 10 m on a grid along its smallest enclosing rectangle, with at most 64 pieces. A house stays one piece. Each piece has a convex collider.
- Hit points grow with the volume, to the power of 0.6, between 30 and 1,200. The reference house of 800 m³ has 100 hit points.
- Each vehicle has a ram value: the damage of a ram at its top speed. A slower ram deals less, by the square of its share of the top speed. The bulldozer rams with 400, the flail car with 300 and the buggy with 200.
- In a low building, a fallen piece passes 85 % of its spare damage on to the next piece along the ram, and weakens every neighbour by a quarter of its hit points. A fast ram therefore carves a corridor.
- Every piece is a column of stacked sections. A building of up to 15 m has one section per column. A taller building is a tower, and its columns have one section per four floors, about 12 m. Every section has its own hit points.
- When a section breaks, the sections above it fall as loose blocks with physics. The stack starts to turn away from the ram, so it topples along the corridor that the ram cut. A falling section breaks into chunks and rubble when it lands. When it hits another building, it deals damage by the square of its speed along the contact, so towers can bring each other down. A falling section passes through the building that it fell from.
- A building part that stands on another building, such as a tower on a podium, falls when the column under it is cut.
- Every break scores by its volume. A falling stack scores once, by its whole volume, when it starts to fall. Breaks within 3 seconds of each other form a combo, and every third break raises the multiplier, up to ×8. Each building that passed the collapse on adds half the points again as a chain bonus.
- The HUD shows the score at the bottom centre, the combo multiplier with a bar that drains, and pop-ups where buildings break. Breaks close together share one pop-up.
- Breaking sections, falling stacks and landing sections have their own layered sounds. At most four breaks within a quarter of a second make a sound. The combo chimes higher with each step.
- The test yard has a downtown: a street of houses with a terrace and an L-shaped house, a block of flats around a courtyard, a tower of 40 floors, two more towers, an office block and an office tower.

**Measured**

- `clearway.measureRams()` rams a house of 756 m³ (97 hit points) at three quarters of the top speed. The bulldozer deals 223, the flail car 168 and the buggy 113, so every vehicle breaks it with one ram. After the break, every vehicle keeps 97 % or more of its speed.
- A section of the 40-floor tower has 100 to 107 hit points. At top speed, every vehicle breaks the bottom section of the column that it hits and drives on at full speed, so it breaks every column in its line. A straight ram through the middle cuts 3 of the 9 columns, and 27 sections topple along the street within about 3 seconds. The 6 other columns stay.
- A ram of the bulldozer at top speed into the block of flats carves through four pieces. The buggy carves through two.
- A diagonal ram of the bulldozer from the north-west cuts all 9 columns of the 40-floor tower. The falling sections bring down the 54 m tower too.
- During that collapse, at most 78 sections fell at once, and one simulation step took at most 3.9 ms on a desktop computer.

**Stubbed**

- The dust is made of the same flat-shaded particles as before. Large dust clouds can look like boulders.
- The frame rate during a collapse was not measured on a phone. A falling section is a convex physics body, and a tower can drop more than 80 of them at once.
- Rubble is decoration and has no collider, as before.

**Test it**

1. Open the game with `?yard` appended and drive south to the downtown.
2. Ram the houses on the street, carve through the block of flats, and ram the base of the 40-floor tower at top speed.
3. Hit the tower diagonally from the north-west, so that it topples onto the 54 m tower south-east of it.
4. Watch the score, the combo and the pop-ups.
5. Optional: open the address with `?yard&debug` appended and select **Measure rams**.

**Review fixes**

An independent review of the change found these defects, and the build fixes them:

- A ram where two pieces of a tower meet counted once per piece, so the tower lost twice or three times the damage.
- A concave piece, such as the L-shaped house, had one convex collider that filled its missing corner. Concave pieces now get one collider per triangle.
- A piece that a cut splits into two parts got a wall and a collider across the gap between them.
- Cracked pieces of a large building tilted around the building's centre, which lifted or sank pieces far from it.
- Explosions carried their spare damage through pieces as if they were rams.
- A cracking tower played one sound and one dust burst per piece.
- A building part that stands on another kept floating after the building under it fell. It now falls with it, and its rubble lands on the ground.
- A footprint without area made a building that counted as destroyed from the start. The game now leaves it out.

**Playtest changes**

The first playtest found three problems, and the build fixes them:

- Every ram stopped the vehicle for a moment, also when it broke the house. The world froze for 0.07 s, and the vehicle lost 18 % of its speed. Now the vehicle looks one physics step ahead and breaks the walls that its ram breaks before the physics engine resolves the contact. A breaking ram neither freezes the world nor slows the vehicle. A wall that holds still stops the vehicle with a short freeze.
- Chunks of debris blocked the vehicles and took their speed. Vehicles now drive through debris.
- A falling tower filled the screen with one large sinking mass and dust, so you could not see what happened. A tower now breaks in sections, and only the columns that you hit come down.

The second playtest found three more problems, and the build fixes them:

- The game froze for a moment at the first ram after loading. The GPU compiled the shaders of the rubble, the cracked walls and the falling sections at their first use. The level now compiles the shaders of every object while it loads, and falling sections use the same shadow settings as standing buildings, so play creates no new shader.
- The score pop-ups appeared where a building broke, which the camera often did not show. They now rise above the vehicle and take turns at five places beside each other.
- Vehicles drove through the traffic cones, because the cones shared the layer of debris. Cones are now props, which vehicles hit.

An independent review of these changes found four defects, and the build fixes them:

- A falling section could crash the game when a collider next to it was removed in the same step.
- A falling section damaged a concave section once per collider instead of once.
- A section that broke in place because too many sections were falling scored twice.
- A wall that the vehicle only grazed hid the wall in front of it from the look-ahead.

**Deviations**

- The plan named fire as part of the spectacle. A building has nothing that burns yet, so breaks show dust, chunks and sparks. Fuel tanks still explode.
- The obstacle outlines on the ground follow the footprint polygon instead of a rectangle or a ring.

### Milestone 1: driving

The driving failed in both earlier builds: the vehicles felt too slow and heavy, and the steering was imprecise. This milestone rebuilds the driving in a test yard, before any other part of the new game.

**Works**

- The vehicles use car controls on every device: accelerate, brake and then reverse, steer relative to the vehicle, and a handbrake.
- Touch has a steering control under the left thumb and **GAS** and **BRAKE** pedals under the right thumb.
- Three vehicle bodies exist: the bulldozer, the flail car and the buggy. They have no weapons yet.
- A new handling model drives them. At low speed a vehicle follows its turning circle. At high speed its sideways grip limits the turn, so the turn widens and the vehicle stays stable. The bulldozer turns on the spot.
- The steering wheel follows a key press at a limited speed, and an analogue input steers finely near the centre.
- The camera has a chase view behind the vehicle, which is the default, and the high fixed view of the first prototype. **C**, the **Y** button, the yard bar and the settings switch between them.
- The test yard has a main straight with a line every 10 m, a stop box, two slalom lanes with cones, three turning circles, a street grid and buildings to ram.
- The yard bar switches the vehicle and the camera view, resets the yard and counts the cones that fell.
- With `?debug`, the **Handling** and **Chase camera** panels change the tuning while the game runs.
- `clearway.measure()` drives each vehicle through a scripted test and reports the values below.
- The HUD card shows the speed in km/h.

**Measured handling**

The scripted test gives these values with the built-in tuning:

| Value                            | Bulldozer | Flail car | Buggy    |
| -------------------------------- | --------- | --------- | -------- |
| Top speed                        | 62 km/h   | 100 km/h  | 140 km/h |
| Time to 95 % of the top speed    | 1.03 s    | 1.33 s    | 1.33 s   |
| Stopping distance from top speed | 3.6 m     | 8.2 m     | 13.4 m   |
| Turning circle radius, slow      | 2.0 m     | 8.0 m     | 6.5 m    |
| Turning circle radius, top speed | 11.2 m    | 23.1 m    | 33.6 m   |
| Turn of 180° from top speed      | 2.1 s     | 2.3 s     | 2.2 s    |
| Slip angle in a power slide      | 12°       | 30°       | 38°      |
| Handbrake turn of 90°, top speed | 0.7 s     | 1.0 s     | 1.0 s    |
| Speed after that handbrake turn  | 0 km/h    | 56 km/h   | 84 km/h  |
| Wide slalom, average speed       | 56 km/h   | 71 km/h   | 86 km/h  |
| Wide slalom, cones knocked over  | 0         | 0         | 0        |

For comparison, the fastest vehicle of the first prototype reached 110 km/h and was 6.6 m long. The buggy reaches 140 km/h and is 4.2 m long, so it covers about twice as many of its own lengths per second.

At top speed and full lock with the throttle held, every vehicle slides, so the two rows for the top speed measure a power slide. The bulldozer stops before its handbrake turn ends and then turns on the spot.

**After the first playtest**

The user played the yard on 2026-11-24. The cars felt precise and better than before, but the user missed sliding. The user also asked to remove the music for now. These changes follow:

- The vehicles slide. The handbrake starts a slide above 15 km/h, and every slide fades out near standstill. A turn at nearly full lock with the throttle held starts one from a speed of each vehicle's own: 54 km/h for the bulldozer, 62 km/h for the flail car and 80 km/h for the buggy. A short steering correction keeps the grip, because that slide sets in over about 0.4 seconds.
- In a slide, the steering sets the slip angle: the angle between the heading and the direction of travel. Full lock holds 12° on the bulldozer, 30° on the flail car and 38° on the buggy. Steering to the centre or against the slide straightens the vehicle out.
- A slide turns the direction of travel towards the heading and keeps most of the speed, so that a handbrake turn into a street corner stays fast. The engine drives a sliding vehicle up to its top speed, not beyond.
- The handbrake slows the vehicle more gently than the brake pedal, because only the rear wheels lock. The brake pedal remains the quick stop.
- The tyres screech and throw up dust while the vehicle slides. The chase view turns part of the way towards the direction of travel.
- Touch gets a **DRIFT** button above the **GAS** pedal. It is the handbrake.
- The **Handling** panel has four new sliders: **Handbrake**, **Slide from km/h**, **Slide angle °** and **Slide friction**.
- The music is removed. The step sequencer, the **Music** volume and the **Tension music** setting are gone. The sound effects stay. The drum and bass recordings stay in `public/audio/`, so that milestone 7 can bring music back.

**Stubbed**

- **Play** on the title screen opens the test yard, because the city map does not exist yet.
- The Action button has no function until milestone 3 adds the weapons. The touch controls hide it.
- Buildings break with the damage model of the first prototype. Milestone 2 replaces it.
- The How to play screen describes the test yard.
- The chase view does not avoid buildings between the camera and the vehicle. Milestone 4 needs that for city streets.
- The ground is one painted texture. Up close, in the chase view, its lines look soft.
- A thumb that lands within 56 px of the screen edge cannot reach full steering lock towards that edge.
- A switch to a wider vehicle next to a wall starts the new vehicle inside the wall. The physics pushes it out.
- A slide leaves no tyre marks on the ground.

**Removed**

- The three hand-made levels, their heightmaps and the tools that built them.
- The six old vehicles, the pilot on foot and the mechanics that only they used: point-to-drive, ram charge, skid, boost, roll, stomp, the Railbed and route gaps.
- The campaign map, the briefing and the level thumbnails.
- The settings for the touch layout, the steering assist and the auto-skid.

**Test it**

1. Open the game and select **Play**, or open the address with `?yard` appended.
2. Drive each vehicle on the main straight, through both slaloms, around the turning circles and through the street grid.
3. Switch between the chase view and the fixed view.
4. On a phone, steer with the left thumb and use the pedals with the right thumb.
5. Optional: open the address with `?yard&debug` appended, change the handling values, and copy the values that feel right.

**Checks**

- `npm run check` passes with 95 unit tests. The new tests cover the engine, the brakes, the turning model and the steering curve.
- The scripted measurement matches the tuning values.
- A scripted run confirms the screen flow: title, play, pause, restart, vehicle switch and quit to title.
- The yard, the touch layout and the title screen were checked at 844 × 390, 390 × 844 and 1180 × 820.
- Nobody has played this milestone by hand yet. The feel of the driving is not confirmed.

**Review fixes**

An independent review of the change found these defects, and the build fixes them:

- A second finger on the screen cancelled the steering, or kept it from starting. The steering thumb now steers whatever other fingers do, and only two other fingers make a camera gesture.
- A button of the yard bar kept the keyboard focus after a click, so the next press of Space or Enter clicked it again.
- The vehicle keys of the yard bar reacted to browser shortcuts with Ctrl or Cmd, and failed with Shift held or on a keyboard layout that needs Shift for digits.
- The field of view did not follow a change of the screen orientation while the game was paused.
- The rotation keys of the fixed view collected steps unseen in the chase view.
- The handling measurement ran on the title screen without a warning, and it did not stand the cones up again between vehicles.
- A tuning slider kept the keyboard focus, so the driving keys stopped working.
- A switch of the vehicle on a bridge put the new vehicle on the ground below.
- The HUD and the result used different medal rules for an area that sets none.
- The body of a vehicle rolled the wrong way on ground that slopes sideways. This defect is older than this milestone.

The review also listed code that the removals left without a use. The build removes it: the Action button of the touch controls, the campaign unlock rules of the save data, two maths helpers, two icons and a few styles.

**Deviations**

- The plan named a look-ahead for the camera. The build adds a full chase view instead. Car controls steer relative to the vehicle, and under a fixed camera left and right swap when the vehicle drives towards the viewer. The fixed view stays as a second option, so that both can be compared.
- The vehicles are about half as large as in the first prototype, close to real size. The city of milestone 4 has real street widths, and the old vehicles would not fit into them.
- The plan kept the campaign map and the briefing until milestone 6. The build removes them now, because they only presented the removed levels. Milestone 6 adds the location picker and the vehicle selection as new screens in the same style.
- The Hauler, the route, the medals, the beacons, the relay dish, TNT, and the fail and results screens stay in the code, as planned. No area uses them until milestone 5 turns the Hauler into the carrier.
- `CLAUDE.md` is now excluded from the format check, because its author formats it by hand.

## First prototype

The notes below describe the first prototype with its Blast Corps theme. They are kept as a record. The city direction has removed the levels and the vehicles that they describe.

### Milestone 1: scaffold

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

### Milestone 2: drive

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

### Milestone 3: destroy

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

### Milestone 4: Hauler loop

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

### Milestone 5: screens

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

### Milestone 6: vehicles and levels

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

### Milestone 7: polish

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

### Acceptance checklist of the first prototype

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
