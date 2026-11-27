# fallen skywalker — Cap Baseball（瓶蓋棒球）

以 **2025 年 2 月版瓶蓋棒球規則**為核心打造的 16-bit 像素風格 3D 競技網頁遊戲，支援單機對戰 CPU、本機雙人、打擊／投球練習、即時線上隨機配對（含自動降級 CPU 備援）、朋友私房對戰與即時觀戰。

- **Fork 來源（Upstream）**：https://github.com/koshien2015/cap-flight-sim （感謝原作者開源之 6-DOF 瓶蓋飛翔物理模擬核心）
- **正式上線網址**：https://3epiossi.com/capbaseball
- **3D 投球實驗室**：https://3epiossi.com/capbaseball/pitch-lab
- **目前里程碑**：`v2.8.0`（語意化三段式版本號）
- **支援語系**：自動偵測繁體中文（`zh-TW`）、日本語（`ja`）與英文（`en`）

---

## 快速開始

```bash
# 安裝依賴
npm install

# 本機開發（Vite 前端）
npm run dev

# 執行完整型別檢查與單元／整合測試（3 檔 67 項測試）
npx tsc --noEmit && npm test

# 建置正式產物（dist/ + dist-server/index.mjs）
npm run build

# 啟動本地正式伺服器（http://127.0.0.1:8788/capbaseball/）
PORT=8788 HOST=127.0.0.1 npm run server

# 部署至 Raspberry Pi（測試 + 建置 + 優雅換版 + 健康檢查）
./scripts/deploy.sh
```

---

## 模組結構與子文件導覽

| 模組 | 說明文件 | 職責摘要 |
|---|---|---|
| `src/` | [src/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/README.md) | 遊戲主迴圈、DOM/HUD 控制、彈簧投球、Play Call／ABS 流程、跨裝置排版與 XSS 防護。 |
| `src/physics/` | [src/physics/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/README.md) | 6-DOF 瓶蓋空氣動力學、5 種變化球（含蝴蝶球尾流）軌跡求解、揮棒接觸與擊球彈道物理。 |
| `src/rules/` | [src/rules/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/README.md) | 2025-02 瓶蓋棒球規則引擎、好球帶、出局／得分與 ABS 挑戰判定。 |
| `src/render/` | [src/render/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/README.md) | 雙層 Canvas、`GameCamera` 3D 透視投影與動態安全區框景、禮堂舞台、精靈圖與 3D 瓶蓋繪製。 |
| `src/ai/` | [src/ai/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/README.md) | CPU 投打 AI 與外野手追球動畫邏輯。 |
| `src/audio/` | [src/audio/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/audio/README.md) | Web Audio API 零外部音檔程序化音效。 |
| `src/net/` | [src/net/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/README.md) | 精簡 v2 WebSocket 協定與 RTT／Jitter 連線品質監測。 |
| `server/` | [server/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/README.md) | 權威對戰伺服器、配對佇列、朋友房／觀戰、綠黃紅負載保護與安全標頭。 |
| `deploy/` | [deploy/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/README.md) | Raspberry Pi `systemd` 服務與 Cloudflare Tunnel 正式網域設定。 |
| `scripts/` | [scripts/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/scripts/README.md) | 自動化測試、打包、上傳、換版與回滾腳本。 |
| `tests/` | [tests/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/README.md) | 物理、規則與多人連線整合測試套件。 |

---

## v1.0.0 開發、除錯與上線歷程實錄（給後續 AI 的交接脈絡）

以下完整記錄從開發調整到 Raspberry Pi 正式上線期間遇到的所有關鍵問題、設計決策與修正細節：

### 1. 投打操作與手感調整
- **兩階段彈簧投球發射器**：修正原本「蓄力放開直接出手」的問題，改為「按住壓縮蓄力 → 放開彈出並觀察指針最高點落在 `SOFT · BEST · OVER` 光譜區間 → 短暫鎖定峰值後實際出手」。
- **介面精簡與按鈕整理**：移除投球 `TRAIL` 與打擊 `SWING` 等多餘按鈕；右上角固定 2 排顯示玩家狀態、網速、線上人數與功能按鈕；`MENU` 固定於最右側避免左右切換時按鈕出現／消失造成排版抖動；將返回／主選單／棄權收進 `MENU` 對話框並支援快捷鍵返回。
- **字體清晰度**：避免小像素英數字黏連，UI 與播報卡片主力字體改用 `Chakra Petch`（標題保留 `Silkscreen`）。

### 2. 判定資訊、ABS 與對局流程修正
- **Play Call 與 ABS 位置及大小**：將 `FOUL` / `TOO LATE` / `SINGLE` / `DOUBLE` 等 Play Call 卡片與 `ABS` 挑戰按鈕移至好球帶正上方，簡化 `ABS` 按鈕文字僅保留 `ABS` 與倒數條，並放大按鈕點擊區（`min-width: clamp(132px, 15vw, 176px)`, `min-height: 48px`）以免手機誤觸不到。
- **按 `MENU` 暫停遊戲**：單機模式開啟 `MENU` / 規則 / 設定對話框時，`isGamePaused()` 會暫停物理、計時器與 CPU 行為。
- **Play Call／ABS 完全消散前鎖定投球**：`isPlayCallActive()` 會等待 Play Call 卡片、ABS 挑戰按鈕及 ABS 重播完全淡出歸零後，才解鎖 `#btn-throw`、空白鍵蓄力與 CPU 自動投球。
- **同步淡出 ABS 與判定訊息**：初版 `absPromptTimer` 固定 `3.0s`，比 `STRIKE` / `BALL` 卡片（`2.2s`）晚消失。已新增 `startAbsPromptWindow()`，讓 `ABS` 與 Play Call 卡片共用相同的 TTL 與最後 `0.4s` 淡出曲線，同時消失。
- **揮空直接顯示 timing 結果**：移除原本揮棒落空時會先閃紅色 `MISS` 再跳出 `TOO LATE` 的設計，改為直接顯示 `TOO LATE` / `TOO EARLY` / `OFF TARGET`。
- **進好球帶後才揭露球種與球速**：投球蓄力與飛行途中（`windup` / `pitch_flight`），計分板遙測只顯示 `IN FLIGHT`，直到球通過本壘板或擊中後才顯示實際球種、球速與位移量。

### 3. 精靈圖修補與跨裝置／手機版重排版
- **投手精靈圖破洞修補**：檢查 `public/sprites/pitcher_strip.png` 與 `public/sprites/pitcher_black_strip.png` 發現 15 個影格的大腿／短褲處（`y=48..80`）存在封閉透明破洞，已透過邊界色向內填補共 **1,007 個像素**。
- **手機直向／橫向重排版（零重疊）**：
  - 初版手機直向截圖出現「計分板遮住右上按鈕」與「底部投手控制面板遮住好球帶下緣」問題。
  - 已在 `index.html` 與 `src/styles.css` 將計分板與右上工具列整併進同一個 `.hud-top-region` Flex 容器（桌機左右並排、手機自動垂直堆疊，徹底消除硬寫 `top` 造成重疊的風險）。
  - 在 `GameCamera` 新增動態垂直投影中心 `setTargetCenterYRatio()`，依據頂部 HUD 下緣與底部投手面板上緣自動計算安全區框景，使好球帶與本壘板居中不被面板遮擋，同時保持 `screenToPlaneZ()` 觸控瞄準座標完全一致。
  - 手機橫向短螢幕（`max-height: 500px`）將球種選擇改為左下角緊湊 2×2 網格，與計分板留出淨空。

### 4. 線上對戰、延遲容忍與觀戰設計
- **朋友房刻意對觀戰公開**：`server/index.ts` 的 `case 'list'` 只過濾尚未開打或已結束的房間，朋友房開打後亦會出現在觀戰列表（`room_list`）供觀戰（`tests/multiplayer.test.ts` 第 5 項整合測試覆蓋此行為）。
- **放寬網路延遲門檻**：初版將 `avgRttMs > 280ms` 或 `jitterMs > 120ms` 視為 `poor` 並自動退回 CPU，導致經 Cloudflare Tunnel 與行動網路連線的玩家容易被踢出線上配對。因本遊戲為回合制投打同步，已放寬為：
  - `good`：`avgRttMs <= 220ms` 且 `jitterMs <= 120ms`
  - `fair`（可正常連線對戰）：`avgRttMs <= 650ms` 且 `jitterMs <= 350ms`
  - `poor`（觸發 CPU 自動備援）：`missedPings >= 3`（單次逾時 `2500ms`）、`avgRttMs > 650ms` 或 `jitterMs > 350ms`
  - 初始配對連線逾時從 `2400ms` 放寬至 `4500ms`。

### 5. 資安強化、Pi 環境與正式網域踩雷紀錄
- **停用舊服務**：已確認 Pi 上的黑白棋服務（`reversi-royale.service`、`rr-quick.service`、`rr-tunnel.service`）維持 `inactive (dead)` 狀態。
- **應用程式與 Pi 服務安全**：
  - 前端零 `innerHTML` 拼接；後端全面回傳 `CSP`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`。
  - `capbaseball.service` 設定 `HOST=127.0.0.1` 僅監聽本機回環埠 `8788`（透過 `ss -tulpn` 實測從 `*:8788` 收斂為 `127.0.0.1:8788`）；`~/capbaseball/data` 權限收緊為 `700` / `600`。
  - `npm audit --omit=dev` 回傳 `found 0 vulnerabilities`。
  - 作業系統層（`ufw`、`fail2ban`、`unattended-upgrades`）因需 Pi 本機 `sudo` 權限，已提供指令由擁有者於本機執行（務必先放行 `22/tcp`、`5353/udp` 與 `tailscale0`）。
- **正式網域綁定與 DNS 負快取排查**：
  - 使用 Pi 上既有 `cloudflared` 憑證建立 Named Tunnel `capbaseball`（UUID：`aa7dc803-241e-4b05-95ff-9049bacb417c`），透過 `~/.cloudflared/capbaseball.yml` 將 `3epiossi.com` 下的 `^/capbaseball(/.*)?$` 轉發至 `http://127.0.0.1:8788`，並切換為常駐 `capbaseball-tunnel.service`（停用 `capbaseball-quick`；`scripts/deploy.sh` 已同步防呆）。
  - **排錯紀錄**：上線當下 Mac 端曾持續遇到 `ERR_NAME_NOT_RESOLVED`，經查權威 DNS（`1.1.1.1` / `8.8.8.8` / 路由器 `192.168.1.1`）皆已正常解析，實因 **Tailscale MagicDNS (`100.100.100.100`) 暫存了較早的 SOA 負快取**導致 Mac `mDNSResponder` 只快取 `AAAA` 而無 `A` 紀錄；待 Tailscale DNS TTL 過期後重啟 `mDNSResponder` 即可恢復正常。

### 6. v1.0.0 後續線上修復、手遊操控與開源協作紀錄（2026-11-21）

- **修復好友對戰結束卡死、無結算視窗**：
  - **原因**：擊出安打／出局的 `pitch_result` 在進入 `batted_flight` 前就提前賦值 `match = msg.match`，導致 `match.isGameOver` 立刻變 `true` 而被主迴圈 `if (!onTitleScreen && !match.isGameOver)` 擋在門外，`finishBattedPlay()` 與 `showGameOverModal()` 永遠不會執行；加上 `#result-dialog` 原本設有 `closedby="any"` 易誤觸關閉，且重連進已結束房間時未重開結算框。
  - **解法**：擊球後延後至 `finishBattedPlay()` 才套用 `msg.match`（同步防止飛球途中隊色與分數提前劇透），主迴圈放行 `batted_flight`／`result` 階段跑完，重連已結束對局會直接開啟結算視窗，並移除 `#result-dialog` 的 `closedby="any"`。
- **修復手機投手視角「沒看到揮棒就出現二壘安打」**：
  - **原因**：投手端收到 `pitch_result` 時無視本地 `windup`/`pitch_flight` 進度立即切進 `batted_flight`，跳過 `load` → `swing_early` 並在首幀將鏡頭切往外野；另每幀 `resizeCanvases()` 觸發 `getBoundingClientRect()` 造成手機掉幀漂移。
  - **解法**：`resizeCanvases()` 改為僅尺寸變更時重算安全區；新增 `queuedOnlinePitchResult` 依接觸時間同步在投手端提前 `110ms` 播出 `load` → `swing_early` → `swing_contact` 揮棒動畫，並讓鏡頭於本壘停留 `180ms` 後再追蹤飛球。
- **判定訊息與好球帶 3D 投影脫鉤**：`.zone-top-hud` 改為固定釘在螢幕前景安全區（不再跟隨 3D 鏡頭或追球運鏡移動）。
- **手機觸控拖曳放開打擊＋多語系自動偵測**：新增 `activeBatTouchId`（按住拖曳移動球棒、放開即揮棒，同時保留點擊揮棒），並加入 `src/i18n/index.ts` 自動偵測 `ja`／`zh-TW`／`en`。
- **路線 A 競技與維運機制**：加入 **投球時鐘（15s/20s）**（伺服器權威計時＋超時自動壞球，測試通過 31/31 項）與 **伺服器更新刷新橫幅**（比對 `__BUILD__` 與 `welcome`/`/health`）。
- **UI 收斂與大螢幕可讀性**：將右上角收折為單列 `[在線] [☰]` 漢堡選單，並將打擊時的「左／右打切換（`#btn-hand`）」與「一般／強振模式（`#btn-swing-type`）」移入可折疊的 `☰` 選單內（不佔用主畫面空間）；將彈簧線圈直接整合進 `SOFT–BEST–OVER` 光譜軌條上方，並放大桌機計分板與投手面板字體。
- **線上模式選單計時強制恢復**：單機模式開啟 `☰` 選單會無限暫停遊戲；但在線上對戰模式下，開啟選單／規則／設定會啟動 **20 秒倒數（`#menu-online-timer`）**，時間一到會強制關閉選單並恢復進行，防止拖延或卡住對戰節奏。
- **開源授權（MIT License）**：根目錄已補上 [`LICENSE`](file:///Users/chang/Documents/raspberry%20pi/capbaseball/LICENSE)（MIT 授權）並更新 [`.gitignore`](file:///Users/chang/Documents/raspberry%20pi/capbaseball/.gitignore) 排除本地參考 PDF 與規劃文件。
- **GitHub Fork 協作說明（`3epiossi/capbaseball` ← `koshien2015/cap-flight-sim`）**：
  - 本專案已透過 Fork 正式關聯上游 `koshien2015/cap-flight-sim`。因本機採獨立 `git init` 起步，GitHub 網頁會顯示 `ahead / behind koshien2015/cap-flight-sim:master`；**切勿點擊 GitHub 上的 `Sync fork` 或 `Discard commits`**（否則會將不相關目錄結構合併進來或清空本專案），需要參考上游物理演算法時於本機使用 `git fetch upstream` 查閱即可。

### 7. 124 人同步在線實測排查、過載門檻放寬與全方位流量監控（2026-11-21）

在真實 124 人同時連線至 Raspberry Pi 的壓測高峰期，直接抓取 `/health` 與 Pi 系統數據發現異常真相：**Pi CPU 僅 `16.2%`、事件迴圈延遲僅 `1ms`、RSS 僅 `91MB / 3795MB`、溫度 `51.6°C`、`throttled=0x0`**，卻只有 `1` 個對戰房間、其餘玩家全數被導向單機 CPU！排查出五大瓶頸並完成修正：

- **解除假性 `SERVER BUSY` 鎖死線上對戰**：
  - **原因**：舊版 `MAX_CLIENTS=80` 導致超過 `64` 位瀏覽/單機玩家開著網頁時，伺服器即進入 `yellow`（`80` 進 `red`），且客戶端 `isServerBusy` 與伺服端 `queue`/`create` 雙雙設定「只要非 `green` 就拒絕並轉單機 CPU」，使上百人同時在線卻互相無法配對線上對戰。
  - **解法**：將預設上限放寬為 `MAX_CLIENTS=500`、`MAX_ROOMS=80`、`MAX_RSS_MB=640`、事件迴圈延遲 `yellow >= 80ms / red >= 160ms`；且 `yellow` 改為純預警，**前後端統一只有 `red` 真正過載時才觸發 `server_busy` 與 `BUSY` 燈號**。
- **放寬同 IP 連線上限**：`MAX_CONN_PER_IP` 由 `12` 調升至 `48`，避免同校 Wi-Fi、宿舍或電信商 CGNAT 多人同時遊玩遭到 `1008 too_many_connections` 斷線。
- **消除 $O(N^2)$ 廣播與雙重心跳風暴**：新增 `scheduleStatsBroadcast()`（`800ms` 防抖合併，且 legacy / compact v2 各自只做一次 `JSON.stringify`），定時廣播調為 `5000ms`；伺服器心跳預設調為 `5000ms`（前端 `4000ms` 探測），任何進站訊息同步刷新 `lastPongAt`，大幅削減控制封包。
- **記憶體靜態快取（Zero Disk I/O）**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 啟動時將 `dist/` 與 `.gz` 一次載入 `staticCache` 並支援 `ETag` / `304 Not Modified`。
- **全方位流量監控系統**：新增 [server/monitor.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitor.ts) 與 [server/monitorUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitorUi.ts)，提供：
  - 即時儀表板：[`https://3epiossi.com/capbaseball/monitor`](https://3epiossi.com/capbaseball/monitor)（嚴格相容 CSP，Zero PII）
  - JSON 遙測 API：[`https://3epiossi.com/capbaseball/metrics`](https://3epiossi.com/capbaseball/metrics)（可選 `MONITOR_TOKEN` 驗證與 `METRICS_LOG` 每分鐘落地紀錄）
  - 涵蓋 HTTP/WS 速率與頻寬、前 10 大封包類型、連線角色拆解、拒收/斷線計數、物理求解耗時、事件迴圈延遲、CPU/RAM 與 Raspberry Pi 溫度／降頻狀態。

### 8. 主選單重構、多核心物理 Worker 池與協定層心跳最佳化（2026-11-21）

- **主畫面選單獨立「CPU 對戰」＋ 10 秒自動進 CPU**：
  - 首頁 `#lobby-hub` 改為四項並列：**線上對戰**、**好友對戰**、**CPU 對戰**、**即時觀戰**。
  - 點擊 **CPU 對戰** 後細分為三種單人模式：**三局對戰**、**打擊練習**、**投球練習**（移除舊版 `hotseat2p`）。
  - 當 **線上對戰** 排隊滿 10 秒仍找不到真人對手時，改為直接自動進入 CPU 三局對戰（不再停留在彈出選單要求重選）。
- **訪客隨機代號與 12 字元上限**：未自訂名稱的玩家自動配發 6 碼不重複隨機英數代號（如 `K7M2Q9`），自訂名稱前後端統一上限為 12 字元。
- **消除高併發 Event Loop Lag（94ms → 個位數 ms）**：
  - **問題實測**：在 92 人在線、40 間對戰房的 Pi 實測中，`/metrics` 顯示單次 `solvePitchTrajectory` 平均耗時 `93.95ms`（最慢 `468.79ms`），導致 Event Loop p95 Lag 持續在 `60–128ms` 震盪並頻繁觸發 `LAG_SPIKE`／`LOAD_YELLOW`（但 4 核 Pi 總 CPU 僅 `34.2%`、溫度 `53.1°C`、`throttled=0x0`）。
  - **解法**：[server/physicsPool.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/physicsPool.ts) 與 [server/physicsWorker.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/physicsWorker.ts) 建立多核心 `worker_threads` 池（4 核 Pi 預設 3 Workers），將 `solvePitchTrajectory`（維持 `120Hz` 前後端完全一致）與 `evaluateSwingResolution` 移出主事件迴圈，並以 `room.solvingSeq` 防護非同步重複送出；建立 Worker 時明確傳入 `{ execArgv: [] }` 避免繼承父程序旗標造成 `ERR_INPUT_TYPE_NOT_ALLOWED`。
  - [src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 改以解析式拋物線計算無氣動基準落點 `ballisticPos`，省去每球多跑一次 RK4 模擬。
  - `appendMatchLog` 改佇列化非同步 `fs.promises.appendFile`（排除 SD 卡同步寫檔阻塞），`vcgencmd` 降頻至 60 秒，`/metrics` 新增 1 秒 JSON 快取。
- **手機下方游標操作（プロスピ風）＋ 直接對點點擊打擊**：
  - **玩家回饋**：日本玩家反映手機打擊時手指壓在好球帶上會擋住飛過來的瓶蓋，希望改成像《プロスピA》從下方操作游標。
  - **實測除錯**：初版針對好球帶內觸控採「隨移動距離漸變偏移」，本地手機實測發現小幅拖曳時準心仍黏在手指下、往回拉還會歸零。已改為「好球帶下方（`y < 0.42m`）按下即偏移；好球帶內只要拖曳 `≥ 6px` 或按住 `≥ 130ms` 即立刻鎖定完整向上偏移 `76–124px`、放開即揮棒」，而快速輕點（`< 6px` 且 `< 130ms`）則維持零偏移對點打擊，完全淘汰舊版手指壓住拖曳模式且無須額外切換按鈕。
- **RFC 6455 協定層心跳與分流統計**：改用 `ws.ping()`／`ws.on('pong')`（12s 間隔／36s 逾時）避免手機切背景凍結 JS 被誤斷線，並將大廳閒置關閉（`idleClosed`）與對戰中失聯（`deadPongTimeout`）分開計算。

### 9. v2.0.0 畫面流程重構、物理包絡線、Messenger 對話球與除錯紀錄（2026-11-22）

本次升級為語意化版本 `v2.0.0`，完整重整比賽畫面節奏、跨裝置佈局、物理邊界與多人房操作，並修正實測過程中發現的多項問題：

- **變速球包絡線跳動與軌跡準心脫鉤**：
  - **問題**：初版球種包絡線（天花板／地板／左右側牆）使用固定最小步階 `Math.max(0.6, ...)` 往回推發射角，導致變速球在高點微調目標時高度上下跳動；且準心顯示原始目標而非受限後的真實擊球點，造成軌跡與控制點分離。
  - **解法**：[src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 改以 7 步單調二分搜尋分別收斂仰角與方位角，並將準心位置直接綁定包絡線求解後的 `simToField(res.hitPlanePos)`。
- **側邊回饋卡隨鏡頭回拉漂移、與文字／好球帶重疊**：
  - **問題**：擊球回拉鏡頭時，側邊卡原本引用動態 `liveCam` 座標，導致卡片跟著好球帶移動；手機直向版曾嘗試改放好球帶上方，結果壓到上方消息框；此外初版揮棒示意圖的球棒軸心偏離本壘板太遠，且打者視角左右側放反。
  - **解法**：[src/render/overlay.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/overlay.ts) 改以獨立靜止攝影機 `restCam` 鎖定本壘位置；依捕手視角放置於打者對側空位（左打者站畫面右側，卡片放左側；右打者站畫面左側，卡片放右側），全裝置寬度嚴格限制在 `<= sideSpace`；球棒與紅黃綠扇形區調整至正中央橫掃本壘板上方，揮棒瞬間立刻清除 3D 實時括號 PCI。
- **移除上方浮動消息框與循序呈現佇列（`PresentationQueue`）**：
  - **問題**：上方 Play Call 卡片與側邊卡、全螢幕轉場同時出現造成資訊重複與視覺干擾，且投手在卡片尚未消失前就能搶投下一球。
  - **解法**：徹底移除 `#swing-feedback-card` 與 `callout`；擊球飛行與鏡頭回拉期間保持畫面淨空，等 `cam.isNearRest()` 回到本壘才跳出側邊雙格卡，並於期間鎖定投球、暫停投球時鐘；卡片淡出後依序接續 `strikeout` → `inning_change` → `game_over`（附 [src/ui/boxScore.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/boxScore.ts) 各局得分表與 MVP）。
- **ABS 方案 B 原地翻牌流程**：
  - 未揮棒且具挑戰資格時，側邊卡先以 `? ABS 可挑戰` 遮罩蓋住 3×3 好球帶避免劇透，2.2 秒未按 `[ABS]` 則原地閃光翻牌揭曉真實落點；按下挑戰則立即收起側邊卡並進入 3D 鷹眼重播，播畢後再接後續轉場。
- **計分板 BSO 圓點燈號、全站棒球字母與頂部單列對齊**：
  - 計分板改為三列圓點燈號（`B` 綠 `#4ade80`、`S` 黃 `#f4c41c`、`O` 紅 `#f43f5e`）並統一全站好壞球／出局色系；移除冗餘球數與毫秒延遲膠囊，將伺服器負載顏色整合至「在線人數」並與 `☰` 橫向排成單列。
  - 全面保留國際通用棒球紀錄字母（`R`、`H`、`K`、`ꓘ`、`1B`、`2B`、`3B`、`AB`、`HR`、`BB`、`IBB`、`P`、`O`、`ABS`），修正中／日文版 Box Score 出現 `得 / 安 / 振 / 保` 與 MVP 出現 `12總 · 5振` 的問題。
- **右下角 Messenger 對話球（廣播＋純文字快捷對話）與直排折行修正**：
  - **問題**：初版將對話圖示置於右上角且未設 `width: max-content`，造成彈出訊息被壓縮成 `40px` 寬並逐字直排折行。
  - **解法**：[src/ui/emotes.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/emotes.ts) 與 [src/styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) 改為右下角圓形 Messenger 對話球，訊息以單行圓角橫條（`width: max-content; white-space: nowrap`）從左側滑出；直立手機投球時自動抬升至投手面板正上方。內建 8 組純文字三語快捷對話（前後端雙重 3 秒冷卻）並整合賽事廣播與系統連線通知。
- **界外球聲畫不同步與音效誤判**：
  - **問題**：界外球在停球瞬間即播放與好球相同的 `strike` 音效，0.5–1.0 秒後鏡頭回正才出現揮棒畫面，且 `FOUL TIP` 與 `PERFECT!` 缺少翻譯。
  - **解法**：[src/audio/sfx.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/audio/sfx.ts) 新增界外球專屬 `'foul'` 雙響提示音，並改由 `stepPresentationQueue` 在 `show_feedback` 出現同一幀播放裁判音效；補齊 `FOUL TIP` 與 `PERFECT!` 三語對照。
- **雙方同時建立好友房間死鎖**：
  - **問題**：兩名玩家各自建立空房後，其中一方輸入對方房號加入時，[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 的 `if (client.roomCode) return;` 直接靜默丟棄請求造成雙方卡死。
  - **解法**：新增 `abandonWaitingRoomIfHost` 自動回收加入方的空等待房並直接開打；輸入自己房號或打錯房號時回傳明確錯誤且不誤刪原房，並於 [tests/multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) 新增第 23 項整合測試覆蓋。
- **其餘 v2.0.0 系統升級**：外野滾地攔截守備（[src/physics/contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts)）、扣倒制（2 局起 10 分差提前結束）、480 公開＋20 好友房保留席、捕手回傳演出（[src/render/catcherReturn.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/catcherReturn.ts)）、4 分頁設定與行動版破除快取自動更新橫幅。
- **v2.0.3 線上同步與設定入口修正（2026-11-22）**：
  - **單方開選單時對手投球時鐘照走／偷投**：新增前後端雙向 `menu_pause`／`pause_state`（v2 短鍵 `mp`），任一方開啟選單、規則或設定時，伺服器精確凍結剩餘投球時鐘毫秒數並鎖定雙方投球與 `IBB`，同時以權威 20 秒上限自動續算恢復。
  - **對手斷線與 ABS 視窗同步**：斷線寬限期間前後端同步凍結時鐘與投球鈕；伺服器新增 `absWindowUntil`（`2200` ms）搭配前端 `oppAbsWaitTimer`，防止投手在精簡轉場下搶在對手 ABS 決策結束前出手；`armPitchClock` 改依當球事件動態計算轉場緩衝秒數避免誤判超時。
  - **點擊玩家名稱直達帳號分頁**：修正點擊右上角名稱按鈕（`#btn-nick-chip`）只開在第一個分頁的問題，改由 `selectSettingsTab('account')` 直接切到帳號頁並自動全選名稱輸入框。
- **v2.0.4 觀戰快捷對話與連續時機光譜（2026-11-22）**：
  - **觀戰觀眾快捷對話**：放行觀戰房間的觀眾透過右下角對話球發送 8 組三語快捷對話（紫色 `觀戰 · 玩家名` 氣泡），保留單人 3 秒冷卻並加上單房觀眾 `1.2s` 總節流防洗版；選手開啟「靜音對話」可同步屏蔽觀眾發言。
  - **連續揮棒時機光譜**：[src/render/overlay.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/overlay.ts) 的揮棒時機扇形由 5 段離散色塊改為 `createConicGradient` 連續漸層光譜（紅→橘→黃→綠→黃→橘→紅），並附 48 段細切平滑備援。
- **v2.1.0 3D 圓柱體球棒物理、球體半徑碰撞與揮棒時機對齊（2026-11-22）**：
  - **2D 捕手截面 `( • )` 圓柱棒框＋球體半徑 Minkowski 碰撞**：[src/physics/contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) 與 [src/render/overlay.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/overlay.ts) 共用 `getBatPciExtents`（一般 `0.128 × 0.050` m、強振 `0.092 × 0.036` m）與 `CONTACT_BALL_RADIUS_M = 0.038` m，左右二次貝茲圓弧括號與上下兩條隱形水平界線構成 1:1 水平圓柱截面；只要球體外緣接觸棒框即判定擊中，徹底消除「球緣明明撞到棒子卻揮空」的不合理感。
  - **選手揮棒速度（BBS 公式）＋3D 圓柱法向量投影**：改以選手揮棒速度 $v_{\text{bat}}$（預設 `18.0` m/s，強振 `1.22×`）與擊球面實際球速 `hitPlaneSpeedMs`（同步至線上 `physicsWorker`）驅動棒心初速 $v_{\text{peak}} = 0.22\,v_{\text{pitch,hit}} + 1.22\,v_{\text{bat}}$，並依圓柱截面法向量夾角 $\phi = \arcsin(0.95\,u_y)$ 計算分力投影 $(\cos\phi)^{1.45}$、橫向甜區衰減與仰角偏移（棒頂打成軟弱高沖天炮、棒底打成軟弱滾地球）。
  - **修正「明明對到球卻揮空」三大根因（方案 A）**：
    1. 揮棒回饋卡由原本誤畫 `plateCrossPos`（`z = 0`，直球／指叉／變速球在最後 `22cm` 會多下墜 `5~17cm`）改為與物理一致的 `hitPlanePos`（`z = -0.22`），並將 `◎` 外圈圓周與球心依 `0.038` m 1:1 繪製。
    2. 揮棒前搖縮短至精確 `SWING_LEAD_SEC = 0.065 s`，按下揮棒瞬間鎖定瞄準座標與目標擊球時間，時機導引環與 CPU 觸發點同步預扣 `65ms`。
    3. 修復球於前搖期間觸底（如變速球）時會跳過 `resolveContact()` 強制揮空並偽造 `dtTiming = 0` 的截斷 Bug；同時修復線上 `physicsWorker` 缺少 `sampleAt` 導致 `hitPlaneSpeedMs` 未傳遞的問題（測試擴充至 **46/46** 全部通過）。
- **v2.2.0 3D 投球實驗室、全場 4 人守備與介面修正（2026-11-22）**：
  - **互動式 3D 投球實驗室（`/capbaseball/pitch-lab`）**：新增獨立多頁入口 [pitch-lab.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/pitch-lab.html)、[src/pitchLab.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.ts) 與 [src/pitchLab.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.css)，參考 `koshien2015/cap-flight-sim` 提供全視窗 3D 自由旋轉運鏡、即時旋轉 3D 瓶蓋與速度／阻力／升力／馬格努斯力向量箭頭。空氣與瓶蓋常數鎖定為唯讀（預設 `game_preset` 與遊戲完全一致），僅開放投手可操作參數（球速、握法、旋轉軸、轉向、轉速、左右傾角、俯仰攻角、偏航角、瞄準模式與釋球點）與一鍵複製 JSON；伺服器比照 `/monitor` 開設專屬路徑 `/capbaseball/pitch-lab`。
  - **實測調校三球種物理參數**：
    - `straight`（直球）：`rpm = 3000`、`noseUpDeg = 20°`、`bankRightDeg = 0°`、`yawLeftDeg = 0°`、`rotationSense = 'counterclockwise'`。
    - `cutter`（卡特球）：`rpm = 1300`、`bankRightDeg = -30°`、`noseUpDeg = 5°`、`yawLeftDeg = 5°`、`rotationSense = 'clockwise'`。
    - `changeup`（變速球）：`cdProjected = 0.16`、`clAlphaPerRad = 0.25`，縮減過度下墜幅度至約 `36 cm`。
  - **全場 4 人守備（`P`／`C`／`LF`／`RF`）、界外守備與等速追球**：
    - [src/physics/contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) 新增 `buildFullDefense`，讓投手、捕手與左右外野手都能前衝擋下滾地球或跨進界外區接殺界外飛球（`OUT`）／攔下界外滾地球（`FOUL`），並透過 v2 精簡協定回傳精準攔截點（`fielderId`、`blockPos`/`catchPos`、`blockTimeSec`/`catchTimeSec`）消除隔山打牛動畫。
    - 加入投手投球後反應延遲（`PITCHER_BLOCK_REACTION_DELAY = 0.58 s`、`PITCHER_MAX_INTERCEPT_SPEED_MS = 13.5 m/s`）：強襲回傳球會穿過投手丘形成外野安打，中慢速滾地球則讓投手起身前衝撈球形成內野滾地球出局。
    - 新增客製 6 影格投手守備精靈圖（`pitcher_field_yellow.png` 與 `pitcher_field_black.png`，`816 × 113 px`，含預備、奔跑循環與低身撈球動作），讓投手離開投手丘時維持同一角色外觀。
    - 修正 [src/ai/cpu.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/cpu.ts) 的 `updateOutfielders`：攔截守備員改用等速 `d / remTime`，其他守備員鎖定單一固定目標並預先裁切追球範圍，消除界外球落地前後急停再慢走的頓挫感。
  - **回饋卡與跨裝置排版修正**：
    - 修正 [src/render/overlay.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/overlay.ts) 低角度挖地瓜球被 `clampY` 夾回好球帶底緣的錯覺；俯視揮棒時機圖改依真實 `plateX` 進壘截面左右對齊球點並補上淡虛線進球道。
    - 線上對戰計分板移除冗餘隊名前綴並加上文字省略與 `flex-shrink: 0`，避免長名字遮住分數；手機版主畫面（計分板隱藏時）恢復顯示頂部玩家名稱按鈕 `#btn-nick-chip`（測試共 **47/47** 全數通過）。
- **v2.3.0 線上揮空真值修正、優雅更新 60 秒預告、CPU 候補邀約與觀戰重設計（2026-11-23）**：
  - **修復線上「棒子＋時機都對卻揮空」假象（根因除錯）**：
    - **問題**：線上對戰與觀戰端實測時，打者揮空卻屢次出現球在 `( • )` 正中央且揮棒時機顯示正中間綠色 `0 ms` 的矛盾畫面。
    - **根因**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 的 `resolveNoContactPitch(room, true)` 原本在揮空（`!resolution.contact`）時將 `swingData` 與 `resolution` 直接丟棄改送 `null`；前端收到 `null` 後退回 `dtTiming = 0` 與預設中央棒框 `(0, 0.72)`，並把下方標籤退回泛稱 `揮空`。
    - **解法**：揮空時完整回傳真實 `swingData`（`batX`、`batY`、`swingMode`）與精簡揮空 `resolution`（`contact: false`、`dtTiming`、`detail`、`hitField`），同步更新 [src/net/protocol.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/protocol.ts) v2 編解碼與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 回饋卡顯示（改呈現真實的 `揮棒過早`／`揮棒過晚`／`偏離球心`）。
  - **伺服器優雅更新 60 秒預告＋換版漏洞修補**：
    - **問題排查**：檢視原始 `SIGTERM` 排空流程時發現兩處漏洞——（1）`checkDrainComplete()` 原本檢查 `rooms.size === 0`，但打完的 `game_over` 房間與空等待房會留在記憶體內，導致所有比賽明明已結束卻仍卡滿 5 分鐘；（2）`case 'rematch'` 與 `case 'join'` 缺少 `if (draining)` 防護，維護倒數期間仍能重開新局。
    - **解法**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 與 [deploy/capbaseball.service](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/capbaseball.service) 新增 `PRE_DRAIN_SECONDS=60`（`TimeoutStopSec=390`），收到 `SIGTERM` 立即鎖定 `queue`/`create`/`join`/`rematch`/`standby_join` 並廣播 60 秒倒數至全體連線（桌機置頂中央、手機對局中自動下移至計分板下方淨空區）；倒數歸零後改依 `countActiveMatches()`（僅計算進行中雙人房）判斷，最後一場結束留 3 秒送達緩衝即優雅切換新版。
  - **20 秒線上等待＋CPU 候補邀約（暫停 20 秒不搶投球時鐘）**：
    - 線上配對自動轉 CPU 時間由 `10` 秒調為 `20` 秒，並於轉打 CPU 時自動送出 `standby_join` 保留線上候補。
    - 有真人進入配對佇列時，伺服器向第一位候補發出 `match_offer`；前端等目前這球結束後於畫面角落彈出懸浮邀約卡（`#match-offer-toast`），同步透過 `isGamePaused()` 暫停 CPU 對局與投球時鐘 20 秒（比照折疊選單暫停）。點「接受對戰」立即進入真人 `LIVE` 對局；點「拒絕」或 20 秒逾時自動關閉並移除候補，伺服器隨即轉邀下一位候補。
  - **觀戰列表重設計＋`LIVE`／`FRIEND` 標記**：
    - [server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 與 v2 協定新增 `roomKind: 'live' | 'friend'` 與 `outs` 欄位。
    - 觀戰對話框改為深藍圓角 4 欄卡片（左欄金字局數與出局數、中左兩列隊色方塊與玩家名、中右對齊比分、右側 `LIVE`／`FRIEND` 光暈標籤與圓角膠囊 `觀戰` 鈕），比賽中與觀戰中的計分板同步顯示 `LIVE`／`FRIEND`。
  - **規則、守備與演出微調**：
    - **換局球衣延後變色**：新增 `visualHalf`，換局時保持舊半局球衣直到 `inning_change` 轉場動畫播畢才切換。
    - **高飛球基本功**：[src/physics/contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) 高飛球（`>= 28°`）漏接率由 `30%–55%` 下調至 `4%–12%`。
    - **突破僵局制**：[src/rules/match.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/match.ts) 改為「滿壘無人出局」開局並取消全壘打大賽，延長賽持續至分出勝負。
    - **斷線重連等待縮短與結算原因去重**：斷線重連寬限由 `45` 秒調為 `20` 秒；結算畫面 [src/ui/boxScore.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/boxScore.ts) 新增 `endReason`（`disconnect`／`resign`／`mercy`），並修正初版同時在表格上方與數據列重複顯示兩次的問題，統一於數據列乾淨顯示一次。
    - **對話球精簡**：固定為 8 句三語快捷對話（移除設定中 32 選 8 的對話選擇分頁與相關樣式，測試擴充至 **49/49** 全部通過）。
- **v2.3.1 線上對戰邀約改置中暗幕視窗（2026-11-23）**：
  - 將 CPU 候補收到線上邀約時的提示由角落浮卡改為畫面正中央的深色遮罩對話視窗（`.match-offer-backdrop`，與展開折疊選單同款背景變暗效果），配合暫停中的 CPU 對局與投球時鐘讓玩家專注選擇；超過 20 秒未操作前後端雙重執行視同拒絕、關閉視窗恢復 CPU 對戰，並強制移出候補名單轉邀下一位。
- **v2.3.2 優雅換版改統一 10 分鐘強制倒數＋清空即提前切換（2026-11-23）**：
  - [server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 與 [deploy/capbaseball.service](file:///Users/chang/Documents/raspberry%20pi/capbaseball/deploy/capbaseball.service) 將兩階段 60 秒預告簡化為單一 **`DRAIN_SECONDS=600`**（`TimeoutStopSec=630`）倒數機制：收到 `SIGTERM` 立即封鎖所有新線上對局（含配對、好友建房／加入、再戰與候補）並廣播 10 分鐘強制更新倒數；若場上已無進行中雙人房（或最後一場提前打完並過 3 秒結算緩衝）則**立刻提前更新**，滿 10 分鐘則準時強制切換。
- **v2.3.3 全新 8 句三語快捷對話＋`/monitor` 11 桶玩家頁面即時分布（2026-11-23）**：
  - **8 句快捷對話全面更新**：[src/ui/emotes.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/emotes.ts) 與 [src/i18n/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/i18n/index.ts) 更新 8 組三語固定對話（`壓力馬斯內！`／`やりますねぇ！`、`不會不會～`／`いえいえ～`、`好啊！來吧！`／`いいよ！こいよ！`、`一轉攻勢！`／`一転攻勢！`、`有一點碰到囉～`／`ちょっと当たってるよ～`、`嗯？`／`ん？`、`很不妙啊！`／`まずいですよ！`、`已經結束力！`／`もう終わりだぁ！`）。
  - **`/monitor` 與 `/metrics` 玩家所在頁面即時分布（Zero PII）**：
    - 精簡 v2 協定 [src/net/protocol.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/protocol.ts) 新增 `{ t: 'ac', a }` 頁面回報封包，由 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 與 3D 投球實驗室 [src/pitchLab.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.ts) 同步上報本地頁面狀態（`title`、`cpu_match`、`practice_bat`、`practice_pitch`、`pitch_lab`）。
    - [server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 結合伺服器權威狀態與白名單驗證，於 `/metrics` 輸出 `connections.activities` 11 個互斥頁面計數（`online_live`、`online_friend`、`online_queue`、`friend_wait`、`spectating`、`cpu_standby`、`cpu_match`、`practice_bat`、`practice_pitch`、`pitch_lab`、`title`，加總恆等於 `activeClients`），並於 [server/monitorUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitorUi.ts) 以純 DOM 色彩進度條即時呈現（測試擴充至 **50/50** 全部通過）。
- **v2.3.4 全單人模式自動線上候補、連續 3 次超時裁定勝與 `/monitor.js` 破快取（2026-11-23）**：
  - **全員預設線上候補＋40 秒配對等待＋優先順序**：
    - 玩家進入任一單人模式（CPU 三局、打擊練習、投球練習）預設自動登錄線上候補名單（首次顯示輕量提示，並於 `☰` 選單提供「接收線上邀約：開／關」即時切換）。
    - 線上對戰配對等待上限由 `20` 秒調整為 **`40` 秒**（單次邀約維持 `20` 秒），[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 新增 `enqueueStandby` 優先順序佇列，優先邀約從「線上對戰」轉進 CPU 的玩家，再邀約主動進 CPU／練習的玩家。
    - 在遊戲中明確點「拒絕」或 20 秒未回應逾時後，整趟瀏覽器分頁 Session 記憶已關閉候補（回主畫面切換其他單人模式不再打擾），直到主動按「線上對戰」或在 `☰` 選單重新開啟。
  - **線上連續 3 次投球逾時直接裁定勝**：
    - [server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 新增每隊獨立 `consecutiveClockViolations`：第 1、2 次逾時判自動壞球並顯示 `1/3`、`2/3` 警告；第 3 次連續逾時立即裁定掛機投手反則敗北、打擊方獲勝（`endReason: 'pitch_clock'`、v2 `er = 4`，結算畫面與 Box Score 顯示三語裁定標籤）。只要實際投出一球或執行敬遠即重置為 `0`，不誤傷正常玩家。
  - **修復 Cloudflare 快取舊版 `/monitor.js` 與拆出候補人數徽章**：
    - **排查紀錄**：`v2.3.3` 上線後 `/monitor` 的即時分布區塊一度停在 `Loading...`，實測發現 Cloudflare 對僅設 `Cache-Control: no-cache` 的 `.js` 檔會套用預設 4 小時快取（`max-age=14400`），導致瀏覽器載入新版 HTML 卻執行舊版 `monitor.js`。
    - **解法**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 將 `/monitor` 與 `/monitor.js` 標頭改為 `Cache-Control: no-store, no-cache, must-revalidate` 並自動附加 `src="./monitor.js?v=<build>"`；同時將頁面分布調整為 10 條真實所在頁面進度條，並於標題右側獨立顯示 **`線上候補名單：X 人`**（`connections.standbyCount`，測試擴充至 **51/51** 全部通過）。
- **v2.3.5 計分板即時觀戰人數、先後攻全面隨機、移除再戰與 ABS 轉場時序修正（2026-11-23）**：
  - **計分板改顯示「眼睛圖示 + 觀戰人數」並移除計分板 `LIVE`/`FRIEND` 標籤**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 新增 `spectator_count`（v2 `{ t: 'sc', n }`）於觀眾進入、離開或斷線時即時推播；[index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) 與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 移除計分板上的 `LIVE`／`FRIEND` 標籤（觀戰列表 `#watch-dialog` 仍完整保留），改於計分板右下角顯示眼睛 SVG 圖示與 `: N` 觀戰人數。
  - **更新 8 句三語快捷對話**：[src/ui/emotes.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/emotes.ts) 與 [src/i18n/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/i18n/index.ts) 更新 8 組內容（`壓力馬斯內！`／`やりますねぇ！`、`不會不會`／`いえいえ`、`好啊！來吧！`／`いいよ！こいよ！`、`一轉攻勢！`／`一転攻勢！`、`有一點碰到囉～`／`ちょっと当たってるよ～`、`三回啊三回！`／`3回な、3回！`、`嗯？`／`ん？`、`不妙啊！`／`まずいですよ！`）。
  - **先攻／後攻全面隨機分配**：好友房（[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) `case 'join'`）與所有 CPU 模式（三局對戰、打擊練習、投球練習，[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) `cpuPlayerSide`）改為開局 50/50 隨機決定先攻（客隊黑）／後攻（主隊黃），並同步切換玩家隊名、投打半局與 ABS 挑戰權限。
  - **移除賽後「再戰一場（Rematch）」**：清理結算視窗 `#result-dialog` 按鈕及前後端／v2 協定中的 `rematch` 流程，賽後統一回主畫面。
  - **修正 ABS 挑戰成功誤播換局動畫與對手／觀戰端搶播時序**：[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 新增 `visualInning` 搭配 `visualHalf` 鎖定畫面顯示局數，並於 `PresentationQueue` 新增 `{ kind: 'wait_opp_abs' }` 卡住 2.2 秒 ABS 決策窗；[`triggerAbsChallenge`](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 與 `case 'abs_result'` 改與 `(visualInning, visualHalf)` 比對，確保第 3 出局遭 ABS 改判回原半局時絕不觸發假換局動畫，且必須等 ABS 視窗或鷹眼重播結束後才執行後續轉場（測試擴充至 **52/52** 全部通過）。
- **v2.3.6 3Blue1Brown 速度漸層軌跡面、颱風潛勢控球帶、`SOFT · BEST · OVER` 連續控球與多項體驗打磨（2026-11-23）**：
  - **3D 速度漸層軌跡曲面與 3Blue1Brown（Manim）幾何美學**：新增 [src/render/speedRibbon.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/speedRibbon.ts) 與 `solvePitchTrajectoryForSpec` 的預覽模式（`previewMode: true`、熱啟動與 32ms 拖曳節流，同步支援 `/pitch-lab`）；以 Catmull-Rom 貝茲樣條、Manim 數學調色盤（`#58C4DD` → `#5CD0B3` → `#F7D060` → `#FC6255`）、4 條參數等時網格線、雙層向量發光筆觸與 `ShowPassingFlash` 流動光脈衝呈現全速域軌跡，加粗藍（下限）／紅（上限）邊界，並以雙節點取代單一黃色瞄準點。
  - **颱風路徑潛勢包絡帶與均勻圓盤控球**：新增 [src/render/typhoonCone.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/typhoonCone.ts) 以解析膠囊 SDF + Marching Squares 繪製連續不跳變的沙漏形潛勢包絡帶；將彈簧光譜統一更名為 `SOFT · BEST · OVER` 並對齊 `0–100%` 完整發射行程（[src/styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) 左側 `0–16%` 彈簧壓縮倉），實作 C1 連續誤差曲線（`BEST` 中心 `0 cm`，往 `SOFT` 至 `11.3 cm`、往 `OVER` 至 `16.9 cm`）與圈內 100% 面積均勻隨機分佈（[`sampleUniformDisk2D`](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts)）；按住蓄力維持待機全景，放開回彈後平滑 Morph 收束為單一專屬軌跡與發光圈圈，進入 `BEST` 觸發金色 `Indicate` 光波。
  - **主畫面精簡、快捷對話微調與捕手回傳起點修正**：移除主標題上下列標語，於主標下方以 `你好， [■ 玩家名稱]` 呈現可點擊改名按鈕；`zh-TW` 快捷對話 `emoteFire` 更新為 `114514`；線上連續投球時鐘超時裁定門檻由 3 次下修為 **2 次**（[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts)、[tests/multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) 52/52 通過）；捕手像素右手回傳動畫（[src/render/catcherReturn.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/catcherReturn.ts)）改以指尖螢幕座標反推 3D 起點，達成 0 像素瞬移自然拋出。
- **v2.3.7 修正投手出手瞬間殘留舊瓶蓋閃現（2026-11-23）**：
  - [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 於進入 `windup` 及抵達 `release_frame` 開啟 `capVisible = true` 當下，同步以 `activePitch.sampleAt(0)` 重置 `capPos`、`capNormalField` 與 `capTrail` 至出手點座標，徹底消除換球後首幀閃出上一球近景大瓶蓋的問題。
- **v2.4.0 雙層對戰紀錄與 `/analytics` 分析頁、`/monitor` 儲存健康度監測、PWA 離線遊玩與多項細節打磨（2026-11-24）**：
  - **雙層線上對戰數據紀錄與 `/analytics` 分析頁面**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 於 `data/matches.jsonl` 與 `data/pitches.jsonl` 紀錄所有線上隨機（`live`）與好友（`friend`）對局及逐球遙測，並於 [server/analyticsUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/analyticsUi.ts) 新增 `/analytics` 頁面（僅從檔案尾端快速讀取最近 100 場／2,000 球統計，硬碟採 5,000 場／50,000 球滾動上限），融合對局生命週期與異常同步監測。
  - **`/monitor` 全面中文化與零磨損儲存空間健康度監測**：[server/monitor.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitor.ts) 與 [server/monitorUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitorUi.ts) 全面改為繁體中文並統一「伺服器」用語，新增獨立「伺服器儲存空間健康度」卡片，透過 `statfs`／`/proc/mounts`／`/proc/diskstats`／`/sys/fs/ext4`／`/sys/block` 在記憶體內零磨損偵測可用容量、唯讀降級（RO）、寫入延遲與檔案系統錯誤。
  - **好壞球顯示卡升級與投球預覽精簡**：好壞球卡累積顯示同打席前幾球進壘點（較小純灰實心圓點）與當前球（`1:1` 彩色 `◎`），且依結果區分色系（安打 `1B/2B/3B` 電光藍 `#38bdf8`、全壘打 `HR` 霓虹紫 `#d946ef`、界外球琥珀橘 `#fb923c`、好球金色、壞球綠色、出局紅色）；投球預覽（[src/render/speedRibbon.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/speedRibbon.ts)）改只繪製最 `SOFT` 與最 `HARD`（原 `OVER` 改名）兩條 3D 軌跡並保留好球帶機率雲聯集邊界。
  - **PWA 離線遊玩支援**：[vite.config.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/vite.config.ts) 建置期自動生成 `sw.js` 預快取所有遊戲頁面、JS/CSS、精靈圖與字型（主畫面導航採 Network-First + 3 秒逾時／5xx 自動退回本地快取），搭配 [public/manifest.webmanifest](file:///Users/chang/Documents/raspberry%20pi/capbaseball/public/manifest.webmanifest) 與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 離線即時切換 CPU 對戰（1.2 秒快速偵測，不乾等 40 秒），就算伺服器關機或手機無網路也能點開即玩。
  - **網路瘦身、界外飛球接殺與對局體驗修正**：[src/net/protocol.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/protocol.ts) 新增 `delta` 差異封包與 `session_check`/`session_forfeit`；[src/physics/contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) 支援全守備員追趕界外高飛球接殺（`FOUL OUT`）；[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 支援斷線重連確認視窗、長名字自動縮字省略、換局動畫結束前凍結全畫面局數／計分板／好球帶／操作面板，以及 CPU 模式投球途中暫停恢復時安全重置該球（測試擴充至 **54/54** 全部通過）。
- **v2.5.0 第 5 球種「80° 高仰角蝴蝶球」、捕逸／暴投區分、五球種單排面板與實驗室解放（2026-11-24）**：
  - **新增第 5 球種「蝴蝶球（`knuckle` / `KNU`）」與尾流調校踩雷紀錄**：
    - **踩雷原因**：2.2g 薄壁瓶蓋的轉動慣量極小，初版將尾流力矩係數設為 `moment_coefficient = 0.005` 且 `cdProjected = 0.58` 時，會導致瓶蓋在空中劇烈翻滾、進壘偏折達 `32–86 cm` 甚至難以穩定進壘。
    - **解法與定案參數**：在 [src/physics/wake.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/wake.ts) 加入獨立的 `lateral_scale` 與 `vertical_scale` 權重，並於 [src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 定案為 `noseUpDeg: 80°`、`rpm: 30`、出手 `54–66 km/h`（進壘急煞至 `~37.9 km/h`）、`cdProjected: 0.26`、`force_coefficient: 0.125`、`moment_coefficient: 0.0006`、`lateral_scale: 1.85`、`vertical_scale: 0.65`、`reduced_frequencies: [0.0085, 0.0155, 0.026]`；40 球實測左右偏移中位數 `22.0 cm`、平均 `26.2 cm`（空中左右擺幅 `35.3 cm`、S 型蛇行 15/40）、進壘率 `100%`。
    - **零伺服器額外負擔與實機壓測**：線上對戰沿用既有 `seed`（網路封包 `0` 增加），反解階段關閉 `wake`、僅出手終算啟用 14 維 RK4；本機 20 間同步對戰房（40 人、60 顆併發蝴蝶球）實機壓測結果：**`eventLoopLagMs: 1 ms`**、`p50` 發射延遲 `33.2 ms`、`rssMb: 158 MB`、`nanSanityErrors: 0`、`rejectedBusy: 0`。
  - **機率雲與動態圓圈顯示蝴蝶球固有飄移半徑**：[src/render/overlay.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/render/overlay.ts) 與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 將 `wakeScatterRadiusM = 0.24` m 透過平方和 `Math.hypot(springScatter, baseScatterM)` 套用於預覽與收縮圓（維持金色 `BEST` 圈，出手隨機誤差 `sampleUniformDisk2D` 不重複疊加）。
  - **五球種單排等寬按鈕**：[index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html) 與 [src/styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) 移除菱形改為單排 5 等寬（`直球 / 卡特 / 指叉 / 變速 / 蝴蝶`，支援鍵盤 `1`–`5`）。
  - **強化暴投（`WILD PITCH`）／捕逸（`PASSED BALL`）／不死三振**：[src/ai/cpu.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/cpu.ts) 新增 `evaluateCatcherCatch` 區分好球帶內蝴蝶球尾流／`>= 72 km/h` 速球／急墜指叉低球漏接（捕逸）與大偏離／提前落地 `< 0.14m`（暴投），同步接入 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts)、[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 與三語翻譯（測試擴充至 **56/56** 全部通過）。
  - **`/pitch-lab` 全參數解放與分析頁擴充**：[pitch-lab.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/pitch-lab.html) 與 [src/pitchLab.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.ts) 放寬球速（`20–120 km/h`）、轉速（`0–6000 rpm`）、傾角（`±180°`）、仰角／偏航（`±90°`）與釋球點範圍，改用捕手視角箭頭圖示並新增 `蝴蝶` 範本；[server/analyticsUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/analyticsUi.ts) 補上 `蝴蝶 (KNU)` 統計列。
- **v2.5.1 修復手機半開殭屍連線誤殺重連紀錄、觀戰結束顯示離線模式與 `/analytics` 欄位對齊（2026-11-24）**：
  - **修復 `session_check` 誤判殭屍半開連線仍在線（導致手機閃斷重載跳不出「回到比賽」框並遭判斷線負）**：
    - **根因**：手機切換 Wi-Fi/5G 或重載網頁時，經過 Cloudflare Tunnel 的舊 TCP 連線在伺服器 `deadSocketTimeoutMs`（36 秒）到期前仍處於 `OPEN`，新分頁送出 `session_check` 時伺服器誤回 `{ active: false }`，導致前端立刻 `saveSession(null)` 清空本地憑證。
    - **解法**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 於 `session_check` 主動對舊連線發送 RFC 6455 `ws.ping()` 探測（預設 `700ms`）：活著的第二分頁秒回 `pong` 時回傳 `{ active: false, alreadyActive: true }`（不搶線亦不刪前端憑證）；未回應的殭屍連線則立刻 `terminate()` 並回 `{ active: true, ... }` 讓玩家奪回座位；同步將 `graceMs` 放寬為 `30s`（並於 [tests/multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) 新增第 33 項整合測試）。
  - **前端主動清除半開死連線＋對戰中閃斷無縫自動重連**：[src/net/client.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/client.ts) 連續漏掉 `2` 次 ping 即主動關閉死 socket 觸發重連，並新增 `probeAlive(2500)` 於 `visibilitychange`／`pageshow`／`online` 時 2.5 秒探活重建；[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 在人已處於對戰畫面中閃斷時直接靜默 `reconnect()` 接回（僅主畫面重開時彈確認框），`online` 事件同步歸零退避並立即重試。
  - **修復觀戰／賽後回主畫面顯示「離線模式」**：[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 的 `returnToTitle()` 退出觀戰僅送 `unwatchRoom()` 不再中斷 WS；線上對戰離開清席位後立即靜默重建 WS 連線維持頂部「在線 N」狀態。
  - **修復 `/analytics` 場均得分／投球數／完賽數顯示 `0`**：[server/analyticsUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/analyticsUi.ts) 相容 `matches.jsonl` 的 `awayRuns`／`homeRuns`／`innings`／`pitches` 與 `completed` 欄位（測試擴充至 **57/57** 全部通過）。
- **v2.5.2 消除線上假斷線負、觀戰斷線自動重連、`sw.js` 防快取與兩隊獨立左右打（2026-11-24）**：
  - **線上對戰 `☰` 選單隱藏「回主畫面」**：[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 在線上對戰進行中（`isOnline && !spectating && !onTitleScreen && !match.isGameOver`）隱藏 `#btn-menu-title`，僅保留「返回比賽」與「認輸棄賽」（`#btn-resign`），消除誤按回主畫面造成假 `disconnect_timeout` 與對手空等 30 秒。
  - **觀戰／大廳自動重連＋`sw.js` 阻擋 Cloudflare 4 小時快取**：[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 的 `resumeSession()` 改支援觀戰斷線自動重連並補送 `watchRoom(onlineRoomCode)`（若該局已結束則退回主畫面維持在線），大廳／單人模式斷線亦自動靜默重連；[src/net/client.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/client.ts) 於 `setConnected(true)` 預設 `netQuality = 'good'` 避免灰點殘留；[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 對 `/sw.js`、`/version.json`、`/index.html`、`/pitch-lab.html` 與 `/manifest.webmanifest` 強制回傳 `Cache-Control: no-store, no-cache, must-revalidate`。
  - **兩隊獨立左右打設定**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 將單一 `room.batterSide` 改為 `batterSides: { away, home }` 並在換局（含 ABS 改判第 3 出局換局）與 `pitch_launch` 切換為當半局進攻方設定；[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 拆出己方設定 `myBatterHandedness`，防止對手切換左右打覆寫我方按鈕與下個半局打席（新增 [tests/multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) 第 34 項整合測試，全部 **58/58** 通過）。
- **v2.6.0 直球前伸與 40° 仰角、ABS 複合判決／動畫完整連動、候補 5 人搶單、捕手守備調校與 `/analytics` 即時＋台北時間升級（2026-11-24）**：
  - **直球出手前伸 `+150 cm` 與仰角 `40°`**：[src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 為 `PitchSpec` 新增選用 `releasePos`，將 `straight` 的 `releasePos` 前移至 `[1.85, -0.22, 1.18]`、`noseUpDeg: 40°` 並放寬 `minElevationDeg: -18°` 以確保低角度好球帶入帶；[src/pitchLab.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.ts) 同步載入球種預設出手點。
  - **提高不死三振／暴投／捕逸機率、捕手空中反應延遲與視覺動畫組**：[src/ai/cpu.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/cpu.ts) 縮小捕手舒適接捕區並調高指叉低球／蝴蝶球／高球速邊角捕逸與外圍暴投機率；[src/physics/contact.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/contact.ts) 加入捕手空中反應延遲（`0.46s` 界外／`0.56s` 界內）與回追本壘後方漏接加成；[src/ui/transitions.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ui/transitions.ts) 與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 新增 `UNCAUGHT 3RD`／`WILD PITCH`／`PASSED BALL`／`WALK (BB)`／`COLD GAME`／`WALK-OFF`／「改判壞球 · 打擊繼續！」轉場橫幅、延長賽「突破僵局 · 0出局滿壘」提示、「四壞保送＋暴投／捕逸」複合播報與無瞬間回傳的 3D 漏球彈地特效（遵守瓶蓋棒球無實體跑者規則）。
  - **ABS 複合判決完整回溯與防爆雷凍結**：[src/rules/match.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/rules/match.ts) 在 `AbsPreSnapshot` 補齊 `wildPitches`、`uncaughtThirdStrikes`、`plateAppearancesInHalf`、`runsByInning`、`mercyTriggered` 與 `endReason` 回溯並回傳結構化 `AbsOutcomeKind`（精準處理「不死三振改判壞球→暴投進壘」、「壞球改好球→不死三振或三振出局」等複合情節）；[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 開放結束比賽最後一球 ABS 挑戰（`gameOverAbsTimer`），並於 2.2 秒鷹眼重播期間凍結左上角記分板防止提前爆雷；同步將隊伍左右打視覺嚴格綁定 `visualHalf` 避免換局動畫前搶先切換。
  - **候補 5 人同時搶單、純暱稱聊天室與 `/analytics` 即時＋台北時間**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 改為一次向名單前 5 位候補發送 `match_offer`（15 秒逾時）、搶輸顯示保留優先候補通知、取消排隊送出 `waiter_cancelled` 並即時同步 `/monitor` `standbyCount`；聊天氣泡只顯示純玩家名字；[server/analyticsUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/analyticsUi.ts) 全面改為台北時間（`UTC+8`）並於分析頁頂部即時列出對戰中房間（測試擴充至 **60/60** 全部通過）。
- **v2.7.0 第 6 球種「噴射球（`shuuto`）」、雙隊 ABS 燈號、統一 `/monitor` 數據中心與實驗室白話物理滑桿（2026-11-25）**：
  - **新增第 6 球種「噴射球（`shuuto` / `SHU`）」與 `3×2` 投手面板**：[src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 新增側投前伸出手點（`[0.80, -0.36, 1.08]`、`bankRightDeg: 70°`、`noseUpDeg: -2°`、`yawLeftDeg: -14°`、`rpm: 2900`、`62–73 km/h`），預設 `68 km/h` 可達捕手視角向左急轉 **`-142.7 cm`** 與近零垂直位移（`+0.3 cm`）；[index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html)、[src/styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css)、[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts)、[src/i18n/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/i18n/index.ts)、[src/ai/cpu.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/ai/cpu.ts) 與 [src/net/protocol.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/protocol.ts) 改為 2 列 × 3 欄面板（支援鍵盤 `1`–`6`）、三語翻譯與向後相容 index `5` 編碼。
  - **記分板同時顯示客隊與主隊 ABS 剩餘次數**：修復觀戰者及 CPU 模式下因只顯示客隊（`away`）造成主隊挑戰失敗卻看似未扣次數的顯示 Bug，於 [index.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/index.html)、[src/styles.css](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/styles.css) 與 [src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 改為上排客隊（銀白 `ABS`）＋下排主隊（金黃 `ABS`）同步呈現。
  - **將 `/analytics` 融入 `/monitor` 統一四分頁後台與進階數據收集**：[server/monitorUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitorUi.ts) 整合為「伺服器監控／對戰總覽／球路與平衡／裝置與跨平台」四大分頁（切分頁才按需輪詢 `/metrics` 或 `/analytics.json` 節省樹莓派資源，`/analytics` 路徑自動開啟對戰總覽）；[src/net/client.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/client.ts) 與 [server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 新增零 PII 單次節流裝置檔案（寫入 `data/sessions.jsonl` 並設 ~13.7 MB SD 卡自動輪替上限）與彈簧 `SOFT/BEST/OVER` 標記；[server/analyticsUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/analyticsUi.ts) 新增跨平台觸控 vs 滑鼠公平性、左右打對位矩陣、好球帶 9 宮格熱區（投球量／揮棒率／安打率／誤判率）、捕手與特殊規則事件率與揮棒時機分佈（新增 [tests/multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) 第 38 項整合測試，全部 **61/61** 通過）。
  - **`/pitch-lab` 開放 6 項白話非投手物理滑桿**：[pitch-lab.html](file:///Users/chang/Documents/raspberry%20pi/capbaseball/pitch-lab.html)、[src/pitchLab.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.ts) 與 [src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 開放調整空氣煞車強度（`cdProjected`）、滑翔轉彎力（`clAlphaPerRad`）、旋轉吸力強度（`magnusCoeff`）、空氣濃稠度（`airDensityKgM3`）、瓶蓋重量（`capMassG`）與旋轉維持力（`spinDamping`），並支援快速基準切換與 JSON 匯出。
- **v2.7.1 指叉球／卡特球調校、變化量（BRK）新公式與逐球紀錄路徑修正（2026-11-25）**：
  - **指叉球（`fork`）與卡特球（`cutter`）出手前伸 `+1.5m` 與氣動調校**：[src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 將 `fork` 的 `cdProjected` 調高至 `1.0`、`cutter` 調為 `clAlphaPerRad: 1.50` / `bankRightDeg: -50°` / `noseUpDeg: 10°`，兩者 `releasePos` 皆前移至 `[1.85, -0.22, 1.18]` 並同步放寬飛行包絡線限制。
  - **重構變化量（`computePitchBreakDelta`）計算基準**：[src/physics/pitches.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/pitches.ts) 與 [src/pitchLab.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/pitchLab.ts) 水平變化維持純橫移量，垂直變化改以軌跡相對於「出手點至進壘點連線」的最大垂直弧偏（上飄為 `+`、下墜為 `-`）計算，不再扣減真空自由落體重力下墜，使直球回歸 `~15.8 cm`、變速球 `~71.9 cm`、卡特球 `~81.1 cm`、噴射球 `~147.6 cm` 等直覺排序（`61/61` 測試通過）。
  - **逐球與裝置紀錄改用絕對路徑**：[deploy/capbaseball.service](deploy/capbaseball.service) 的 `PITCH_LOG`、`SESSION_LOG` 改為 `%h/capbaseball/data/` 下的固定路徑，修正每次換版（相對路徑落在各版本目錄）造成逐球紀錄被清空的問題。
- **v2.7.2 修正兩出局飛球空中提前切換左右打與全域動作／狀態／動畫順序保護（2026-11-25）**：
  - **補齊接觸出局換局推播的 `batter_side.team` 欄位**：[server/index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) 於兩出局安打／接殺出局觸發換局時同步附帶 `team: getBattingSide(room.match)`，根治球還在飛行中即因缺欄被套用到場上現任打者、導致左打者空中瞬變右打者的問題。
  - **新增 `isActivePlayMotion()` 動畫鎖定守衛與全面時序審計**：[src/main.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/main.ts) 在投球揮臂（`windup`）、投球飛行（`pitch_flight`）、擊球飛行（`batted_flight`）、待結算／ABS 重播／漏球滾動期間統一鎖住打者左右打外觀、HUD 與操作面板（並防止 `match_over` 提前中斷飛行中全壘打／再見安打，及於 `result -> idle` 同步重整視覺打席），同步擴充 [tests/multiplayer.test.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/tests/multiplayer.test.ts) 第 34 項測試驗證接觸出局與三振換局皆帶正確 `team`（`61/61` 測試通過）。
- **v2.7.3 對局紀錄補欄位：逐球亂數種子、彈簧蓄力值與配對佇列紀錄（2026-11-26）**：
  - **`pitches.jsonl` 每球新增 `seed`、`u`（彈簧蓄力值 0–1，選填）與 `version`**：[server/index.ts](server/index.ts) 的 `pitch_submit` 解析選填的 `u`，[src/net/protocol.ts](src/net/protocol.ts)、[src/net/client.ts](src/net/client.ts) 與 [src/main.ts](src/main.ts) 一併送出；舊客戶端不送 `u` 照常運作。有了種子與蓄力值，每一球都能離線重跑。
  - **新增 `queue.jsonl`**：記錄 `queue_enter`、`queue_leave`（含原因 `cancel`／`disconnect`／`matched`／`drain` 與等待毫秒數）與 `match_made`，用來分析隨機配對的等待時間（路徑由 `QUEUE_LOG` 指定，預設與逐球紀錄同資料夾，保留上限 50,000 筆或 5 MB）；[deploy/capbaseball.service](deploy/capbaseball.service) 補上 `QUEUE_LOG`。
  - 測試新增第 39、40 項，全部 **63/63** 通過。
- **v2.8.1 1 局制改名、投手跑步重製與手機舊圖修正（2026-11-27）**：
  - **「突破僵局」模式改名為「1 局制」**：僅更改顯示名稱（繁中 `1局制`、英文 `1-INNING MATCH`、日文 `1イニング戦`），內部代碼仍為 `tiebreak`，封包與配對佇列不變；延長賽的滿壘無人出局規則維持原稱。
  - **`/monitor` 新增分模式統計**：[server/index.ts](server/index.ts) 的監控快照加入 `queuesByMode` 與 `roomsByMode`，[server/monitorUi.ts](server/monitorUi.ts) 顯示「房間 3局 / 1局 / 6局」與「排隊 3局 / 1局 / 6局」，並隨 `/metrics` 的 `connections` 輸出。
  - **投手 Skywalker 跑步 8 格重製**：以棒球殿堂跑步動作（`D_move_run_fast`，一個步伐週期 0.6 秒）在 Blender 渲染 3D 側面 8 格，再交給 Gemini 轉像素圖，左右腳確實交替；投手接滾地球後不再出現舉球準備傳球的最後一格（`catch_ground` 與 `dive` 共 5 格）。
  - **手機仍顯示舊圖修正**：Cloudflare 對 `/sprites/*.png` 加上 `max-age=14400`，Service Worker 安裝時 `cache.addAll` 會讀到過期圖片；[vite.config.ts](vite.config.ts) 改用 `cache: 'reload'` 略過 HTTP 快取。
- **v2.8.0 突破僵局線上雙模式、實心白線捕逸線、角色精靈圖與守備特效打磨（2026-11-27）**：
  - **線上對戰雙模式（`3 局制` vs `突破僵局`）與漸進式選單**：[index.html](index.html)、[src/styles.css](src/styles.css)、[src/i18n/index.ts](src/i18n/index.ts) 與 [src/main.ts](src/main.ts) 保持大廳 4 顆主按鈕，點擊「線上對戰」後彈出 `#online-mode-dialog` 選擇 `3 局制` 或 `突破僵局`，點擊「好友對戰」按下「建立房間」後才展開 `#friend-create-options`（`3 局制 | 突破僵局` 與扣倒制設定，加入房間無需選擇）；[src/rules/match.ts](src/rules/match.ts) 新增 `tiebreak` 模式（1 局制、第 1 局上 0 出局滿壘開局、延長續滿壘、下半局超前即再見勝）；[server/index.ts](server/index.ts) 與 [src/net/protocol.ts](src/net/protocol.ts) 分開獨立 `quick3` / `tiebreak` 配對佇列與 Standby 佇列，同步支援好友開房與即時觀戰顯示。
  - **捕逸線實心白線與暴投／捕逸／不死三振演出**：[src/render/gymScene.ts](src/render/gymScene.ts) 於 `PASS_LINE_Z = 2.334m` 永久繪製實心白線；暴投／捕逸／不死三振時 [src/render/camera.ts](src/render/camera.ts) 將鏡頭拉退至捕逸線後方，[src/main.ts](src/main.ts) 修正貼地滾動阻尼確保瓶蓋確實彈跳滾越白線並觸發越線光環與揚塵；捕手 `#99` 換裝背面雙膝胸擋動作（鎖定 `flipX = false` 避免背號反轉）。
  - **角色精靈圖、高飛接殺特效與場上情境實驗室**：[src/render/sprites.ts](src/render/sprites.ts) 新增 `#99`（固定左打、站位靠近好球帶）與 `#18`（固定右打）獨立精靈圖並移除手動左右打切換；[public/sprites/fx_fielding.atlas.json](public/sprites/fx_fielding.atlas.json) 修正毫秒單位讓白色接球爆裂光環正常播放並透過 `getFlyCatchHandPos()` 精準對齊舉高雙手座標；高飛接殺強制鎖定於空中收球絕不落地或彈地；移除投手接滾地後拉弓丟球格與右打者揮棒尾段突兀站正格；新增停球／界外球最近守備員衝刺撿球與 [field-lab.html](field-lab.html) 場上情境實驗室（測試擴充至 **67/67** 通過）。
