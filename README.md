# Body Runner

A 3D Subway Surfers-style endless runner controlled by your body, using MediaPipe Pose + React + Vite + three.js (react-three-fiber).

## Run it

```bash
npm install
npm run dev
```

Open the printed URL (localhost works for the camera; anything else needs HTTPS).

## How the game works

1. **Center check** - the app tells you to step back / closer / left / right until your whole body is in frame and on the center line. Hold it for 1.5s and it calibrates your standing pose.
2. **Countdown**, then the game starts. The character stays still until you run.
3. **Run in place** - the character runs only while your legs alternate. Stop and it stops; the guard closes in and catches you in about 2.5s. Run again in time and he falls back.
4. **Step left / right** - lane switches (left, center, right).
5. **Jump** - hips rise and both feet leave the floor.
6. **Duck** - crouch so shoulders and head drop. Held for as long as you stay low.

Hitting an obstacle also lets the guard gain on you.

## Files

- `src/poseEngine.js` - MediaPipe setup + all body detection (center check, lane, jump, duck, running)
- `src/gameEngine.js` - game rules: physics, obstacles, guard chase (no rendering)
- `src/GameScene.jsx` - the 3D scene: track, city, obstacles, camera, game loop
- `src/Character.jsx` - rigged characters: your GLB with animation clips, or the built-in jointed rig
- `src/App.jsx` - phase flow (intro -> position -> countdown -> playing -> game over) and UI
- `src/CameraPanel.jsx` - mirrored preview with skeleton and center line

## Using your own rigged character

Put skinned GLB files with animation clips in `public/assets/`:

- `runner.glb` (player) and optionally `guard.glb`

Clips are matched by name: run, jump, slide/duck, idle, fall/hit. The game crossfades between them from the game state
(running, in the air, ducking, caught). Open the browser console to see the clip names it found; change the name
patterns or the model rotation in `ASSETS` at the top of `src/Character.jsx`. Without these files the built-in rig is used.

Mixamo workflow: download your character plus Running, Jump, Slide and Idle animations (FBX, with skin), combine them
as separate actions on one armature in Blender, and export as glTF Binary (.glb) with animations enabled.

## Tuning

Everything is in `TUNING` at the top of `src/poseEngine.js`:

| Setting | Meaning |
| --- | --- |
| `centerTolerance` | allowed distance from the center line (fraction of frame width) |
| `jumpRise` / `jumpLift` | how far the body and the feet must rise to count as a jump |
| `duckDrop` | how far shoulders/head must drop to count as a duck |
| `stepDeadband`, `stepWindow` | step counting for run detection |

Run detection also has an in-app slider (shown while positioning and on the game-over screen).
