# ClinicMind Practice 階段 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 學生貼上實習報告，經瀏覽器去識別化檢查和伺服器二次檢查後提交；督導按規準評分並發布回饋；過期報告自動刪除。

**Architecture:** 去識別化掃描器是純函式套件 `packages/deid/`，前端和 Edge Function 共用同一份程式碼。學生沒有 `reports` 的 insert 權限；唯一的寫入路徑是 Edge Function `submit-report`，它在寫入前再掃描一次。

**Tech Stack:** 階段 2 的全部，加 Supabase Edge Functions（Deno）、`pg_cron`。

**Spec:** `docs/specs/2026-11-15-practice-system-design.md`（§8、§9、§13 階段 3）

**前置條件：** 階段 2 完成。用戶已回答 spec §14 問題 2（實習單位政策）和問題 3（保存期限）。未回答前可以開發，但 `reports_enabled` 保持關閉。

## 修訂（2026-11-15）：正文存 Google Drive

Spec 新增 §8.5。它改動 Task 3 和 Task 5，執行時以下列為準：

- `reports` 不設 `body` 欄，改設 `drive_file_id text not null`。
- 新增 `supabase/functions/_shared/drive.ts`，介面：`createFile(folderId: string, name: string, text: string): Promise<string>`、`readFile(id: string): Promise<string | null>`（檔案不存在回 null）、`deleteFile(id: string): Promise<void>`（檔案已不存在視為成功）。`handle` 的 `deps` 加入 `drive`，測試用假實作。
- Task 3 的 `handle` 次序在掃描通過後改為：`drive.createFile` → insert 資料庫 → 若 insert 失敗則 `drive.deleteFile` 回滾。
- 新增 Edge Function `get-report`：`handleGet(req: { userId: string; reportId: string }, deps): Promise<{ status: 200; body: string } | { status: 404 } | { status: 410 }>`。以呼叫者身分查 `reports`（RLS 決定看不看得到，看不到回 404）；Drive 檔案不存在回 410。
- 新增 Edge Function `delete-report`，學生和督導刪除報告都經它：先刪 Drive 檔，再刪資料庫列。`reports` 表不設 delete policy。
- Task 5 的清理改由排程呼叫 Edge Function `purge-reports`（逐份刪 Drive 檔和資料庫列），不用純 SQL 函式。
- Task 3 Step 0（新增）：冒煙測試 OAuth `drive.file` 範圍能否建檔、讀檔、刪檔。不行就停下來問用戶。
- 追加測試：`drive write fails → 502, nothing stored`；`db insert fails after drive write → drive file is deleted`；`get-report for another student's report → 404`；`get-report when the Drive file is gone → 410 and the page shows "file no longer exists"`；`delete removes both; a second delete is a no-op`；`refresh token never appears in any response or log`。

## 進度更新（2026-11-15）

- **Task 1 已完成**：`packages/deid/`，142 個測試。執行：`npx vitest run --root packages/deid`（已併入 `npm run check`）。介面比計畫多兩項：`scan(text, { only?, levels? })` 和 `findingKey(f)`。
- 階段 2 覆核後新增了 `supabase/migrations/0003_hardening.sql`。所以本計畫的 migration 檔名順延：`0003_reports.sql` 改為 `0004_reports.sql`，`0004_retention.sql` 改為 `0005_retention.sql`。
- 已知行為：8 位數而且以 2、3、5、6、7、9 開頭的數字（例如某些病歷號）會被 `phone` 規則判為 high。這是刻意從嚴。

- **Task 2 已完成（2026-11-22，分支 `claude/report-compose`，未合併）**：`useDeid`、`FindingsPanel`、`NewReportPage`、`ReportsPage`、`ReportPage`。計畫的 10 個測試都有對應（名稱照計畫），另加標題掃描、檔案拖放、成功和失敗路徑、中文介面、預設隱藏。介面和計畫的差異：(1) 提交經注入的 `ReportSubmitter`，加 `list/get/remove`；(2)「reports_enabled」暫以建置開關 `VITE_REPORTS_ENABLED` 代替，Task 3 再接 cohort；(3) 繁中文字放在新的頂層鍵 `reports`；(4) 步驟 2 的「繼續」按鈕在有未處理命中時停用，最後的「提交」在步驟 3 並需勾選聲明；(5) 標題也掃描。計畫原檔名 `src/i18n/en.ts` 之外還改了 `zh-Hant.ts`。端到端：`e2e/reports.spec.ts`，用第二個建置（埠 4174）。測試：`npm run check` 424＋142；`npm run e2e` 30 過、4 跳過。

## Global Constraints

- 只接受貼上的純文字；不做檔案上傳。
- 掃描前先正規化：Unicode NFKC，移除零寬字元（U+200B–U+200D、U+2060、U+FEFF）。回報的位置對應原始文字。
- 伺服器、日誌、錯誤訊息、`audit_log`、`deid_summary` 都不可含報告正文或命中的文字。
- high 級命中：學生必須改寫，伺服器仍有命中就拒收。
- 報告長度：200 至 30,000 字元。
- `delete_after` ＝ cohort 的 `term_end` ＋ 90 天（待用戶確認）。
- 回饋 `status = 'draft'` 時學生讀不到。
- 介面在提交前明確顯示：`This check can miss things. You are responsible for removing every detail that could identify a client.`
- 階段 1、2 的 Global Constraints 全部仍然適用。

## Review Focus

1. 用全形數字、全形字母或零寬字元繞過規則（例如 `Ａ１２３４５６（７）`）→ 正規化後仍要命中。（Task 1）
2. 識別資料被空格、連字號、換行拆開（`9123 4567`、`A 123456 (7)`）→ 仍要命中。（Task 1）
3. 學生處理完所有命中後又改了文字 → 舊的處理結果作廢，必須重新掃描才可提交。（Task 2）
4. 學生繞過前端，直接對 `reports` 表 insert，或直接呼叫 Edge Function 並偽造 `deid_summary` → 前者被 RLS 拒絕；後者由伺服器重新掃描決定，不信任客戶端的 summary。（Task 3）
5. 貼上 30,000 字元時掃描要在 1 秒內完成，不可卡住頁面；超長輸入給明確訊息。（Task 1、2）

---

### Task 1: 去識別化掃描器

**Files:**
- Create: `packages/deid/src/{index,normalize,rules,lists}.ts`、`packages/deid/package.json`
- Test: `packages/deid/test/{rules,normalize,corpus}.test.ts`、`packages/deid/test/corpus/{positive,negative}.yaml`

**Interfaces:**
- Produces:
  - `type Level = 'high'|'medium'|'low'`
  - `type Finding = { rule: string; level: Level; start: number; end: number; match: string }`（`start`、`end` 是原始文字的 UTF-16 位置）
  - `scan(text: string): Finding[]`（依 `start` 排序；重疊時保留級別較高者，同級保留較長者）
  - `scanHigh(text: string): Finding[]`（只跑 high 級規則，供伺服器使用）
  - `summarize(findings: Finding[], resolutions: Record<string, 'rewritten'|'not-identifying'>): DeidSummary`，`DeidSummary = Record<string, { found: number; rewritten: number; notIdentifying: number }>`
  - `SUGGESTIONS: Record<string, string>`（每個 rule 一句改寫建議）
  - `RULES: { id: string; level: Level }[]`
- 規則清單與級別依 spec §8.3 的表，共 14 條，代碼照抄。
- 不可依賴 DOM 或 Node API（要同時在瀏覽器和 Deno 執行）。

- [ ] **Step 1: 寫失敗的測試**

```ts
// 每條規則至少 4 個正例、4 個反例，放 corpus/*.yaml，格式 { rule, text, expect: [match…] }
test.each(positive)('$rule finds "$text"', ({ rule, text, expect: m }) => {
  expect(scan(text).filter(f => f.rule === rule).map(f => f.match)).toEqual(m);
});
test.each(negative)('$rule ignores "$text"', ({ rule, text }) => {
  expect(scan(text).filter(f => f.rule === rule)).toEqual([]);
});
```

corpus 必須包含這些個案（值照抄）：

| rule | 正例 | 反例 |
|---|---|---|
| `hkid` | `A123456(3)`、`a123456(3)`、`AB987654(3)`、`A 123456 (3)`、`Ａ１２３４５６（３）` | `A123456(4)`（檢查碼錯）、`PHQ123456` |
| `mo-bir` | `1234567(8)`、`5 234 567 (8)` | `2234567(8)`、`12345678` |
| `phone` | `91234567`、`9123 4567`、`+852 9123-4567`、`6612 3456`、`+853 2833 3333` | `12345678`、`2024-2025`、`session 12 of 34567` |
| `email` | `a.b@example.com` | `at 5 @ the clinic` |
| `url` | `https://example.org/x`、`www.example.org` | `e.g.`、`i.e.` |
| `full-date` | `12/03/2026`、`2026-03-12`、`12 March 2026`、`March 12, 2026`、`2026年3月12日` | `Week 3`、`3/10`（量表分數）、`2026` |
| `dob` | `DOB 1998`、`born in 1998`、`生於1998年`、`出生日期：1998` | `born into a large family` |
| `age-90` | `aged 93`、`93-year-old`、`93歲` | `aged 39`、`90%`、`scored 93` |
| `address` | `Flat 3B, Block 2`、`12 Nathan Road`、`彩虹邨`、`3樓B室` | `on the road to recovery`、`block the thought` |
| `institution` | `Queen Mary Hospital`、`鏡湖醫院`、`聖保羅中學`、`St Paul's College` | `a public hospital`、`一間公立醫院`、`school refusal` |
| `title-name` | `Mr Chan`、`Dr. Wong Siu Ming`、`陳先生`、`黃姑娘` | `Mr and Mrs`、`the doctor` |
| `cjk-name` | `陳大文`、`黃小明` | `王牌`、`高興`、`個案A` |
| `cap-name` | `seen by Chan Tai Man today` | `Cognitive Behavioural Therapy`、句首的 `The Client` |
| `id-like` | `MRN 20231234`、`HN1234567` | `2026`、`CBT12` |

```ts
test('findings map back to original offsets after normalization', () => {
  const t = 'ID​：Ａ１２３４５６（３）end';
  const [f] = scan(t).filter(f => f.rule === 'hkid');
  expect(t.slice(f.start, f.end)).toBe('Ａ１２３４５６（３）');
});
test('overlap keeps the higher level', () => { /* 'tel 91234567' 同時像 id-like 和 phone → 只回 phone */ });
test('scanHigh returns only high rules', …);
test('clean fictional report has no high findings', () => { /* corpus/clean-report.txt，約 800 字 */ });
test('30,000 characters scan in under 1000 ms', …);
test('summarize counts per rule and contains no matched text', () => {
  const s = summarize(findings, resolutions);
  expect(JSON.stringify(s)).not.toContain('91234567');
});
test('module has no DOM or Node imports', …);   // 讀原始碼，斷言沒有 'node:'、'document'、'window'
```

- [ ] **Step 2:** `npx vitest run packages/deid` → FAIL
- [ ] **Step 3: 實作。** HKID 檢查碼演算法：字母 A=10…Z=35（單字母時首位補空格值 36），8 個位置的權重 9 至 2，加上檢查碼×1 後總和可被 11 整除；檢查碼 `A` 代表 10。姓氏表取常見 150 個中文姓氏；停用詞表收錄以姓氏字開頭的常用詞（例如「高興」「王牌」「黃色」「陳述」「方法」「溫和」）。
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** commit `feat(deid): scanner with test corpus`

### Task 2: 報告撰寫介面

**Files:**
- Create: `src/routes/reports/{NewReportPage,ReportsPage,ReportPage}.tsx`、`src/reports/useDeid.ts`、`src/components/FindingsPanel.tsx`
- Modify: `src/i18n/en.ts`、`src/App.tsx`
- Test: `src/routes/reports/*.test.tsx`、`src/reports/useDeid.test.ts`

**Interfaces:**
- Consumes: `scan`、`summarize`、`SUGGESTIONS`、`Finding`、`DeidSummary` from Task 1
- Produces: `useDeid(text: string): { findings: Finding[]; resolutions: Record<string, 'rewritten'|'not-identifying'>; resolve(key: string, r: 'not-identifying'): void; unresolved: number; canSubmit: boolean; summary: DeidSummary }`
  - finding 的 key＝`${rule}:${start}:${match}`。文字一變，key 不再存在的 resolution 自動丟棄。
  - high 級不可 `resolve`；只能靠改寫令它消失。改寫後消失的命中計入 `rewritten`。
  - 掃描以 300ms debounce 執行。
  - `canSubmit` ＝ 長度在 200–30,000 之間，且 `unresolved === 0`，且沒有 high 級命中。

四步精靈：(1) 須知＋勾選 → (2) 貼上與處理命中 → (3) 最後確認（顯示全文、聲明勾選）→ (4) 提交結果。

- [ ] **Step 1: 寫失敗的測試**

```tsx
test('step 2 is unreachable until the guidance box is ticked', …);
test('findings are listed with rule label, level and suggestion; clicking one selects it in the text', …);
test('high finding has no "not identifying" button', …);
test('editing the text discards resolutions for findings that changed', async () => {
  /* 標記 'Mr Chan' 為 not-identifying → 把文字改成 'Mr Wong' → unresolved 變回 1 */
});
test('submit stays disabled while any finding is unresolved or text is out of the 200–30,000 range, and says why', …);
test('the "this check can miss things" warning is visible on steps 2 and 3', …);
test('server rejection shows rule names and positions and returns to step 2 with the text intact', …);
test('reports link is hidden when the cohort has reports_enabled = false', …);
test('student can delete own report after a confirm step', …);
test('pasting a file or image is ignored with a message; only text is accepted', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: report compose with de-identification check`

### Task 3: 資料表與 `submit-report`

**Files:**
- Create: `supabase/migrations/0003_reports.sql`、`supabase/functions/submit-report/index.ts`
- Test: `supabase/tests/reports.test.ts`、`supabase/functions/submit-report/handler.test.ts`

**Interfaces:**
- Produces（SQL）：表 `reports`、`feedback`（spec §7）；`cohorts.reports_enabled boolean default false`；`reports.status` ∈ `submitted|reviewed`。
  - RLS：student 可 select、delete 自己的報告，**沒有 insert、update policy**。supervisor 可 select、delete 本班報告。`feedback`：supervisor 可 insert、update、select 本班；student 只可 select `status='released'` 且屬於自己報告的列。
- Produces: `handle(req: { userId: string; title: string; body: string }, deps: { db: Db; now: () => Date }): Promise<{ status: 201; id: string } | { status: 422; findings: { rule: string; start: number; end: number }[] } | { status: 400|403|413; error: string }>`
  - 次序：驗證登入 → 讀 profile 和 cohort → `reports_enabled` 為 false 回 403 → 長度檢查（413 或 400）→ `scanHigh(body)` → 有命中回 422（不含 `match`）→ 伺服器自行 `scan` 算出 `deid_summary`（忽略客戶端傳來的）→ 以 service role insert，`delete_after = term_end + 90 天`。
  - 每名學生每 24 小時最多 5 次成功提交。
  - `index.ts` 只做 HTTP 包裝；不 `console.log` 任何請求內容。

- [ ] **Step 1: 寫失敗的測試**

```ts
test('student cannot insert into reports directly', () => expectDenied(as(A), `insert into reports …`));
test('student reads own reports only; supervisor reads own cohort only', …);
test('draft feedback is invisible to the student; released is visible', …);
test('student cannot read feedback on another student report even if released', …);
test('handler stores a clean report with server-computed summary and delete_after', async () => {
  const r = await handle({ userId: A, title: 'Wk3', body: CLEAN }, deps);
  expect(r.status).toBe(201);
  expect(await col('reports', 'delete_after', r.id)).toBe('2027-04-01');   // term_end 2027-01-01 + 90 天
});
test('handler rejects high findings with rule and offsets only', async () => {
  const r = await handle({ userId: A, title: 't', body: CLEAN + ' call 91234567' }, deps);
  expect(r).toMatchObject({ status: 422, findings: [{ rule: 'phone' }] });
  expect(JSON.stringify(r)).not.toContain('91234567');
  expect(await count('reports')).toBe(0);
});
test('handler ignores a client-supplied deid_summary', …);
test('403 when reports are disabled for the cohort', …);
test('413 over 30,000 chars; 400 under 200', …);
test('6th submission in 24 hours is refused', …);
test('nothing from the body reaches the logger', async () => { /* 注入 logger spy，跑成功和失敗各一次，斷言所有參數不含 body 的任何 20 字元片段 */ });
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: report storage and server-side re-check`

### Task 4: 規準與督導評閱

**Files:**
- Create: `content/en/rubrics/report.yaml`、`src/content/rubric.ts`、`src/routes/supervisor/ReportReviewPage.tsx`、`src/components/RubricForm.tsx`
- Modify: `scripts/build-content.ts`、`src/routes/reports/ReportPage.tsx`
- Test: 對應的 `*.test.ts(x)`

**Interfaces:**
- Produces: `Rubric = { dimensions: { code: string; title: string; levels: [string,string,string,string] }[] }`；六個向度代碼依 spec §9：`picture`、`formulation`、`link`、`process`、`self`、`ethics`。
- Produces: `FeedbackInput = { scores: Record<string, 1|2|3|4>; comments: string }`；`saveFeedback(reportId: string, input: FeedbackInput, release: boolean): Promise<void>`
- `report.yaml` 的四級描述由執行者起草，交用戶審核；未審核時督導介面顯示 `Rubric not yet reviewed`。

- [ ] **Step 1: 寫失敗的測試**

```tsx
test('rubric build fails unless there are exactly 6 dimensions with 4 level descriptors each', …);
test('supervisor can save a draft with some dimensions blank', …);
test('release requires all 6 scores and a non-blank comment', …);
test('released feedback shows on the student report page with dimension titles and level descriptors', …);
test('draft feedback does not show on the student page', …);
test('releasing sets report status to reviewed and writes an audit row without body text', …);
test('supervisor delete asks for confirmation, removes report and feedback, and writes an audit row', …);
test('supervisor report list shows deid_summary counts so heavily flagged reports stand out', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: rubric and supervisor review`

### Task 5: 保存期限

**Files:**
- Create: `supabase/migrations/0004_retention.sql`
- Test: `supabase/tests/retention.test.ts`

**Interfaces:**
- Produces: `function purge_expired_reports(today date default current_date) returns integer`（刪除 `delete_after < today` 的報告，`feedback` 以 `on delete cascade` 一併刪除，每份寫一筆 `audit_log`，回傳刪除數）；`pg_cron` 每日 03:00 UTC 執行。
- 修改 cohort 的 `term_end` 時，trigger 同步更新該 cohort 所有報告的 `delete_after`。

- [ ] **Step 1: 寫失敗的測試**

```ts
test('purges only reports past delete_after, with their feedback', async () => {
  expect(await call('purge_expired_reports', ['2027-04-02'])).toBe(1);
  expect(await count('feedback')).toBe(/* 只剩未過期報告的回饋 */ 1);
});
test('report expiring today is kept until tomorrow', …);
test('audit row is written per purged report, without title or body', …);
test('changing term_end moves delete_after for that cohort only', …);
test('function is not callable by authenticated or anon', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: report retention`

### Task 6: 端到端

**Files:** `e2e/reports.spec.ts`

- [ ] **Step 1: 寫測試**

```ts
test('report with a phone number cannot be submitted from the UI', …);
test('same text posted straight to the function is refused and nothing is stored', …);
test('clean report: student submits → supervisor scores and releases → student sees feedback', …);
test('student B cannot open student A report by URL', …);
test('no request body or response in the whole flow contains the matched identifier after rejection', …);
```

- [ ] **Step 2:** `npx playwright test --trace off` → PASS；`npm run check` 全過
- [ ] **Step 3:** commit。對學生開放前，用戶要：確認實習單位政策、審核規準、在測試 cohort 親自走一次、然後才把該 cohort 的 `reports_enabled` 設為 true。

## Self-Review 紀錄

- Spec §8.1–8.5 → Task 1、2、3、5；§9 → Task 4；§13 階段 3 驗收 → Task 6。
- Spec §10（AI 回饋）不在本計畫。`feedback.author_id` 可為 null，已為階段 4 預留。
- 已知限制，須在介面和給用戶的說明中保留：姓名偵測（`cjk-name`、`cap-name`）誤報和漏報都會偏高；不常見姓氏、只寫名不寫姓、外號、罕見機構名都可能漏掉。這正是保留學生聲明、督導刪除和保存期限的原因。
