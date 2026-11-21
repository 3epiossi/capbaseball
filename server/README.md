# `server` 權威對戰伺服器模組

## 模組總覽

`server` 目錄包含單一核心檔案 [index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts)，實作結合靜態網頁服務、`/health` 健康檢查與 WebSocket 即時多人對戰的權威伺服器。伺服器在後端重跑與前端完全一致的 6-DOF 投打物理與 2025-02 規則狀態機，並內建綠區負載卸載、HTTP／WS 安全強化與無中斷優雅停機機制。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [index.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/server/index.ts) | 啟動 HTTP 與 WebSocket 伺服器，負責房間配對、權威投打結算、ABS 挑戰同步、觀戰廣播、負載卸載閘門、安全防護與對局紀錄寫入（`matches.jsonl`）。 |

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
  - 已知未修：親友房在伺服器忙碌時回 `server_busy` 會被客戶端導向 CPU 對戰；建房／加入按鈕沒有連點防護；`sendToRoom` 清除失效觀戰者時未重設 `watchingCode`。
- **回合與序號驗證**：每球遞增 `pitchSeq`，伺服器僅接受符合當前 `turnState`（`awaiting_pitch` 或 `awaiting_swing`）、正確投打方且 `msg.pitchSeq === room.pitchSeq` 的指令，自動忽略重複、過期或越權封包。
- **投打結算**：收到 `pitch_submit` 後，伺服器以加密安全亂數產生 `seed` 並呼叫 `solvePitchTrajectory`（`120` Hz）計算軌跡，廣播 `pitch_launch` 並啟動逾時自動判不揮棒計時器；收到 `swing_input`、`no_swing` 或逾時後，呼叫 `evaluateSwingResolution`、`checkCatcherCatch`、`evaluateUmpirePitchCall` 與 `applyPitchResult` 完成權威判決並廣播 `pitch_result`。

### 2. 雙路徑服務與綁定設定

- **根目錄與子路徑相容**：HTTP 伺服器同時支援 `/` 與 `/capbaseball/`；收到無結尾斜線的 `/capbaseball` GET／HEAD 請求時，自動回傳 `301` 導向 `/capbaseball/`，其餘請求則剝除 `/capbaseball` 前綴對應 `dist/` 靜態檔（優先提供預壓縮 `.gz` 檔案）與 `/health` 端點。
- **生產環境綁定**：透過 `process.env.HOST` 控制監聽位址（未設定時預設 `0.0.0.0`），生產環境建議搭配 `HOST=127.0.0.1` 僅對本機反向代理（如 Nginx／Cloudflare Tunnel）開放。

### 3. 綠區負載卸載閘門（`getServerLoad`）

伺服器透過 `monitorEventLoopDelay({ resolution: 20 })` 持續監測事件迴圈 p95 延遲（`lagMs`），並結合 RSS 記憶體、房間數（預設上限 `MAX_ROOMS=20`）與連線數（預設上限 `MAX_CLIENTS=80`）計算負載等級：

| 狀態 | 條件（任一成立） | 行為 |
|---|---|---|
| `red` | `lagMs >= 90` ms、`rooms >= maxRooms`、`clients >= maxClients` 或 `rssMb >= maxRssMb * 0.9` | 拒絕 `queue` 與 `create`，回傳 `server_busy` |
| `yellow` | `lagMs >= 45` ms、`rooms >= 0.8 * maxRooms`、`clients >= 0.8 * maxClients` 或 `rssMb >= 0.8 * maxRssMb` | 拒絕 `queue` 與 `create`，回傳 `server_busy` |
| `green` | 低於上述所有門檻 | 正常開放配對與建房 |

當狀態非 `green` 時，已進行中的對局不受影響，新排隊或開房請求會收到 `{ type: 'error', code: 'server_busy', load }`，引導前端自動轉為單機 CPU 對戰。

### 4. HTTP 與 WebSocket 安全強化

- **HTTP 安全標頭**：所有 HTTP 回應均附加 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy: camera=(), microphone=(), geolocation=()` 與嚴格 `Content-Security-Policy`（`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; base-uri 'self'; frame-ancestors 'none'`）。
- **隱藏檔與路徑穿越封鎖**：拒絕任何包含空位元組（`\0`）、以 `.` 開頭的路徑區段（如 `/.env`）或超出 `staticDir` 範圍的請求，回傳 `403 Forbidden`。
- **玩家名稱淨化（`sanitizeName`）**：移除控制字元與 `<>'"`&`，裁切至最多 16 字元；空字串則退回隨機 `PlayerXXXX`。
- **WebSocket 防護**：`WebSocketServer` 設定 `maxPayload: 16 * 1024`（16 KB）並關閉 `perMessageDeflate: false`；連線時檢查來源 IP（支援 `cf-connecting-ip`／`x-forwarded-for`）並限制單一 IP 最多 `maxConnPerIp`（預設 `12`）條連線；每條連線套用 1 秒滑動視窗頻率限制，超過 `maxMsgsPerSec`（預設 `30`）則回傳 `rate_limited` 並以代碼 `1008` 關閉連線。

### 5. 優雅 `SIGTERM` 排空（Drain）

獨立執行時若收到 `SIGTERM` 訊號，伺服器進入 `draining = true` 狀態：

1. 向所有連線廣播 `{ type: 'notice', kind: 'draining' }` 並停止接受新的 `queue` 與 `create` 請求。
2. 等待所有進行中房間（`rooms.size === 0`）自然結束，最長等待 `DRAIN_SECONDS`（預設 `300` 秒）後關閉伺服器並結束行程；若再次收到 `SIGTERM` 或 `SIGINT` 則立即關閉退出。

---

## 與其他模組的相依關係

- **相依於 `src/physics`、`src/rules`、`src/ai`**：在伺服器端執行完全一致的投球軌跡求解、接觸與接殺模擬、比賽狀態機推進與捕手接捕判定。
- **相依於 `src/net/protocol.ts`**：使用 `normalizeClientMsg` 解碼客戶端 v2／舊版封包，並依 `wsCompactMode` 透過 `encodeServerMsgV2` 回傳精簡 v2 封包。
- **被 `deploy/` 與 `scripts/deploy.sh` 使用**：建置為 `dist-server/index.mjs` 後由 `systemd` 常駐執行。
