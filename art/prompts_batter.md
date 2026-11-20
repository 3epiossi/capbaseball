# 打者 像素精靈圖：給 Gemini 的提示詞（2026-11-20）

依序做，每段貼進 Gemini 時附上該段列的圖。產出的圖存成段落標題的檔名。

規格：角色在遊戲裡約 96 像素高（與投手 `pitcher-ref.png` 同比例與畫風）。打擊只做捕手後方視角，跟原片同一個鏡頭：從捕手後方往投手方向看，左打者站在右打擊區準備揮棒。揮棒共 30 格（單張 5x6），用 24 fps 播放，約 1.25 秒；待機 12 格（單張 2x6），用 12 fps 循環。

切格：兩張精靈表產出後分別執行下面的指令，會輸出逐格 PNG、整排 strip、預覽 GIF 與 JSON 中繼資料到 `art/frames/swing/` 與 `art/frames/bat-idle/`。

```bash
# 揮棒（30 格）
uv run --with pillow --with numpy --with opencv-python python capbaseball/art/slice_sheet.py --name swing --rows 5 --cols 6 capbaseball/art/sheets/swing-back.png

# 待機（12 格）
uv run --with pillow --with numpy --with opencv-python python capbaseball/art/slice_sheet.py --name bat-idle --rows 2 --cols 6 --fps 12 capbaseball/art/sheets/bat-idle-back.png
```

檢查重點：
- 背景是純色（`#3a3446`），沒有格線、文字或地板標線。
- 每格大小一樣，腳底在同一條線上。
- 左打者（站在右打擊區，面向左／投手方向），每一格都清楚拿著黃色塑膠球棒（藍握把），球棒不可被格子邊緣裁切。
- 揮棒每格的姿勢都要對得上照片參考圖（`ref/bat-photo-back.png`）與火柴人參考圖（`ref/bat-pose-back.png`）的那一格，不要畫出左下角的捕手或背景的投手。
- 參考圖從原片 40 幀平滑後取前 34 幀中的 30 幀，`ref/bat-photo-back.gif` 和 `ref/bat-pose-back.gif` 可以先看動作對不對。

## 1. capbaseball/art/ref/batter-ref.png

附圖：`~/Pictures/IMG_3392.JPG`（揮棒動作／側面參考）、`~/Pictures/IMG_3441.JPG`（正面人像與球衣細節）、`capbaseball/art/ref/batter-back-photo.jpg`（背面球衣「NastYboY 99」）

```
Turn the young man in the three attached photos into a pixel-art game character reference sheet, matching the exact pixel-art style and proportions of a ~96-pixel-tall retro sports sprite. Keep his real look: slim young East Asian man, dark charcoal-olive baseball cap with a small white "NY" logo on the front. Outfit exactly as in the photos: dark navy blue baseball raglan jersey with white short sleeves ending in dark navy cuff stripes and small logos on both sleeves, white curved "Chung Cheng" script across the chest with small white "UNIV." and "99" lower on his left chest, and on the back white "NastYboY" above a big white "99"; black athletic shorts with thin light-blue side piping, black Mizuno knee pads on both knees, bare calves, black running shoes with white soles. He is a left-handed batter holding a smooth bright yellow plastic bat with royal blue grip tape. Layout: one row of 3 full-body standing poses, same scale, feet on one baseline: facing the camera (front view), facing left in ready batting stance (side view), facing away (back view showing "NastYboY" and "99"). Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text labels, no grid lines). Crisp pixel art, the character about 96 pixels tall with every pixel a clear square block, dark 1-pixel outline, light from the top-left, limited palette, no blur, no anti-aliasing.
```

## 2. capbaseball/art/sheets/swing-back.png

附圖（依序）：`capbaseball/art/ref/batter-ref.png`（角色）、`capbaseball/art/ref/bat-photo-back.png`（原片 30 幀）、`capbaseball/art/ref/bat-pose-back.png`（火柴人 30 幀）

```
Use the first attached image as the character reference: keep the same character design, colours, cap, navy-and-white raglan jersey ("NastYboY" and "99" on back), shorts with light-blue piping, black knee pads, shoes, yellow plastic bat with royal blue grip, proportions and pixel density exactly; ignore the clothes of the person in the photos. The second attached image is the motion reference: a 5 rows x 6 columns grid of real video frames of this left-handed swing, filmed from behind the catcher looking toward the pitcher, with the batter in the right batter's box. The third attached image is the same 30 frames as stick figures to make the limbs unambiguous: red = his right arm, blue = his left arm, orange = his right leg, cyan = his left leg, white = head and torso. Redraw the character in exactly the pose of each cell, cell by cell, in the same reading order (left to right, top to bottom), with the same position inside each cell, the same camera angle and the same facing direction as the photo. Do not invent poses; copy the photos, including how much his body turns. Ignore everything else in the photos (the catcher in the bottom-left, the pitcher in the background, gym floor lines, walls). Draw the bright yellow plastic bat with royal blue grip tape clearly in every single frame, and add a crisp short pixel motion streak on the yellow bat during the contact and swing-through frames (row 2). Pixel-art sprite sheet, 5 rows x 6 columns, 30 frames of one continuous stance -> load -> swing -> contact -> follow-through motion, every frame the same scale, feet on the same ground line, the character and the entire bat fully inside each cell with empty space between cells. Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text, no numbers, no grid lines, no labels). Crisp pixel art with the same pixel scale as the reference, dark 1-pixel outline, light from the top-left, no blur. Jersey hem, sleeves and shorts follow through with the motion.
```

## 3. capbaseball/art/sheets/bat-idle-back.png

附圖（依序）：`capbaseball/art/ref/batter-ref.png`（角色）、`capbaseball/art/ref/bat-photo-back.png`（只看左上第一格的站向與預備姿勢）

```
Use the first attached image as the character reference: keep the same character design, colours, cap, navy-and-white raglan jersey ("NastYboY" and "99" on back), shorts with light-blue piping, black knee pads, shoes, yellow plastic bat with royal blue grip, proportions and pixel density exactly. Pixel-art sprite sheet of a batting idle loop, filmed from behind the catcher looking toward the pitcher: the left-handed batter stands in the right batter's box with the exact same body direction, athletic crouch, and foot placement as the top-left photo in the second attached image (ignore that person's clothes and background), both hands gripping the bright yellow plastic bat with royal blue grip tape held ready near his left shoulder. Subtle breathing (chest and shoulders rise and fall slightly) and a gentle, rhythmic bat waggle (the yellow bat tilts smoothly in a ready motion). 2 rows x 6 columns, 12 frames, a seamless loop (the last frame leads smoothly back into the first), every frame the same scale, feet on the same ground line, the character and bat fully inside each cell with empty space between cells. Plain flat single-colour background (solid #3a3446, no gradient, no ground shadow, no scenery, no text, no numbers, no grid lines, no labels). Crisp pixel art with the same pixel scale as the reference, dark 1-pixel outline, light from the top-left, no blur.
```
