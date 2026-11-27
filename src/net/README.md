# `src/net` 精簡網路協定與連線客戶端模組

## 模組總覽

`src/net` 負責瀏覽器與權威伺服器之間的 WebSocket 通訊，包含超精簡 v2 線路協定編解碼器，以及具備自動路徑偵測、2 秒 RTT／抖動探測與伺服器負載感知能力的 `OnlineClient` 類別。

---

## 子模組／檔案職責表

| 檔案 | 職責 |
|---|---|
| [protocol.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/protocol.ts) | 定義 v2 精簡封包格式、`packMatch`／`unpackMatch` 比賽狀態壓縮、浮點數捨入及雙向訊息轉換（`normalizeClientMsg`、`encodeServerMsgV2`、`decodeServerMsg`）。 |
| [client.ts](file:///Users/chang/Documents/raspberry%20pi/capbaseball/src/net/client.ts) | 實作 `OnlineClient` WebSocket 客戶端、`/capbaseball` 子路徑偵測、`sessionStorage` 重連憑證管理、RTT 滑動視窗與穩定度故障轉移訊號。 |

---

## 核心資料流／演算法

### 1. 超精簡 v2 線路協定（`protocol.ts`）

為降低 Raspberry Pi 伺服器頻寬與行動網路傳輸延遲，客戶端在 `open` 時發送 `{ t: 'hi', n: name, v: 2 }` 啟用 v2 協定，每球封包體積相較原始 JSON 縮減約 75% 至 80%：

- **短標籤對應**：將訊息類型縮寫為 1 至 2 字元標籤，例如 `p`（`ping`）、`po`（`pong`）、`ps`（`pitch_submit`）、`sw`（`swing_input`）、`ns`（`no_swing`）、`pl`（`pitch_launch`）、`pr`（`pitch_result`）、`st`（`stats`）、`ms`（`match_start`）、`ss`（`state_sync`）、`sp`（`spectate_sync`）、`ab`（`abs_challenge`／`abs_result`）、`sj`/`sl`/`os`/`or`/`of`/`ox`（CPU 候補邀約流程）、`er`（`error`）。
- **`packMatch` 與 `unpackMatch`**：
  - 將三壘包狀態編碼為 3-bit 整數遮罩 `basesMask`（`0..7`，分別對應一、二、三壘），並以 `er` 編碼比賽結束原因（`1=mercy`、`2=disconnect`、`3=resign`）。
  - 將兩隊得分／安打／用球數／打序／保送／三振壓縮為長度 12 的元組 `t`，局數／半局／球數／出局／壘包／ABS 挑戰壓縮為長度 10 的元組 `g`，比賽統計壓縮為長度 4 的元組 `s`。
  - 省略固定先發打序陣列，由 `unpackMatch` 在接收端以 `DEFAULT_AWAY_LINEUP`／`DEFAULT_HOME_LINEUP` 重建，並同時向下相容舊版完整 JSON 訊息。
- **浮點數精度控制與揮空真值回傳**：透過 `round2` 與 `round3` 限制浮點小數位；`pitch_result` 的 `catchInfo` 同步攜帶 4 人守備攔截座標，且揮空（`r.c = 0`）一併回傳 `swingData` 與真實 `dtTiming`/`detail`/`hitField`，避免前端退回 `dtTiming = 0` 假象。`match_start`、`state_sync`、`spectate_sync` 與 `room_list` 亦攜帶 `roomKind`（`live`／`friend`）。

### 2. 子路徑偵測與會話儲存（`client.ts`）

- **子路徑自動偵測**：`getBasePath()` 檢查 `window.location.pathname` 是否為 `/capbaseball` 或 `/capbaseball/...`，`getWsUrl()` 據此自動組出 `ws(s)://<host>/capbaseball/ws` 或 `ws(s)://<host>/ws`，同時相容根目錄與反向代理子路徑佈署。
- **斷線重連憑證**：`saveSession` 與 `loadSession` 將房間代碼 `code` 與權杖 `token` 存於 `sessionStorage`（鍵名 `capbaseball_online_session`），供重新整理或短暫斷線後透過 `reconnect(code, token)` 恢復對戰。

- **自動恢復連線（2026-11-21）**：`main.ts` 的 `resumeSession()` 在 `loadSession()` 有憑證時，於 `onStatus(false)`、`visibilitychange`（可見）與 `pageshow`（`persisted`，iOS bfcache）觸發 `connect()` 後送 `reconnect`，失敗以 `1`、`2`、`4`、最多 `5` 秒退避重試；憑證被清除（`match_over`、`reconnect_failed`、`opponent_left`）即停止。
- **`?room=` 邀請連結**：開機時讀取後立即用 `history.replaceState` 從網址移除；若已有同房號的憑證，改走 `reconnect` 而非再次 `join`，避免重新整理後被伺服器判為 `room_full`。
- **舊連線防護**：`connect()` 的 `open`／`close`／`error` 都檢查 `this.ws === ws`，逾時被放棄的舊 socket 晚關閉時不會清掉新連線；預設連線逾時為 `6000` ms（行動網路喚醒較慢）。
- **背景節流**：`document.hidden` 時不送探測，且丟棄 `> 3000` ms 的 RTT 樣本，避免切回前景後誤判 `poor` 而在佇列中被自動轉 CPU。

### 3. 4 秒 RTT／抖動探測與 `NetQuality` 分級

`OnlineClient` 連線後啟動 `startPingLoop()`，每 `4000` ms 發送 `{ t: 'p', n: now }` 並以最近 5 筆樣本（`rttWindow`）計算平均延遲 `avgRttMs` 與抖動 `jitterMs = max(rttWindow) - min(rttWindow)`；若超過 `4500` ms 未收到回應則累計 `missedPings`。`recomputeNetQuality()` 依下列條件分級：

| `NetQuality` | 觸發條件 |
|---|---|
| `offline` | 尚未連線或 WebSocket 已關閉 |
| `poor` | `missedPings >= 3`、`avgRttMs > 650` ms 或 `jitterMs > 350` ms |
| `fair` | `avgRttMs > 220` ms 或 `jitterMs > 120` ms |
| `good` | 已連線且低於上述門檻 |

### 4. 自動切換 CPU 訊號（`isUnstable`／`isServerBusy`）

`OnlineClient` 對外暴露兩個布林唯讀屬性與 `onNetUpdate` 訂閱回呼，供 `src/main.ts` 執行無感備援：

- **`isUnstable`**：當 `!connected || netQuality === 'poor'` 時為 `true`。
- **`isServerBusy`**：當從伺服器 `welcome`、`stats` 或 `error` 訊息收到的 `serverLoad === 'red'` 時為 `true`（`yellow` 預警等級不再阻擋線上配對或標示 `BUSY`）。
- **雙模式編解碼（`OnlineGameMode`）**：`protocol.ts` 支援 `quick3`（`0`）、`tiebreak`（`1`）與 `official6`（`2`）於精簡 v2 封包中無損傳遞，同步用於配對佇列、好友房與觀戰列表。

---

## 與其他模組的相依關係

- **相依於 `src/physics`**：引用 `PitchId` 型別。
- **相依於 `src/rules`**：引用 `GameMode`、`MatchState`、`PlayerSlot` 型別。
- **被其他模組使用**：
  - `src/main.ts` 透過 `OnlineClient` 管理線上對戰、觀戰、網速顯示與自動切換 CPU。
  - `server/index.ts` 直接引用 `protocol.ts` 的 `normalizeClientMsg`、`encodeServerMsgV2` 與 `ServerLoadStatus`。
