# 投手 蔡寰亞 像素精靈圖：給 Gemini 的提示詞（2026-11-20）

依序做，每段貼進 Gemini 時附上該段列的圖。產出的圖存成段落標題的檔名。

規格：角色在遊戲裡約 96 像素高。投球只做正面，跟原片同一個鏡頭：投手面向鏡頭，瓶蓋朝鏡頭（略偏右）投過來，共 60 格，用 24 fps 播放，約 2.5 秒。待機 12 格，用 12 fps 循環。

切格：兩張投球表都到齊後執行下面的指令。會輸出逐格 PNG、整排 strip 和預覽 GIF 到 `art/frames/pitch/`。

```bash
uv run --with pillow --with numpy --with opencv-python python capbaseball/art/slice_sheet.py --name pitch --rows 5 --cols 6 capbaseball/art/sheets/pitch-front-a.png capbaseball/art/sheets/pitch-front-b.png
```

檢查重點：
- 背景是純色，沒有格線和文字。
- 每格大小一樣，腳底在同一條線上。
- 右手投球。
- 每格的姿勢都要對得上照片參考圖（ref/photo-front-*.png）的那一格。
- 參考圖從原片 83 幀平滑後取 60 幀，`ref/photo-front.gif` 和 `ref/pose-front.gif` 可以先看動作對不對。

## 1. capbaseball/art/ref/pitcher-ref.png

附圖：`~/Pictures/899793676_17925790443445344_5757401645075848134_n.jpg`（正面）、`~/Pictures/573173640_17873145126445344_6662785267312928275_n.jpg`（背面）

```
Turn the young man in the two attached photos into a pixel-art game character reference sheet. Keep his real look: slim young East Asian man, thick straight black hair with a heavy fringe that reaches the top of his glasses and short tapered sides, large round thin black-rimmed glasses, calm focused face. Outfit exactly as in the photos: loose bright yellow baseball T-shirt (#F2C81E) with white raglan short sleeves ending in a thin yellow cuff, white ribbed crew collar with a black undershirt collar showing inside it, black long-sleeve compression undershirt down to the wrists, black "Chung Cheng" baseball script with a swoosh tail across the chest and a small black "UNIV." and "18" lower on his left chest, on the back the name "SKYWALKER" and a big black "18" with a thin yellow inline, loose black shorts to just above the knee, bare legs, white ankle socks, white running shoes. He is right-handed and holds a small white bottle cap in his right hand, no glove. Layout: one row of 3 full-body standing poses, same scale, feet on one baseline: facing the camera, facing right (side view), facing away (back view). Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text labels, no grid lines). Crisp pixel art, the character about 96 pixels tall with every pixel a clear square block, dark 1-pixel outline, light from the top-left, limited palette, no blur, no anti-aliasing.
```

## 2. capbaseball/art/sheets/pitch-front-a.png

附圖（依序）：`capbaseball/art/ref/pitcher-ref.png`（角色）、`capbaseball/art/ref/photo-front-a.png`（原片前 30 幀）、`capbaseball/art/ref/pose-front-a.png`（火柴人前 30 幀）

```
Use the first attached image as the character reference: keep the same character design, colours, outfit, glasses, hair, proportions and pixel density exactly, ignore the clothes of the person in the photos. The second attached image is the motion reference: a 5 rows x 6 columns grid of real video frames of this pitch, filmed from where the catcher stands, so he faces the camera and throws toward the viewer. The third attached image is the same 30 frames as stick figures to make the limbs unambiguous: red = his right arm (throwing arm), blue = his left arm, orange = his right leg, cyan = his left leg, white = head and torso. Redraw the character in exactly the pose of each cell, cell by cell, in the same reading order (left to right, top to bottom), with the same position inside each cell, the same camera angle and the same facing direction as the photo. Do not invent poses; copy the photos, including how much his body turns. Ignore everything else in the photos (wall, sky, floor, the red triangle overlay); only the small white bottle cap matters. This half is the wind-up: hands together above his head, left leg lift, then the stride toward the viewer with the throwing arm swinging back; the white bottle cap stays in his right hand. Pixel-art sprite sheet, 5 rows x 6 columns, 30 frames of one continuous motion, every frame the same scale, feet on the same ground line, the character fully inside its cell with empty space between cells. Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text, no numbers, no grid lines, no labels). Crisp pixel art with the same pixel scale as the reference, dark 1-pixel outline, light from the top-left, no blur. Shirt hem, sleeves, shorts and hair follow through with the motion.
```

## 3. capbaseball/art/sheets/pitch-front-b.png

附圖（依序）：`capbaseball/art/ref/pitcher-ref.png`（角色）、`capbaseball/art/ref/photo-front-b.png`（原片後 30 幀）、`capbaseball/art/ref/pose-front-b.png`（火柴人後 30 幀）、`capbaseball/art/sheets/pitch-front-a.png`（前半張，對齊大小與畫風）

```
Use the first attached image as the character reference: keep the same character design, colours, outfit, glasses, hair, proportions and pixel density exactly, ignore the clothes of the person in the photos. The second attached image is the motion reference: a 5 rows x 6 columns grid of real video frames of this pitch, filmed from where the catcher stands, so he faces the camera and throws toward the viewer. The third attached image is the same 30 frames as stick figures to make the limbs unambiguous: red = his right arm (throwing arm), blue = his left arm, orange = his right leg, cyan = his left leg, white = head and torso. Redraw the character in exactly the pose of each cell, cell by cell, in the same reading order (left to right, top to bottom), with the same position inside each cell, the same camera angle and the same facing direction as the photo. Do not invent poses; copy the photos, including how much his body turns. Ignore everything else in the photos (wall, sky, floor, the red triangle overlay); only the small white bottle cap matters. The fourth attached image is the first half of this same animation: match its scale, cell size, ground line and drawing style exactly so the two sheets play as one seamless animation. This half is the release and follow-through: the right arm whips through low toward the viewer and releases the small white bottle cap (draw the cap leaving his fingers with a short motion streak only in the release frame, after that the hand is empty), then he leans forward and balances on his left leg with the right leg kicked up behind him, and finally sets the right foot down. Pixel-art sprite sheet, 5 rows x 6 columns, 30 frames of one continuous motion, every frame the same scale, feet on the same ground line, the character fully inside its cell with empty space between cells. Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text, no numbers, no grid lines, no labels). Crisp pixel art with the same pixel scale as the reference, dark 1-pixel outline, light from the top-left, no blur. Shirt hem, sleeves, shorts and hair follow through with the motion.
```

## 4. capbaseball/art/sheets/idle-front.png

附圖（依序）：`capbaseball/art/ref/pitcher-ref.png`（角色）、`capbaseball/art/ref/photo-front-a.png`（只看左上第一格的站向）

切格：

```bash
uv run --with pillow --with numpy --with opencv-python python capbaseball/art/slice_sheet.py --name idle --rows 2 --cols 6 --fps 12 capbaseball/art/sheets/idle-front.png
```

```
Use the first attached image as the character reference: keep the same character design, colours, outfit, glasses, hair, proportions and pixel density exactly. Pixel-art sprite sheet of an idle loop, filmed from where the catcher stands: he faces the camera with the same body direction and foot placement as the top-left photo in the second attached image (ignore that person's clothes), both hands together at his chest with the white bottle cap hidden in them, waiting for the sign. Subtle breathing: chest and shoulders rise and fall, the shirt hem and fringe move slightly, one blink around the middle of the loop. 2 rows x 6 columns, 12 frames, a seamless loop (the last frame leads back into the first), every frame the same scale, feet on the same ground line, the character fully inside its cell with empty space between cells. Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text, no numbers, no grid lines, no labels). Crisp pixel art with the same pixel scale as the reference, dark 1-pixel outline, light from the top-left, no blur.
```
