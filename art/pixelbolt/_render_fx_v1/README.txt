fx_hit — Pixelbolt export

fx_hit.png: transparent RGBA sprite sheet
fx_hit.atlas.json: TexturePacker-style frames, named animation sequences and Aseprite-style frame tags
fx_hit.tres: Godot 4 SpriteFrames; it finds fx_hit.png in its own folder, so keep the two together
fx_hit.css: CSS classes with per-frame timing
frames/: individual PNGs
animations/: animated PNGs (APNG)
fx_hit.pixel.json: editable source
player.js: dependency-free Canvas player
preview.html: open directly in a browser, or serve this folder

Canvas: import { SpritePlayer } from './player.js';
const player = await SpritePlayer.load(canvas, './fx_hit.atlas.json');
player.play('hit');

Godot 4: copy fx_hit.png and fx_hit.tres into one folder of your project, give an AnimatedSprite2D the Sprite Frames fx_hit.tres and play("hit"). Set the node's Texture Filter to Nearest for crisp pixels.

CSS: <link rel="stylesheet" href="fx_hit.css">
<span class="pf-fx_hit pf-fx_hit-hit"></span>

Timing:
hit: 5 frames of 45 to 75 ms, 272 ms in all, plays once
hr_burst: 6 frames of 50 to 85 ms, 363 ms in all, plays once

Godot: fx_hit.tres: the frame times of animations hit, hr_burst share no step of 9 ms or more, so Godot gets fractional frame durations, kept as 32-bit floats: each frame plays within a ten-millionth of its length. Frame times in multiples of 10 ms are exact.
