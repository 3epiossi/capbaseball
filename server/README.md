# `server` 權威對戰伺服器模組

## 模組總覽

`server` 目錄包含三個核心檔案，實作結合記憶體靜態快取、`/health`、`/metrics` JSON 遙測、`/monitor` 即時 SVG 監控面板與 WebSocket 即時多人對戰的權威伺服器。伺服器在後端重跑與前端完全一致的 6-DOF 投打物理與 2025-02 規則狀態機，並內建放寬後的過載保護、HTTP／WS 安全強化與無中斷優雅停機機制。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) | 啟動 HTTP 與 WebSocket 伺服器，負責記憶體靜態快取（含 ETag 304／`.gz`）、房間配對、權威投打結算、ABS 挑戰同步、觀戰廣播、過載卸載閘門、安全防護與非同步對局紀錄寫入（`matches.jsonl`）。 |
| [physicsPool.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/physicsPool.ts) | 多核心 `worker_threads` 物理求解池（4 核心 Pi 上預設啟用 3 條 Worker），將 `solvePitchTrajectory` 與 `evaluateSwingResolution` 移出主事件迴圈（測試無打包檔時自動退回 inline）。 |
| [physicsWorker.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/physicsWorker.ts) | 獨立建置為 `dist-server/physics-worker.mjs` 的背景執行緒物理計算端點，僅回傳精簡座標與判決結果。 |
| [monitor.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitor.ts) | `ServerMonitor` 監測核心：累計 HTTP／WS 封包速率與頻寬、前 10 大訊息類型、角色拆解、拒收與異常計數、物理運算耗時、事件迴圈延遲／CPU%、Raspberry Pi OS 溫度／降頻旗標（60 秒週期），以及 10 分鐘環狀歷史與告警引擎。 |
| [monitorUi.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/monitorUi.ts) | `/monitor` 單頁儀表板 HTML 與 CSP 相容的外部腳本 `/monitor.js`，每 2 秒輪詢 `./metrics` 繪製 SVG 折線圖、吞吐表與異常列表（零 PII）。 |

---

## 核心資料流／演算法

### 1. 權威對戰迴圈與冪等防護

- **配對與房間生命週期**：支援快速配對佇列（`quick3`／`official6`）、4 碼親友房建立與加入、即時觀戰（`list`／`watch`／`unwatch`）、交換主客場再戰（`rematch`）與 `45` 秒斷線寬限重連（`reconnect`）。
- **斷線與房間回收（2026-11-21 修正手機「Room code not found／Room is full」）**：
  - 房主在好友尚未加入時斷線，房間不再立刻刪除，改保留 `waitingGraceMs`（預設 `300` 秒）；手機切去 LINE 貼房號時連線被系統中止，好友仍能加入。好友在房主離線時加入，會收到 `opponent_disconnected`，並改用 `graceMs`（`45` 秒）計時，逾時由 `expireSeat` 判對手勝並回收房間。
  - 房主對尚無好友的房間 `reconnect`，回傳 `room_created`（同房號與 `token`）而非 `state_sync`，避免被丟進對 `WAITING` 的球場。
  - 同一座位再次 `reconnect` 時關閉舊連線並清除舊 client 的 `roomCode`／`side`；`reconnect` 也會移出配對佇列與觀戰。
  - 死連線偵測：`lastPongAt` 超過 `deadSocketTimeoutMs`（預設 `max(10000, pingIntervalMs * 5)`）即 `terminate()`，交由正常斷線流程啟動寬限，避免失訊手機永遠佔著座位。
  - `rematch` 遇到房間已不在或對手離線，回 `error` 碼 `opponent_left`，不再靜默無回應。
  - **雙方同時建房死鎖修正（2026-11-22）**：初版 `join`／`create`／`queue` 在 `if (client.roomCode) return;` 直接靜默忽略封包，導致兩名玩家各自開了空等待房後互相無法加入。現已新增 `abandonWaitingRoomIfHost`：當加入目標房存在且未滿員時，自動釋放加入方自己的空等待房並直接開打；若輸入自己的房號（回傳 `already_in_room`）或打錯不存在的房號（回傳 `room_not_found`），則保留原本等待房不被誤刪。
  - **快捷對話 3 秒防洗頻（`emote`）**：僅允許白名單內的 8 組訊息 ID（`nice`、`wow`、`fire`、`sweat`、`clap`、`gg`、`k`、`hr`），伺服器端強制限制每條連線至少間隔 `3000` ms 才廣播一次，且由接收端依自身語系本地化顯示。
  - 已知未修：親友房在伺服器忙碌時回 `server_busy` 會被客戶端導向 CPU 對戰；建房／加入按鈕沒有連點防護；`sendToRoom` 清除失效觀戰者時未重設 `watchingCode`。
- **回合與序號驗證**：每球遞增 `pitchSeq`，伺服器僅接受符合當前 `turnState`（`awaiting_pitch` 或 `awaiting_swing`）、正確投打方且 `msg.pitchSeq === room.pitchSeq` 的指令，自動忽略重複、過期或越權封包。
- **投打結算**：收到 `pitch_submit` 後，伺服器以加密安全亂數產生 `seed` 並呼叫 `solvePitchTrajectory`（`120` Hz）計算軌跡，廣播 `pitch_launch` 並啟動逾時自動判不揮棒計時器；收到 `swing_input`、`no_swing` 或逾時後，呼叫 `evaluateSwingResolution`、`checkCatcherCatch`、`evaluateUmpirePitchCall` 與 `applyPitchResult` 完成權威判決並廣播 `pitch_result`。
- **權威投球時鐘（Pitch Clock）**：開賽與每球結束進入 `awaiting_pitch` 時由 `armPitchClock` 啟動倒數（無跑者 `15` 秒／有跑者 `20` 秒＋結算緩衝，測試可透過 `pitchClockScale` 調整），斷線寬限期間自動暫停；逾時由 `applyPitchClockViolation` 判自動壞球／保送並廣播帶 `cv: 1` 的 `pitch_result`。

### 2. 雙路徑服務、記憶體快取與流量監控端點

- **根目錄與子路徑相容**：HTTP 伺服器同時支援 `/` 與 `/capbaseball/`；收到無結尾斜線的 `/capbaseball` GET／HEAD 請求時，自動回傳 `301` 導向 `/capbaseball/`（`/monitor/` 亦導向 `./monitor` 以確保 `./metrics` 與 `./monitor.js` 相對路徑正確解析）。
- **記憶體靜態快取（Zero Disk I/O）**：伺服器啟動時將 `dist/` 與預壓縮 `.gz` 一次載入 `staticCache` `Map` 並計算 SHA-1 `ETag`；靜態資源全面從 RAM 回應並支援 `If-None-Match` → `304 Not Modified`，免除高併發下每請求多次同步 `fs.statSync` 與開檔串流的磁碟瓶頸。
- **即時監控端點（`/monitor` 與 `/metrics`）**：
  - `GET /capbaseball/monitor`（與 `/capbaseball/monitor.js`）：免登入外部 JS 儀表板（完全相容 `script-src 'self'` CSP），即時顯示在線角色分佈（對戰中／排隊中／觀戰中／首頁閒置）、每秒 HTTP/WS 吞吐與封包類型、拒收計數、**對戰異常與同步健康指標**（卡死未活動 >45 秒房間數、投球時鐘違規、揮棒逾時未回傳、錯序／過期封包、超界輸入裁切、物理 `NaN` 檢查、斷線重連成功率、高局數／大比分房）與 Raspberry Pi CPU 溫度／降頻（`vcgencmd get_throttled`）。
  - `GET /capbaseball/metrics`：完整 JSON 遙測輸出（不含玩家暱稱、房號或完整 IP 等 PII）。若設定環境變數 `MONITOR_TOKEN`，需透過 `?token=`、`x-monitor-token` 或 `Authorization: Bearer` 驗證；另可設定 `METRICS_LOG` 每 60 秒寫入一筆歷史摘要至 JSONL。
- **生產環境綁定**：透過 `process.env.HOST` 控制監聽位址（未設定時預設 `0.0.0.0`），生產環境建議搭配 `HOST=127.0.0.1` 僅對本機反向代理（如 Cloudflare Tunnel）開放。

### 3. 放寬過載保護閘門（`getServerLoad`）

伺服器透過 `monitorEventLoopDelay({ resolution: 20 })` 持續監測事件迴圈 p95 延遲（`lagMs`），並結合 RSS 記憶體（預設 `MAX_RSS_MB=640`）、房間數（預設 `MAX_ROOMS=80`）與連線數（預設 `MAX_CLIENTS=500`，其中 `publicClientCap = 480` 供公開配對、最後 `20` 席 `481..500` 保留給好友房與重連）計算負載等級：

| 狀態 | 條件（任一成立） | 行為 |
|---|---|---|
| `red` | `lagMs >= 160` ms、`rooms >= maxRooms`、`clients >= maxClients` 或 `rssMb >= maxRssMb * 0.9` | 拒絕 `queue` 與 `create`，回傳 `server_busy` 並累加 `rejectedBusy` |
| `yellow` | `lagMs >= 80` ms、`rooms >= 0.8 * maxRooms`、`clients >= 0.85 * maxClients` 或 `rssMb >= 0.8 * maxRssMb` | 預警狀態，**仍允許正常配對與建立好友房**（僅記錄告警） |
| `green` | 低於上述所有門檻 | 正常開放配對與建房 |

僅當狀態為 `red`（真正過載）時，新排隊或開房請求才會收到 `{ type: 'error', code: 'server_busy', load }`，確保大量純瀏覽／單機玩家不會誤鎖線上對戰配對。

### 4. WebSocket 心跳、節流廣播與安全強化

- **節流與預先序列化廣播（`scheduleStatsBroadcast`）**：上線／離線／開房／排隊不再每次對全員重編 JSON，改以 `800ms` 防抖排程並對 legacy 與 compact v2 各自只做一次 `JSON.stringify`，將突發連線潮由 $O(N^2)$ 降為 $O(N)$，定時廣播間隔調為 `5000ms`。
- **協定層低負擔心跳（RFC 6455 `ws.ping()` / `ws.on('pong')`）**：伺服器心跳預設改為 `pingIntervalMs = 12000` ms（`deadSocketTimeoutMs = 36000` ms），改發 WebSocket 協定層 `PING`，由手機與瀏覽器底層網路執行緒自動回 `PONG`，解決切背景／鎖屏 JS 凍結造成假性斷線；另將首頁閒置逾時（`1000 idle`、`idleClosed`）與對戰中異常失聯（`deadPongTimeout`）分開統計。
- **非同步 I/O 與 `/metrics` 快取**：`appendMatchLog` 改用佇列化非同步 `fs.promises.appendFile` 避免 Pi SD 卡同步寫檔卡頓事件迴圈；`vcgencmd get_throttled` 改每 60 秒抽樣一次，`/metrics` 回應預設快取 `1000ms`。
- **HTTP 安全標頭**：所有 HTTP 回應均附加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy: camera=(), microphone=(), geolocation=()` 與嚴格 `Content-Security-Policy`（`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'self'; frame-ancestors 'none'`）。
- **隱藏檔與路徑穿越封鎖**：拒絕任何包含空位元組（`\0`）、以 `.` 開頭的路徑區段（如 `/.env`）或超出範圍的請求，回傳 `403 Forbidden`。
- **玩家名稱淨化（`sanitizeName`）**：移除控制字元與 `<>'"`&`，裁切至最多 12 字元；空字串或預設 `PLAYER` 則自動配發 6 碼不重複英數訪客代號（如 `K7M2Q9`，且避開目前在線名稱）。
- **WebSocket 防護**：`WebSocketServer` 設定 `maxPayload: 16 * 1024`（16 KB）並關閉 `perMessageDeflate: false`；連線時檢查來源 IP（支援 `cf-connecting-ip`／`x-forwarded-for`）並限制單一 IP 最多 `maxConnPerIp`（預設 `48`，兼容校園／宿舍與行動 CGNAT 共享 IP）條連線；每條連線套用 1 秒滑動視窗頻率限制，超過 `maxMsgsPerSec`（預設 `30`）則回傳 `rate_limited` 並以代碼 `1008` 關閉連線。

### 5. 優雅 `SIGTERM` 排空（Drain）

獨立執行時若收到 `SIGTERM` 訊號，伺服器進入 `draining = true` 狀態：

1. 向所有連線廣播 `{ type: 'notice', kind: 'draining' }` 並停止接受新的 `queue` 與 `create` 請求。
2. 等待所有進行中房間（`rooms.size === 0`）自然結束，最長等待 `DRAIN_SECONDS`（預設 `300` 秒）後關閉伺服器並結束行程；若再次收到 `SIGTERM` 或 `SIGINT` 則立即關閉退出。

---

## 與其他模組的相依關係

- **相依於 `src/physics`、`src/rules`、`src/ai`**：在伺服器端執行完全一致的投球軌跡求解、接觸與接殺模擬、比賽狀態機推進與捕手接捕判定。
- **相依於 `src/net/protocol.ts`**：使用 `normalizeClientMsg` 解碼客戶端 v2／舊版封包，並依 `wsCompactMode` 透過 `encodeServerMsgV2` 回傳精簡 v2 封包。
- **被 `deploy/` 與 `scripts/deploy.sh` 使用**：建置為 `dist-server/index.mjs` 後由 `systemd` 常駐執行。
