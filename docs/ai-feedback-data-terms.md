# AI 回饋：資料保存與條款核對

**讀取日期：2026-11-23。** 這是階段 4 計畫 T3，也是規格的上線關卡 3。
本文只寫「官方文件怎麼說」和「還要擁有人決定什麼」。**不替擁有人接受任何條款。**
在擁有人讀完並回答第 8 節之前，不傳任何真實學生作答給 API（D3）。

## 1. 讀過的來源

| # | 來源 | 狀態 |
|---|---|---|
| S1 | https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention（實際導向 `…/manage-claude/api-and-data-retention`，標題 API and data retention） | 2026-11-23 讀到全文 |
| S2 | https://platform.claude.com/docs/en/build-with-claude/data-residency（導向 `…/manage-claude/data-residency`） | 2026-11-23 讀到全文 |
| S3 | https://www.anthropic.com/legal/commercial-terms（頁面顯示日期 Jun 17, 2025） | 2026-11-23 讀到；只讀到摘要，沒有逐條讀全文 |
| S4 | https://platform.claude.com/docs/en/models/haiku-5-5/overview | 2026-11-23 讀到全文 |
| S5 | https://platform.claude.com/docs/en/models/sonnet-5-5/overview | 2026-11-23 讀到全文 |
| S6 | https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data（商業客戶標準保存期限） | **讀不到。** 這個工作階段的網路白名單不含 `privacy.claude.com`（主機名稱解析失敗）。需要擁有人在環境的網路設定允許這個網址，才能再讀 |
| S7 | Data Processing Addendum（DPA）全文 | **沒有讀。** 只從 S3 確認商業條款引用它 |
| S8 | 隱私政策 https://www.anthropic.com/legal/privacy | **沒有讀** |

說明：網頁內容經讀取工具轉成文字，可能有轉換誤差。下面的引文請擁有人對照原頁面再確認一次，特別是要簽署或告知學生的部分。

## 2. 學生作答送給 API 後，保存多久？誰看得到？

**是什麼（S1 原文）：**
- "Conversation content (your prompts and Claude's outputs) is not retained by default; the exception is Covered Models, which require 30-day retention."
- "Retained data is never used for model training without your express permission."
- 例外：“Even with ZDR or HIPAA arrangements in place, Anthropic may retain data where required by law or where it has been flagged by Anthropic's automated trust and safety systems. As a result, if a chat or session is flagged, Anthropic may retain inputs and outputs for up to 2 years.”
- 「Covered Models」只列 Claude Fable 5.2／5.1／5 和 Claude Mythos 5.2／5.1／5。**Haiku 5.5 和 Sonnet 5.5 不在名單內**（S1、S4、S5 都沒有保存天數的特別要求）。

**對我們的意思：**
- 我們用的兩個模型不要求 30 天保存。
- 被系統標記的內容最長可保存 2 年。拒答（`stop_reason: "refusal"`）或內容觸發安全分類時，可能發生。所以「完全不留」不成立。
- 誰看得到：文件沒有說明誰可以讀這些被保存的資料。**未證實。**
- 商業客戶的標準保存期限（沒有簽 ZDR 時是幾天）：**未證實**。S1 說預設不保存對話內容，但這和我所知的舊說法不一致，要讀 S6 才能確認。這一點擁有人不要憑本文決定。

**擁有人要決定：** 能否接受「預設不保存，但被標記時最長 2 年」。以及要不要先讓 S6 可讀、讀完再決定。

## 3. 是否用於訓練？

**是什麼：**
- S3 第 B 節：“Anthropic may not train models on Customer Content from Services.” Customer Content 包括輸入和輸出。
- S1：保存的資料「未經你明確許可，不用於訓練」。

**對我們的意思：** 商業條款和資料保存頁面都寫不用於訓練。前提是我們走的是**商業 API 帳號**（Commercial Terms），不是消費者方案。
**注意：** 如果擁有人用個人的 claude.ai 訂閱（Free／Pro／Max）或 Console 的 playground 試用，那不是商業條款的 API 使用，S1 明列它們「不在 ZDR 範圍」。測試和上線都要用 API 金鑰（D2 的帳號）。

**擁有人要決定：** 用哪個 Anthropic 帳號，是否為商業條款帳號。

## 4. 能否申請零資料保存（ZDR）？

**是什麼（S1）：**
- “To request ZDR for your organization, contact the Anthropic sales team.” ZDR 按「組織」開通，每個新組織要另外開。
- 結構化輸出是 “Yes (qualified)”：提示和輸出不保存，只有 JSON schema 會快取最長 24 小時。我們的 schema 只有欄位名稱和 `enum`，沒有任何學生資料。
- 提示快取是 “Yes”：只有 KV 快取和雜湊在快取存活期間存在記憶體，期滿即刪。
- 思考（thinking）、effort 是 “Yes”。
- 有 ZDR 的組織**不能**從瀏覽器直接呼叫 API（CORS 被拒）。我們從 Edge Function 呼叫，不受影響。
- Haiku 5.5、Sonnet 5.5 不是 Covered Models，所以不會因為 ZDR 而不可用。

**對我們的意思：** ZDR 要聯絡 Anthropic 業務，不是我們能自助開通的，也不知道門檻或費用（**未證實**）。我們使用的所有功能（結構化輸出、快取、思考、effort）都在 ZDR 資格內。

**擁有人要決定：** 是否值得為這個課程聯絡業務申請 ZDR。這要看第 8 節的待決定項。

## 5. 資料送到哪個區域？

**是什麼（S2）：**
- `inference_geo` 預設 `"global"`：推論可能在任何地區。可設 `"us"`：只在美國境內推論。
- Haiku 5.5 和 Sonnet 5.5 都支援 `inference_geo`。
- `"us"` 的價格是標準價的 1.1 倍（輸入、輸出、快取寫入、快取讀取都是）。
- 靜態儲存位置（workspace geo）目前只有 `"us"`，建立 workspace 時決定，之後不能改。
- 也可以在 Console 的 workspace 設定「允許哪些 geo」和「預設 geo」（S2 的 Console 步驟）。

**對我們的意思：** 現在的程式（T4）**沒有送 `inference_geo`**，所以走預設的 `global`。沒有任何一個選項能把推論放在香港或台灣。若擁有人要「只在美國」，可以在 Console 設 workspace 預設，或在請求加 `inference_geo: "us"`；成本會加 10%，`costUsd` 也要乘 1.1。

**擁有人要決定：** `global`（預設）還是 `us`。我沒有替你選。

## 6. 學生要知道什麼？同意書要不要改？

這是擁有人和實習單位的問題，**我不能代答**。能提供的事實：
- 學生送出的練習回應會被送到 Anthropic 的 API（美國公司），由模型處理。
- 功能預設關閉，按班別開啟，學生要按「看看 AI 的評估」才會送出（計畫 T8）。
- 學生的練習回應是虛構個案的對話練習，不應含真實個案的可識別資料。介面可以加一句提醒。
- 這份文件讀不到 DPA（S7）和隱私政策（S8）。要簽 DPA 或寫進同意書，要先讀它們。

**擁有人要決定：** 介面要不要加說明；同意書要不要改；是否需要問實習單位。

## 7. 報告草稿（T12）：單獨的一項

報告草稿會把學生**報告的全文**送給 Sonnet 5.5。
- 報告已經過去識別化掃描，但掃描會漏（HANDOFF 第 3 節）。所以報告全文送出去，等於把「可能殘留的識別資料」送給外部服務。
- 第 2 到 5 節的事實同樣適用：預設不保存、不用於訓練、被標記時最長保存 2 年、預設全球推論。
- 本文**沒有**證實：標準保存期限（S6）、誰能看到被保存的資料、ZDR 的門檻。

這一項的風險比練習回饋高，因為內容比較長，也比較可能含真實個案資訊。**建議在擁有人回答 D3 之前，T12 的真實呼叫不進行**（計畫已這樣擋住）。T12 的程式碼可以先寫，用假 LLM 測試。

## 8. 結論（只寫事實和待決定項）

事實：
1. 商業條款寫明不用客戶內容訓練（S3，頁面日期 2025-06-17）。
2. 資料保存頁面寫明對話內容預設不保存；被標記的內容最長可保存 2 年（S1）。
3. Haiku 5.5、Sonnet 5.5 沒有額外的 30 天保存要求（S1、S4、S5）。
4. 結構化輸出、提示快取、思考、effort 都在 ZDR 資格內（S1）。
5. Haiku 5.5 和 Sonnet 5.5 支援 `inference_geo`；`us` 加價 10%（S2）。

**未證實（要靠擁有人或更多文件）：**
- 商業 API 的標準保存天數（要讀 S6；需要把 `privacy.claude.com` 加進網路白名單）。
- 誰能看到被保存或被標記的資料。
- ZDR 的申請門檻和費用。
- DPA 全文（S7）、隱私政策（S8）。

**待擁有人決定（D3 的內容）：**
1. 能否接受第 2 節的保存條件。
2. 是否申請 ZDR。
3. `inference_geo` 用 `global` 或 `us`。
4. 學生說明和同意書。
5. 報告草稿要不要開（第 7 節）。

## 9. 順帶核對到的事（對計畫其他部分有用）

- Haiku 5.5 最小可快取長度確認為 **512 token**（S4、S5 都寫）。計畫的「未核對」可以劃掉。系統提示加標準超過這個長度即可快取；T16 仍用 `cache_read_input_tokens` 驗證。
- Haiku 5.5 價格（S4）：輸入 $0.10、輸出 $0.50、5 分鐘快取寫入 $0.125、讀取 $0.01（提示 ≤ 100,000 token）。Sonnet 5.5（S5）：$2／$10、寫入 $2.50、讀取 $0.10。和 `packages/ai-feedback/src/cost.ts` 一致。
- S4：Haiku 5.5「省略 `temperature`、`top_p`、`top_k`」；S5：Sonnet 5.5 設定它們會 400。和 T4 一致。
