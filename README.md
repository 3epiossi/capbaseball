# fallen skywalker — Cap Baseball（瓶蓋棒球）

以 **2025 年 2 月版瓶蓋棒球規則**為核心打造的 16-bit 像素風格 3D 競技網頁遊戲，支援單機對戰 CPU、本機雙人、打擊／投球練習、即時線上隨機配對（含自動降級 CPU 備援）、朋友私房對戰與即時觀戰。

- **Fork 來源（Upstream）**：https://github.com/koshien2015/cap-flight-sim （感謝原作者開源之 6-DOF 瓶蓋飛翔物理模擬核心）
- **正式上線網址**：https://3epiossi.com/capbaseball
- **3D 投球實驗室**：https://3epiossi.com/capbaseball/pitch-lab
- **目前里程碑**：`v2.3.1`（語意化三段式版本號），Pi 現行部署版本 `20261123-035154`
- **支援語系**：自動偵測繁體中文（`zh-TW`）、日本語（`ja`）與英文（`en`）

---

## 快速開始

```bash
# 安裝依賴
npm install

# 本機開發（Vite 前端）
npm run dev

# 執行完整型別檢查與單元／整合測試（3 檔 49 項測試）
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
| `src/physics/` | [src/physics/README.md](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/physics/README.md) | 6-DOF 瓶蓋空氣動力學、4 種變化球軌跡求解、揮棒接觸與擊球彈道物理。 |
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
- **兩階段彈簧投球發射器**：修正原本「蓄力放開直接出手」的問題，改為「按住壓縮蓄力 → 放開彈出並觀察指針最高點落在 `NORMAL · BEST · OVER` 光譜區間 → 短暫鎖定峰值後實際出手」。
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
- **UI 收斂與大螢幕可讀性**：將右上角收折為單列 `[PLAYER] [延遲] [在線] [☰]` 漢堡選單，並將打擊時的「左／右打切換（`#btn-hand`）」與「一般／強振模式（`#btn-swing-type`）」移入可折疊的 `☰` 選單內（不佔用主畫面空間）；將彈簧線圈直接整合進 `NORMAL–BEST–OVER` 光譜軌條上方，並放大桌機計分板與投手面板字體。
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
