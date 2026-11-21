# `src` 前端應用入口與主控模組

## 模組總覽

`src` 根目錄負責整合遊戲主迴圈、DOM 介面事件、雙層 Canvas 調度、單機／雙人／練習／線上對戰流程以及跨裝置自適應佈局。入口頁面 [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) 載入 [main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 與 [styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css)，在啟動時載入精靈圖集並以 `requestAnimationFrame` 驅動全螢幕遊戲舞台。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) | 定義雙層 Canvas（`#pixel-canvas`、`#overlay-canvas`）、頂部 HUD（`.hud-top-region`）、漢堡選單、右下角 Messenger 對話球（`#chat-hub`）、全螢幕轉場層（`#v2-transition-layer`）、`#update-banner` 與原生 `<dialog>` 視窗。 |
| [main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) | 管理遊戲狀態機、循序呈現佇列（`PresentationQueue`）、光譜整合彈簧投球、下方游標觸控打擊、線上揮棒時序佇列同步、投球時鐘、行動版自動更新輪詢與零 `innerHTML` 安全 DOM 更新。 |
| [styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) | 實作 16-bit 像素播報風格樣式、精簡放大 BSO 燈號計分板、單列右上狀態列、右下角 Messenger 對話球與 `@container` 響應式規則。 |
| [i18n/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/i18n/index.ts) | 依瀏覽器語系自動切換繁體中文（`zh-TW`）、日文（`ja`）與英文（`en`），並保留國際通用棒球紀錄字母（`R`、`H`、`K`、`ꓘ`、`1B`、`2B`、`3B`、`AB`、`HR`、`BB`、`IBB`、`P`、`O`、`ABS`）。 |
| [ui/emotes.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/emotes.ts) | 統一管理右下角 Messenger 圓形對話球、水平滑出橫條氣泡、近期紀錄與 8 組純文字三語快捷對話（前端 3 秒倒數冷卻）。 |
| [ui/transitions.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/transitions.ts) | 驅動開賽、三振出局、全壘打／再見安打、攻守交換與比賽結束等全螢幕轉場動畫，以及擊球頓幀／慢動作／震動特效。 |
| [ui/boxScore.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/boxScore.ts) | 繪製賽後各局得分表（`R`/`H`/`K`/`BB`）、提前結束標籤與本場 MVP 卡片（零 `innerHTML`）。 |

---

## 核心資料流／演算法

### 1. 頂部計分板、循序呈現佇列與 ABS 方案 B（`.hud-top-region`、`PresentationQueue`）

- **精簡放大 BSO 燈號計分板（`#scoreboard`）**：左欄客主隊名與比分、中欄壘包鑽石與 `▲/▼ 局數`／投球時鐘、右欄三列圓點燈號（`B` 綠 `#4ade80`、`S` 黃 `#f4c41c`、`O` 紅 `#f43f5e`）與 `ABS □□`（每隊每場 2 次）。移除冗餘球數與右側留白，球種／球速／變化量整合進側邊回饋卡，且全站保留國際通用棒球字母（`AB`、`P`、`R`、`H`、`K`、`ꓘ`、`1B`、`2B`、`3B`、`HR`、`BB`、`IBB`、`O`、`ABS`）。
- **移除上方浮動消息框，統一由循序呈現佇列調度**：已完全移除舊版 `#swing-feedback-card` 浮動消息。擊出球飛行與鏡頭回拉期間畫面全淨空；待 `cam.isNearRest()` 回到本壘定點，側邊雙格卡才與裁判提示音（含界外球專屬 `'foul'` 雙響音）於同一幀同步出現。期間鎖定投球並暫停投球時鐘，卡片淡出後再依序接續 `strikeout` → `inning_change` → `game_over`（附 Box Score 與 MVP）或廣播 `next_batter`。
- **ABS 方案 B 原地翻牌**：未揮棒且具挑戰資格時，側邊卡立即顯示主審判決與球種球速，但 3×3 區域以 `? ABS 可挑戰` 遮罩防劇透；2.2 秒未按 `[ABS]` 則原地閃光揭曉真實進壘點，按下則切入 3D 鷹眼重播。
- **字體選擇**：一般介面與播報文字採用 `Chakra Petch` 提升小尺寸辨識度，主標題保留 `Silkscreen`。

### 2. 右上角單列狀態與右下角 Messenger 對話球（`.top-bar`、`#chat-hub`）

- **右上單列狀態列（`.top-bar`）**：移除毫秒延遲膠囊，將伺服器負載與連線品質顏色（`good`/`fair`/`poor`/`busy`）直接反映在「在線人數（`#top-online-pill`）」上，桌機與手機一律與 `☰` 漢堡鈕橫向排成單列。
- **右下角 Messenger 對話球（`#chat-hub`）**：採圓形藍底白邊雙對話框圖示，統一承載對手純文字快捷對話（8 組梗語錄三語自動對譯、3 秒冷卻）、賽事廣播（下一棒、`IBB`、投球超時）與線上系統通知（斷線重連、再戰請求、選單逾時、維護通知）。訊息從左側以單行圓角橫條滑出（`width: max-content; white-space: nowrap`）；直立手機投球時由 `updateSafeCameraFraming()` 自動抬升至投手面板上方避免遮擋。
- **暫停與返回導航（`isGamePaused` / `navigateBack`）**：開啟選單、規則或 4 分頁設定對話框時，單機對戰會立即暫停物理與計時器；**線上對戰開啟選單時不停止比賽，且會於 `#menu-online-timer` 顯示 20 秒倒數，時間歸零即強制關閉選單恢復操作**；支援點擊與全域 `Escape`／`Backspace` 快捷鍵返回。
- **行動版自動更新提示（`#update-banner`）**：採 `position: fixed; z-index: 140;` 避免被頂部容器裁切，於啟動、`visibilitychange`、`pageshow`、`focus`、`online` 與每 30 秒以 `./health?_t=...` 破除快取比對版本。

### 3. 光譜整合彈簧投球、投球時鐘與手機拖曳打擊

- **光譜整合彈簧發射器（`springMeter`）**：彈簧線圈直接繪製於 `NORMAL · BEST · OVER` 光譜軌條上——按住左側壓縮（`charging`）→ 放開後彈簧向右伸展彈射至最高點（`rebounding`）→ 鎖定峰值（`locked`）決定球速與控球並出手。
- **手機觸控打擊（下方游標操作＋直接點擊，`activeBatTouchId`）**：預設於好球帶下方（`y < 0.42m`）觸控、或好球帶內拖曳 `≥ 6px`／按住 `≥ 130ms` 時，立即鎖定向上偏移 `76–124px` 讓準心位於指尖上方不遮擋瓶蓋，放開即揮棒；快速輕點（`< 6px` 且 `< 130ms`）則維持零偏移直接對點打擊，設定中保留「僅限點擊揮棒」選項。
- **線上揮棒同步與結算防卡死**：收到擊球 `pitch_result` 時先以 `queuedOnlinePitchResult` 對齊投手端本地飛行時間，提前 `110ms` 播出打者揮棒動畫並延遲 `180ms` 追球；`match = msg.match` 延後至 `finishBattedPlay()` 套用，確保最後一球再見安打或出局不會提前被 `isGameOver` 卡死在空中。

### 4. 主選單分流、10 秒自動切 CPU 與負載備援

首頁大廳（`#lobby-hub`）並列「線上對戰」、「好友對戰」、「CPU 對戰（內含三局對戰、打擊練習、投球練習）」與「即時觀戰」。點擊線上對戰（`#btn-hub-play`）前與排隊過程中，`main.ts` 持續監聽 `onlineClient.onNetUpdate`：

- 若排隊滿 10 秒仍找不到真人對手，或偵測到 `onlineClient.isServerBusy`（僅伺服器負載達 `red` 過載時）或 `onlineClient.isUnstable`（斷線、連線逾時或 `netQuality === 'poor'`），系統自動取消排隊並執行 `autoFallbackToCpu`。
- `autoFallbackToCpu` 會直接啟動單機 `quick3` 3 局制電腦對戰，並在 Play Call 卡片提示對應狀態（`AUTO CPU`），確保玩家不因排隊久候或網路異常中斷遊玩。

### 5. 零 `innerHTML` XSS 防護與跨裝置安全區框景

- **安全 DOM 建構**：戰績結算視窗（`showGameOverModal`）、即時觀戰列表（`renderWatchRooms`）與大廳狀態文字一律使用 `replaceChildren()`、`document.createElement()` 與 `textContent` 寫入內容，完全不使用 `innerHTML`，阻斷任何來自玩家暱稱或伺服器字串的 XSS 注入。
- **跨瀏覽器／裝置佈局**：`styles.css` 以 `100dvw`／`100dvh` 搭配 `env(safe-area-inset-*)` 適配 iOS 劉海與動態網址列，觸控裝置下為主要按鈕套用至少 `44px` 點擊高度；透過 `.game-viewport` 的 `@container (max-width: 780px)` / `(max-width: 420px)` 與橫向短螢幕規則（`max-height: 500px`），結合 `updateSafeCameraFraming()` 動態調整鏡頭垂直投影中心，確保手機直／橫向時好球帶完整落在頂部 HUD 與底部投手面板之間。

---

## 與其他模組的相依關係

- **相依於 `src/render`**：透過 `GameCamera`、`drawGymBackground`、`buildFenceDepthItems`、`drawWorldEntities` 與 `drawStrikeZoneAndOverlay` 完成背景與前景高 DPI 繪製。
- **相依於 `src/physics`、`src/rules`、`src/ai`、`src/audio`**：在單機與練習模式驅動完整投打物理、規則判定、CPU 行為與程序化音效。
- **相依於 `src/net`**：透過 `OnlineClient` 管理 WebSocket 連線、v2 封包收發、2 秒延遲監測與斷線重連會話存取。
