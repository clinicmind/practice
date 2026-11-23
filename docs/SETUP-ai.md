# AI 回饋設定（只有專案擁有人能做）

AI 回饋有兩個函式：

- `ai-feedback`：學生自評並儲存後，按按鈕才收到 AI 對同一份回應的逐條評估。
- `ai-report-draft`：督導按按鈕，要一份報告回饋的 AI 草稿。草稿只有督導看得到，督導改過、用自己的名字發布，學生才看到。

**狀態：未經冒煙測試。** 下面的步驟是按文件寫的，還沒有在真實的 Supabase 和 Anthropic 上走過。第 10 節的冒煙測試通過之前，不要對學生開放。步驟名稱和按鈕可能和你看到的略有不同；差異大時停下來，告訴接手的 session。

標示「**待核實**」的步驟，是還沒有對照真實畫面或當時的官方文件寫的。**不要照著做**，先請接手的 session 核對。

**這些機密不可以貼在對話裡，也不可以交給任何人，包括 Claude：** Anthropic 的 API 金鑰、Supabase 的 service role key。金鑰只貼在 Supabase 的「Secrets」頁面。

做完這份文件之前，網站不會有任何改變：每個班的開關 `ai_enabled` 預設是關的，預算預設是 0（0＝全部停止）。**對學生開放，要你明確同意**（第 6 節）。

## 0. 先決定三件事（現在還沒有答案）

| # | 要你決定 | 建議 |
|---|---|---|
| 1 | 每月預算上限（美元） | 成本估算整班 30 人全課程約 US$3／12／45（低／中／高）。建議先用課程中情境的 2 倍當總上限，再除以月數。詳見 `docs/plans/2026-11-23-ai-feedback-cost.md` |
| 2 | Anthropic 帳號由誰付費、哪張卡 | 你自己建立，**花錢的動作，你先同意才做**。帳號端的用量上限設成第 1 項的 1.5 倍當第二道保險 |
| 3 | 資料保存條款 | 先讀 `docs/ai-feedback-data-terms.md`，回答它第 8 節。**回答之前，不傳任何真實學生作答給 API** |

## 1. 套用資料庫變更

正式專案目前套用到 `0003`。AI 功能要 `0007`，報告草稿要 `0008`。`0008` 要用到 `feedback` 表，所以報告功能的 `0004`、`0005`、`0006` 要先套用（它們的步驟在 `docs/SETUP-reports.md` 第 2 節；`0004` 在 `docs/HANDOFF.md` 第 2 節）。

**一次只貼一份，照編號順序，每一份都開一個新的查詢分頁。** 不要貼 `setup-all.sql`（它只給全新的專案）。

做法（每一份都一樣）：

1. 開 Supabase 專案 → 左側 **SQL Editor**。
2. 左上角按「**+**」（新查詢）。
3. 開啟 `supabase/migrations/` 裡的檔案，複製**全部內容**，貼進編輯器。
4. 按右下角 **Run**。
5. 成功時結果區顯示 `Success. No rows returned`。出現紅字錯誤就停下來，把錯誤訊息交給接手的 session，不要重複執行。

要貼的檔案，按這個順序（已經套用過的跳過）：

| 檔案 | 做什麼 |
|---|---|
| `0007_ai_feedback.sql` | AI 回饋的資料表、權限、每班的開關 `ai_enabled`（預設關）、預算表（預設 0） |
| `0008_ai_report_draft.sql` | 報告草稿的規則：草稿永遠不能發布、學生永遠讀不到；每名學生每週草稿數的計數欄位 |

檢查：在**新的查詢分頁**貼這一句，按 **Run**：

```sql
select name, ai_enabled from cohorts;
select * from ai_budget;
```

預期：每個班 `ai_enabled` 都是 `false`；`ai_budget` 有一列，`monthly_limit_usd` 是 `0`。

## 2. 貼上函式

兩個函式各做一次。

1. 左側 **Edge Functions** → **Deploy a new function** → **Via Editor**。
2. 函式名稱（要完全一樣，小寫）：第一次填 `ai-feedback`，第二次填 `ai-report-draft`。
3. 刪掉編輯器裡的範例程式，貼上對應檔案的**全部內容**：
   - `ai-feedback` → `supabase/functions/ai-feedback/index.ts`
   - `ai-report-draft` → `supabase/functions/ai-report-draft/index.ts`

   這兩個檔案是程式產生的單一檔案（各約 150 KB），不要修改。Supabase 網頁編輯器能否接受這麼大的檔案，**尚未證實**（見第 11 節）。貼不上、或貼上後編輯器卡住，停下來告訴接手的 session。
4. **Deploy function**。
5. 如果之後測試時看到 `Invalid JWT`，到這個函式的設定頁，把 **Verify JWT** 關掉再試一次。函式自己會向 Supabase 驗證登入，所以關掉不會讓未登入者通過。這一點尚未證實（同 `reports` 函式）。

函式更新時（改了提示、修了錯），要把新的 `index.ts` 全部內容再貼一次並 **Deploy**。

## 3. 設定密鑰

**Edge Functions** → **Secrets**（或 **Manage secrets**）→ 新增：

| 名稱 | 值 | 給誰用 |
|---|---|---|
| `SITE_URL` | `https://practice.clinicmind-inquire.workers.dev`（正式網站網址，前後沒有空格，結尾不加 `/`） | 兩個函式。它們從這個網站讀題目內容和已審核的規準 |
| `ANTHROPIC_API_KEY` | Anthropic 的 API 金鑰 | 兩個函式。**第 7 節完成後才有。** 現在不設也行：沒有金鑰時，每個要呼叫 AI 的請求都會失敗，不會花一毛錢 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN` | 已為報告功能設過的那三個（`docs/SETUP-reports.md` 第 2 節第 4 步） | `ai-report-draft` 要從你的 Drive 讀報告全文。**不用再設一次**（密鑰是整個專案共用的；這一點待核實） |

Supabase 會自動提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`。**你不需要複製或貼上任何 Supabase 金鑰。**

## 4. 設定預算上限

沒設定之前，預算是 `0`，所有 AI 呼叫都會被擋下（回「預算已用完」）。這是故意的。

SQL Editor → **+** 新查詢 → 貼上（把 `10` 換成你決定的**每月**美元數）→ **Run**：

```sql
update ai_budget set monthly_limit_usd = 10;
select * from ai_budget;
```

預期：第二句顯示 `monthly_limit_usd` 是你設的數字。

- 每個月的第一天（UTC）自動重新計算，不用做任何事。
- `warn_at` 預設 `0.80`：用到 80% 時，督導後台（做好之後）會顯示警告。
- 要停止所有 AI 花費：`update ai_budget set monthly_limit_usd = 0;`。

## 5. 報告草稿還缺什麼

`ai-report-draft` 只在**評閱規準經你審核**之後才會運作。規準各級的描述現在是草稿（見 `docs/SETUP-reports.md` 第 2.5 節）。審核通過、網站發布規準檔之後，函式才會讀到它。**在那之前，函式一律回 `rubric_unreviewed`，不呼叫 AI。** 發布規準檔的建置步驟還沒有做，由接手的 session 處理。

督導按「產生 AI 草稿」的介面也還沒有做（要等督導評閱介面）。

## 6. 為一個測試班打開／關閉 AI（對學生開放的那一步）

**這一步會讓該班學生看到 AI 回饋按鈕。先確認：** 第 0 節三件事都決定了；第 4 節預算設了；第 10 節冒煙測試通過；你明確同意開放。

打開（把名稱換成測試班的班名）：

```sql
update cohorts set ai_enabled = true where name = '測試班名稱';
select name, ai_enabled from cohorts;
```

關閉：同一句，把 `true` 改成 `false`。其他班維持關閉。

學生和督導都不能從網站改這個開關，只有你在 SQL Editor 能改。

## 7. Anthropic Console（待核實）

> **這一節是大綱，不是操作步驟。** 按鈕名稱、順序我沒有核對。等你建立好帳號，由接手的 session 讀**當時**的官方文件，再把它寫成「按哪個按鈕」。

要完成的事：

1. 建立 Anthropic 帳號（用你自己的電郵）。**待核實**
2. 綁定付款方式。**這是花錢的動作，先同意再做。** **待核實**
3. 設定帳號端的每月用量上限（建議是第 4 節預算的 1.5 倍；這是第二道保險，第一道是第 4 節）。**待核實**
4. 建立 API 金鑰，命名例如 `clinicmind-practice`。金鑰只顯示一次，**直接貼進 Supabase 的 `ANTHROPIC_API_KEY`（第 3 節），不要貼在對話裡。** **待核實**
5. 確認資料保存設定（對照 `docs/ai-feedback-data-terms.md`）。**待核實**

## 8. 看用量

督導後台的用量面板**還沒有做**。現在用 SQL Editor。以下查詢只讀，不改任何資料。

本月花了多少、預算還剩多少：

```sql
select
  round(coalesce(sum(u.cost_usd), 0), 4) as spent_usd,
  (select monthly_limit_usd from ai_budget) as limit_usd,
  count(u.id) as requests
from ai_usage u
where u.created_at >= date_trunc('month', now());
```

依種類和結果分開看（`practice` 是練習回饋，`report_draft` 是報告草稿，`eval` 是校準測試；`ok` 是成功，`invalid`／`refusal`／`error` 是被丟棄的）：

```sql
select kind, outcome, count(*) as requests, round(sum(cost_usd), 4) as usd
from ai_usage
where created_at >= date_trunc('month', now())
group by kind, outcome
order by kind, outcome;
```

匯出成檔案（給成本文件對照用）：把查詢改成 `select * from ai_usage where created_at >= date_trunc('month', now());`，在結果區找 **Export** 或 **Download CSV** 之類的按鈕。**待核實**（按鈕名稱）。

`ai_usage` 裡只有數字和標籤，沒有任何作答或報告的文字。

## 9. 出問題怎麼辦

**一鍵全關**（SQL Editor，新查詢，Run）：

```sql
update cohorts set ai_enabled = false;
update ai_budget set monthly_limit_usd = 0;
```

第一句關掉所有班的 AI；第二句即使開關被誤開，也一毛錢都不會花。

**金鑰可能外洩**（貼錯地方、傳給了別人）：

1. 先做上面的一鍵全關。
2. 到 Anthropic Console 撤銷那把金鑰。**待核實**（按鈕位置）。
3. 建一把新的，貼進 Supabase 的 `ANTHROPIC_API_KEY`，覆蓋舊的（第 3 節）。
4. 在 Anthropic Console 看這段時間有沒有不認得的用量。**待核實**
5. 確認沒事後，再依第 4、6 節重新設預算和開關。

**學生說 AI 回饋沒有出現：** 常見原因和畫面上看到的訊息：

| 訊息代碼 | 意思 | 怎麼辦 |
|---|---|---|
| `ai_disabled` | 這個班的開關是關的 | 要開才開（第 6 節） |
| `budget_exhausted` | 預算是 0 或這個月用完了 | 第 8 節看用量；第 4 節調整 |
| `daily_cap`／`item_cap`／`weekly_cap` | 學生當天、同一題或該學生這週的草稿次數到上限 | 正常，等一天（週上限等一週） |
| `unavailable` | AI 沒有回應，或回答沒有通過檢查，被丟棄 | 稍後再試；多數是暫時的。連續出現就看第 8 節的 `invalid`／`error` 筆數，告訴接手的 session |
| `rubric_unreviewed` | 報告規準還沒審核（第 5 節） | 正常 |
| `file_gone`／`drive_auth` | 報告的 Drive 檔案不見了，或 Google 授權失效 | 見 `docs/SETUP-reports.md` 第 5 節 |

## 10. 冒煙測試（尚未做）

在第 0–4 節和第 7 節完成後，和接手的 session 一起做。全部用**虛構**內容，用測試班和測試學生帳號。

1. 不開開關：學生按 AI 回饋按鈕。預期：被擋下，第 8 節的查詢沒有任何新列，Anthropic Console 沒有用量。
2. 開測試班（第 6 節）。學生做一題、自評並儲存、按按鈕。預期：收到 AI 回饋；`ai_usage` 多一列，`outcome = 'ok'`。
3. 同一題再按一次。預期：看到的是同一份結果，`ai_usage` 沒有新列。
4. 預算設成 `0`，再按另一題。預期：被擋下。測完設回正確的值。
5. 在 Anthropic Console 對照這幾次的用量和 `ai_usage` 的 `cost_usd`，差距應該很小。差距大，就要用這些數字校準（計畫 T16）。**待核實**
6. 督導流程要等介面做好才能測。

只有全部通過，才可以考慮對學生開放。

## 11. 尚未證實的地方（如實列出）

- 兩個函式只在行程內 Postgres 和模擬的 `fetch`（假的 Supabase、假的 Google、假的 AI）測過，**沒有連過真實的 Supabase、Google 或 Anthropic**，也沒有呼叫過任何付費 API。
- Supabase 網頁編輯器能否接受約 150 KB 的單一檔案，尚未證實。（`reports` 函式只有約 28 KB，那個也尚未證實。）
- Anthropic 的請求格式（結構化輸出、快取、`effort`）是照文件寫的，第一次對真實 API 驗證是第 10 節。報告草稿的 `max_tokens`（3,500）、思考設定，同樣沒有用真實呼叫校準。
- 報告草稿用 Sonnet 5.5，一次約 US$0.1（含全文 3–4 萬 token）。以每名學生每週最多 2 份計。
- 單次 AI 請求的逾時：練習回饋 30 秒，報告草稿 90 秒。Supabase 函式本身的執行時間上限是否夠，尚未證實。
- 同一份報告兩位督導同時按「產生草稿」，兩次都會呼叫 AI 並計費，但只留一份草稿。每名學生每週上限擋得住重複。
- 資料保存條款還沒有擁有人的決定（第 0 節第 3 項）。
- 上面所有 Supabase 介面的按鈕名稱、順序，是按文件寫的，沒有在真實畫面上走過。
