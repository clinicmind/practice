# 交接文件

最後更新：2026-11-15。由上一個 session 寫給接手的 session。每完成一個里程碑就更新這一頁。

## 1. 現況

正式網站已部署在 Cloudflare，並已連上 Supabase（建置紀錄顯示 `[mode] CLOUD`）。

| 部分 | 狀態 | 驗證 |
|---|---|---|
| 階段 1：走讀、練習、反思 | 完成 | 單元測試＋端到端 |
| 介面設計（2026-11-15 重做） | 完成 | 桌面英文、桌面繁中、手機 360px 逐頁截圖檢查 |
| 基礎階段 8 個模組，英文和繁中 | 完成，兩種語言都已審核登記 | 建置腳本逐項對照兩種語言的結構 |
| 語言切換（英文／繁中） | 完成 | 單元測試＋端到端 |
| 階段 2：登入、雲端進度、督導後台 | 程式完成，已上線 | 權限規則只在行程內 Postgres 測過，見第 3 節 |
| 階段 3 Task 1：去識別化掃描器 | 完成 | 142 個測試 |
| 階段 3 Task 2–6：報告上傳、Drive、評閱 | 未開始 | — |
| 階段 4–6：AI 回饋、EFT、DBT | 只有設計規格 | — |

最後一次完整測試：`npm run check` 309＋142 個通過；`npm run e2e` 24 個通過、4 個跳過。

## 2. 擁有人還沒做完的事

1. 建立督導帳號。擁有人已成功登入（電郵確認後被帶到輸入邀請碼的頁面，這是預期行為，因為還沒有 profile）。擁有人第一次在 SQL Editor 貼指令時出錯，原因是貼在舊內容下方並連同整份設定檔再執行了一次。已改給一段不用修改的指令（見 `docs/SETUP.md` B 部分第 3 步），並說明要開新的查詢分頁。下次對話先問這一步成功了沒有。
   正式網址：`https://practice.clinicmind-inquire.workers.dev`。
2. 手動檢查學生隔離：用兩個電郵各開一個學生帳號，各做一題，確認互相看不到對方的作答，督導看得到兩人。
3. 全班使用前，在 Supabase 設定自己的 SMTP。內建電郵服務每小時只能發很少的信。

## 3. 已知的缺口（如實列出）

- **4 個端到端測試從未執行**（`e2e/isolation.spec.ts`、`e2e/supervisor.spec.ts`）。它們需要 `E2E_SUPABASE_SERVICE_KEY`，而這把金鑰留在擁有人手上。替代做法是第 2 節的手動檢查。
- 已用公開金鑰實測正式專案：未登入者讀不到、寫不進任何資料表，也呼叫不了函式。已登入用戶之間的隔離，只有行程內 Postgres（pglite）的測試。
- 模組 3–8 的英文內容和全部繁中內容，擁有人說「all ok」後登記。上一個 session 只抽讀了一部分。學生回報內容問題時，先當成真的問題處理。
- 去識別化掃描器的姓名規則會漏也會誤報。8 位數而且以 2、3、5、6、7、9 開頭的數字一律當成電話（high）。

## 4. 已定的決策（照做，要改先問擁有人）

| 決策 | 理由 |
|---|---|
| 全系統一個貫穿個案 Client M，設定在 `content/CLIENT_M.md` | 學生要體驗一個完整療程 |
| 示範回應獨立成檔，學生提交後才載入 | 先自己想，再對照 |
| 過關靠自評（3 條標準中 2 條，回應 ≥20 字元；每級 10 題中 8 題） | 自評是弱證據，所以督導後台有可疑作答的標記 |
| 選項用「貼切／可行／不貼切」 | 臨床回應很少只有一個正解 |
| 內容按語言分開審核；未審核的繁中模組退回英文並顯示提示 | 審核是上線關卡 |
| 進度以題目 id 為鍵，兩種語言共用 | 切換語言不遺失進度 |
| 報告只接受貼上的文字 | 檔案的中繼資料常含姓名 |
| 報告正文存擁有人的 Google Drive，資料庫只存標題和統計 | 擁有人的要求。細節在規格 §8.5 和階段 3 計畫的「修訂」 |
| 學生不能直接寫入報告表，只能經 Edge Function | 伺服器要再掃描一次 |
| 未來的 `created_at` 會被改成現在 | 「以最新一次作答為準」，未來時間可以令一次作答永遠最新 |
| 走讀不示範風險處置流程，只示範怎樣問 | 風險處置依實習機構守則 |
| 內容不寫診斷名稱、藥物名稱、有版權的量表 | 內容規則，見規格 §5 和工具包規格 §4 |

## 5. 踩過的坑

**部署**
- 用的是 Cloudflare **Workers**，設定在 `wrangler.jsonc`。加入「全部轉到 index.html」的 `public/_redirects` 會令部署失敗（被判為無限循環）。深層連結由 `not_found_handling` 處理。
- Supabase 變數在**建置時**讀取。它們要放在 Cloudflare 的 Settings → Build → Variables and secrets。建置紀錄的 `[mode]` 行顯示結果。
- `public/_headers` 的 `connect-src` 寫死了 Supabase 專案網址。換專案要一併改。
- 擁有人找不到「重新部署」按鈕時，推送一個真實的小改動就會觸發建置。

**資料庫**
- `supabase/setup-all.sql` 由 `supabase/migrations/*.sql` 合併而成，有測試檢查兩者一致。新增 migration 後要重新產生它：
  `{ echo "-- GENERATED from supabase/migrations/*.sql. Do not edit. Paste the whole file into the Supabase SQL Editor once, on a new project."; for f in supabase/migrations/*.sql; do echo; echo "-- ===== $(basename $f) ====="; cat "$f"; done; } > supabase/setup-all.sql`
- 正式專案已套用 0001–0003。之後每份新 migration，請擁有人**只貼那一份**到 SQL Editor。`setup-all.sql` 只給全新的專案用。
- 階段 3 計畫寫的檔名要順延：報告表是 `0004_reports.sql`，保存期限是 `0005_retention.sql`。
- 權限測試用 pglite 加一個模擬 Supabase 的 shim（`supabase/tests/harness.ts`）。Supabase 特有的預設權限不在測試範圍內，所以 migration 明確撤銷了 anon 的全部權限。

**內容**
- 兩種語言的 id、level、skill、決策點、選項 id、`fit` 必須逐一相同，否則建置失敗。
- 改了某模組的 `version`，它就變回未審核，學生會看不到（繁中則退回英文）。改內容時要同時處理 `content/REVIEW.md`，並先取得擁有人同意。
- `drills.yaml` 用 YAML 錨點共用評分標準。同一技能同一級共用一組。
- 繁中用語表在 `docs/plans/2026-11-15-zh-hant.md`。新內容照用。
- choice 決策點的 `actual` 要和其中一個 `strong` 選項的文字完全相同。

**介面設計**
- 設計概念寫在 `src/styles.css` 頂部：襯線字是會談中的聲音（個案的話、治療師的回應、學生寫的回應），無襯線字是工具的聲音。梅紫色標記個案，松綠色標記治療師的技藝和進度，赭色只用在學生要行動的地方（決策點、下一個階段）。新增畫面時照這套規則，不要引入新的顏色或字型。
- 字型自帶（fontsource），因為安全標頭只容許載入本站資源。中文字型按字元分割成數百個小檔，只會下載用到的部分。
- 內容的 YAML 用 `>-` 折行時，中文行與行之間會多出空格。繁中的長文字寫成單行字串。

**環境**
- 這個雲端環境的網路是白名單制。名為「ClinicMind」的環境已開放正式的 Supabase 網址。其他網址被擋時，用環境工具提出申請。
- Playwright 和 Chromium 已預裝，直接用。
- 掃描器的測試要用 `npx vitest run --root packages/deid`。`npm run check` 已包含它。
- 開子 session 做獨立工作是可行的（階段 1、2、雙語都這樣做）。子 session 遇到用量上限會直接失敗，要重新送一次訊息。它們完成後不一定會通知，要主動查看。

## 6. 下一步（按次序）

1. **確認雲端模式可用。** 問擁有人第 2 節的三件事。有問題先修。
2. **階段 3 Task 2–6。** 計畫在 `docs/plans/2026-11-15-practice-phase3.md`，注意頂部的「修訂」和「進度更新」。動工前有兩個未解決的問題要先處理：
   - Edge Function 怎樣部署。擁有人不會用命令列。先確認能否在 Supabase 介面的 Edge Function 編輯器貼上程式碼；每個函式要做成單一檔案才可行。
   - Google Drive 授權。規格 §8.5 選了 OAuth `drive.file`。擁有人要在 Google Cloud 建立 OAuth 用戶端，並取得 refresh token。先寫出逐步指引，並做冒煙測試。行不通就停下來，和擁有人商量改用「正文存資料庫，每日備份到 Drive」。
   - `reports_enabled` 預設關。擁有人已確認實習單位容許上傳去識別化的報告，保存期限是學期結束後 90 天。
3. **階段 4–6。** 設計規格在 `docs/specs/2026-11-15-stage4-6-design.md`。每個階段先寫實作計畫，再動工。階段 4 要花錢，先給擁有人成本估算。
4. **專案 1（收入產品）** 在另一個 repo `clinicmind/clinicmind`，看它的 `docs/roadmap/STATUS.md`。

## 7. 文件地圖

| 檔案 | 內容 |
|---|---|
| `docs/SETUP.md` | 上線和審核的操作步驟（給擁有人） |
| `docs/specs/2026-11-15-practice-system-design.md` | 系統設計規格 |
| `docs/specs/2026-11-15-stage4-6-design.md` | AI 回饋、EFT、DBT 的設計規格 |
| `docs/plans/2026-11-15-practice-phase{1,2,3}.md` | 各階段實作計畫（1、2 已完成，留作參考） |
| `docs/plans/2026-11-15-zh-hant.md` | 翻譯規則和用語表 |
| `content/CLIENT_M.md` | Client M 的設定和 8 個模組的療程弧線 |
