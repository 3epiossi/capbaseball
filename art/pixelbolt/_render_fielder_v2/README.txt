fielder_yellow — Pixelbolt export

fielder_yellow.png: transparent RGBA sprite sheet
fielder_yellow.atlas.json: TexturePacker-style frames, named animation sequences and Aseprite-style frame tags
fielder_yellow.tres: Godot 4 SpriteFrames; it finds fielder_yellow.png in its own folder, so keep the two together
fielder_yellow.css: CSS classes with per-frame timing
frames/: individual PNGs
animations/: animated PNGs (APNG)
fielder_yellow.pixel.json: editable source
player.js: dependency-free Canvas player
preview.html: open directly in a browser, or serve this folder

Canvas: import { SpritePlayer } from './player.js';
const player = await SpritePlayer.load(canvas, './fielder_yellow.atlas.json');
player.play('idle');

Godot 4: copy fielder_yellow.png and fielder_yellow.tres into one folder of your project, give an AnimatedSprite2D the Sprite Frames fielder_yellow.tres and play("idle"). Set the node's Texture Filter to Nearest for crisp pixels.

CSS: <link rel="stylesheet" href="fielder_yellow.css">
<span class="pf-fielder_yellow pf-fielder_yellow-idle"></span>

Timing:
idle: 2 frames of 240 ms (4.17 fps)
run: 4 frames of 100 ms (10 fps)
dive: 2 frames of 140 to 220 ms, 360 ms in all, plays once
