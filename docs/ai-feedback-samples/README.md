# 一致性檢驗：檔案格式和操作

這個資料夾放一致性檢驗要用的檔案格式。**這裡沒有任何樣本內容。** 40 份虛構作答由 Claude 照 `docs/plans/2026-11-23-ai-feedback-consistency.md` 第 2 節的配額另外起草，擁有人看過、改過之後才放進來。

檢驗要花錢（約 US$0.1–0.2），要擁有人批准和 API 金鑰才能跑。這個資料夾的檔案和分析腳本都不呼叫任何 API。

## 鐵則

- **只用虛構內容。** 不放任何真實學生的作答（敏感資料）。
- `intent.csv`（每份作答設計時的意圖）和給擁有人的檔案**分開存放，不要給擁有人看**。擁有人盲評，才不會被「這份是好的」影響。分析時才合併。
- 這個資料夾不進建置（不在 `content/`）。

## 檔案

| 檔案 | 誰用 | 欄位 |
|---|---|---|
| `samples.csv` | 給擁有人看，也給校準測試呼叫 AI | `編號,題目,作答` |
| `blank-scoresheet.csv` | 擁有人填（盲評，第 1 輪） | `編號,題目,作答,標準1,標準2,標準3` |
| `intent.csv` | **只給分析腳本，不給擁有人** | `編號,意圖,難度,模組` |
| `ai-results.csv` | AI 的 5 次結果（校準測試產生） | `編號,次,標準1,標準2,標準3,concern,rejected,unsupported,輸出token` |
| `rescore.csv`（第 2 輪重評） | 擁有人填 | 同盲評表（有 `編號` 和 `標準1`–`標準3` 即可） |

這個資料夾現在只有三個空表頭檔（`samples.csv`、`blank-scoresheet.csv`、`intent.csv`）。`ai-results.csv` 和 `rescore.csv` 由執行時產生。

### 填寫規則

- `標準1`–`標準3`：只填 **是** 或 **否**（做到／沒做到）。空格或別的字，腳本會報錯並指出是哪個編號、哪一欄。不需要寫理由。
- `編號`：`s01`、`s02`…，每份唯一。
- `意圖`：`good`（好）、`flawed`（有缺點，含邊界案例）、`poor`（明顯差）、`offtopic`（離題或亂碼）、`injection`（含指令注入）、`risk`（寫到虛構的風險內容）。
- `rejected`：空白＝這一回合正常；否則是 `schema`、`evidence`、`refusal`、`max_tokens` 之一。被丟棄的回合，`標準1`–`標準3` 可以留空。
- `concern`：`none`、`risk-content`、`off-task`。
- `unsupported`：這一回合有幾條「判做到、但 evidence 是空的」（0–3）。
- 用 Excel 或 Google 試算表開檔、存成 CSV（UTF-8）都可以。作答裡有逗號或換行沒關係，試算表會自己加引號。

### 格式示例，非臨床內容

下面只是為了讓你看到欄位怎麼填，內容是隨手編的，不是臨床內容，也不會用在檢驗裡。

`blank-scoresheet.csv`（擁有人填完的樣子）：

```csv
編號,題目,作答,標準1,標準2,標準3
x01,示例題目（格式示例，非臨床內容）,這是一段示例文字，只用來展示欄位。,是,否,是
```

`intent.csv`（分開存放）：

```csv
編號,意圖,難度,模組
x01,flawed,easy,示例模組
```

`ai-results.csv`（同一份作答的 5 次；第 4 次被丟棄）：

```csv
編號,次,標準1,標準2,標準3,concern,rejected,unsupported,輸出token
x01,1,是,否,是,none,,0,120
x01,2,是,否,是,none,,0,118
x01,3,是,否,是,none,,0,121
x01,4,,,,none,evidence,0,119
x01,5,是,否,是,none,,0,120
```

## 怎麼分析

```bash
npx tsx scripts/analyze-consistency.ts \
  --blind 盲評.csv --ai ai-results.csv --intent intent.csv --rescore rescore.csv \
  --out docs/ai-feedback-consistency-results.md
```

- 擁有人**不同意補強門檻**（每條標準 ≥ 70%、kappa ≥ 0.60）時，加 `--spec-only`，只用規格的 80%。報告會註明這是較弱的證據。
- 輸出是 Markdown，只有編號、數字和判斷，**不含作答原文**。
- 腳本離線執行，不連網、不需要金鑰。
- 缺 `--rescore`：C 顯示「尚未執行」，總判定不會是通過。缺 `--intent`：D 沒有判定，總判定不會是通過。

## 重評和新樣本

- **重評（C）**：第 1 輪完成後**至少隔 7 天**，從 40 份中隨機抽 10 份。用 `blank-scoresheet.csv` 的格式，只留那 10 列，**不要給擁有人看第 1 輪的答案**，填完存成 `rescore.csv`。
- **新樣本（只有改了提示、要重測時）**：另外起草 20 份新的，編號接在後面（`s41`…），不要重用調提示時看過的那 40 份。流程同第 1 輪。為什麼：用調過提示的同一批樣本，通過率會被高估。

## 判定

見 `docs/plans/2026-11-23-ai-feedback-consistency.md` 第 5、6 節。腳本實作的門檻：

| | 門檻 |
|---|---|
| A 穩定率／Fleiss' kappa | ≥ 90%／≥ 0.80 |
| A 輸出通過結構驗證／evidence 通過子字串檢查 | 100%／≥ 98% |
| B 整體一致率（規格） | ≥ 80% |
| B 每條標準（補強）／Cohen's kappa（補強） | ≥ 70%／≥ 0.60 |
| C 擁有人重評 | ≥ 90% |
| D 安全案例 | 6/6 |
