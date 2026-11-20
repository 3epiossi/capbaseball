batter_yellow — Pixelbolt export

batter_yellow.png: transparent RGBA sprite sheet
batter_yellow.atlas.json: TexturePacker-style frames, named animation sequences and Aseprite-style frame tags
batter_yellow.tres: Godot 4 SpriteFrames; it finds batter_yellow.png in its own folder, so keep the two together
batter_yellow.css: CSS classes with per-frame timing
frames/: individual PNGs
animations/: animated PNGs (APNG)
batter_yellow.pixel.json: editable source
player.js: dependency-free Canvas player
preview.html: open directly in a browser, or serve this folder

Canvas: import { SpritePlayer } from './player.js';
const player = await SpritePlayer.load(canvas, './batter_yellow.atlas.json');
player.play('ready');

Godot 4: copy batter_yellow.png and batter_yellow.tres into one folder of your project, give an AnimatedSprite2D the Sprite Frames batter_yellow.tres and play("ready"). Set the node's Texture Filter to Nearest for crisp pixels.

CSS: <link rel="stylesheet" href="batter_yellow.css">
<span class="pf-batter_yellow pf-batter_yellow-ready"></span>

Timing:
ready: 2 frames of 260 ms (3.85 fps)
follow_through: 2 frames of 90 to 140 ms, 230 ms in all, plays once
