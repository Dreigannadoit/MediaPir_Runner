Optional rigged models. Drop GLB files here and the game uses them instead of the built-in rig:

  runner.glb   the player
  guard.glb    the guard (if missing, the built-in guard is used)

Each file needs a skeleton and animation clips. Clips are matched by name (case-insensitive):

  run    -> run / sprint / jog
  jump   -> jump / hop / leap
  slide  -> slide / duck / crouch / roll
  idle   -> idle / stand / breath
  fall   -> fall / hit / stumble / caught / death / die / knock

The browser console lists the clip names it found in each file. If your names differ,
edit ASSETS.clips in src/Character.jsx. If the model runs backwards, change
ASSETS.modelRotationY (Math.PI <-> 0) in the same file.
