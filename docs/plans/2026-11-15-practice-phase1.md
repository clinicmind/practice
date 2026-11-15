# ClinicMind Practice 階段 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 學生不用登入，就能完成 `intake` 和 `alliance` 兩個模組的走讀、三級練習和反思，進度存在本機。

**Architecture:** 靜態 React 應用。內容是 YAML，建置時驗證並打包成 JSON；示範回應獨立成檔，提交後才載入。進度經 `ProgressStore` 介面讀寫，本階段實作 `LocalStore`。過關和解鎖是純函式。

**Tech Stack:** Vite、React 18、TypeScript strict、react-router v6、zod、yaml、vitest、@testing-library/react、Playwright（環境預裝）。

**Spec:** `docs/specs/2026-11-15-practice-system-design.md`（本計畫實作 §3、§4 的模組 1–2、§5、§6.1、§11 的學生路由、§13 階段 1）

**Repo:** 新 repo（建議 `clinicmind/practice`，由用戶建立）。把 spec 複製到新 repo 的 `docs/specs/`。

## Global Constraints

- 示範回應在該題有提交之前不得載入（spec §3.1）。
- 達標：最新一次嘗試勾選 ≥2 條標準，且 `response.trim().length >= 20`。過關：一級 10 題中 ≥8 題達標。
- 解鎖：easy 預設開；medium 需 easy 過關；hard 需 medium 過關。模組 N+1 的走讀需模組 N 的走讀全部決策點已作答。
- 每頁頁尾固定文字：`Training tool. Not for use with clients in crisis. If someone is at risk, follow your placement's policy and contact your supervisor.`
- UI 字串全部放 `src/i18n/en.ts`，元件內不寫死英文句子。
- 最窄寬度 360px；全鍵盤可操作；表單欄位有 label。
- 內容原創、個案虛構；模組內容上線前由用戶審核。
- localStorage 鍵：`cm.practice.v1`。
- 不加入 spec §15 列為不做的功能。

## Review Focus

1. localStorage 內容損毀或格式過舊 → 應用不可白屏；把原字串備份到 `cm.practice.v1.corrupt`，以空進度啟動，並顯示一次通知。（Task 2）
2. 回應只有空白或少於 20 字元 → 不算達標；空白時提交鈕停用。（Task 2、3）
3. 直接輸入已鎖級別或模組的網址 → 轉回模組首頁並顯示原因，不可空白頁。（Task 5）
4. 提交前不可請求 `models.json`（端到端測試以網路請求紀錄證明）。（Task 3、7）
5. 兩個分頁同時作答 → 後寫的不可覆蓋先寫的；`LocalStore` 每次寫入前重新讀取。（Task 2）

---

### Task 1: 骨架、內容 schema 與打包

**Files:**
- Create: `package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`、`src/main.tsx`、`.github/workflows/ci.yml`（`npm ci && npm run check`）
- Create: `src/content/schema.ts`、`scripts/build-content.ts`、`content/REVIEW.md`
- Test: `src/content/schema.test.ts`、`scripts/build-content.test.ts`、`tests/fixtures/content/**`

**Interfaces:**
- Produces（`src/content/schema.ts`，全部同時匯出 zod schema 和推導型別）：
  - `Level = 'easy'|'medium'|'hard'`；`LEVELS: Level[]`
  - `Drill = { id: string; level: Level; skill: string; context: string; client: string; criteria: [string,string,string] }`
  - `Model = { model_response: string; why: string; avoid: string }`
  - `Turn = { id: string; speaker: 'therapist'|'client'; text: string }`
  - `Option = { id: string; text: string; fit: 'strong'|'workable'|'weak'; note: string }`
  - `DecisionPoint = { id: string; type: 'choice'|'free'; prompt: string; options?: Option[]; actual: string; rationale: string }`
  - `Session = { id: string; title: string; turns: (Turn|DecisionPoint)[]; notes: { goals: string; alliance: string; formulation_update: string } }`
  - `ModuleMeta = { slug: string; title: string; intro: string; skills: [string,string]; reflection_prompts: { id: string; text: string }[] }`
  - `ModuleBundle = { meta: ModuleMeta; sessions: Session[]; drills: Drill[] }`
  - `StageIndex = { stage: string; title: string; modules: { slug: string; title: string; reviewed: boolean }[] }`
  - `isDecision(t: Turn|DecisionPoint): t is DecisionPoint`
- Produces（`scripts/build-content.ts`）：`buildContent(opts: { contentDir: string; outDir: string; locale: 'en' }): Promise<void>`，寫出 `<outDir>/en/foundations/index.json`、`<slug>/module.json`（`ModuleBundle`）、`<slug>/models.json`（`Record<string, Model>`）。npm script：`"content": "tsx scripts/build-content.ts"`；`"check": "npm run content && tsc --noEmit && vitest run"`；`dev` 和 `build` 都先跑 `content`。

- [ ] **Step 1: 寫失敗的測試**

```ts
test('valid fixture builds three kinds of file', async () => {
  await buildContent({ contentDir: fx('ok'), outDir, locale: 'en' });
  const idx = readJson('en/foundations/index.json');
  expect(idx.modules.map(m => m.slug)).toEqual(['intake', 'alliance']);
  const mod = readJson('en/foundations/intake/module.json');
  expect(mod.drills).toHaveLength(30);
  expect(JSON.stringify(mod)).not.toContain('model_response');
  expect(Object.keys(readJson('en/foundations/intake/models.json'))).toHaveLength(30);
});
test.each([
  ['nine-easy',        /intake: easy: expected 10 drills, got 9/],
  ['skill-uneven',     /intake: skill "restatement" at level easy: expected 5, got 4/],
  ['model-missing',    /models\.yaml: no entry for "intake-m03"/],
  ['model-extra',      /models\.yaml: "intake-x99" has no drill/],
  ['dup-id',           /duplicate id "intake-e01"/],
  ['bad-drill-id',     /id "alliance-e01" does not belong to module "intake"/],
  ['two-options',      /decision "d1": expected 3 options, got 2/],
  ['no-strong',        /decision "d1": needs at least one option with fit "strong"/],
  ['no-decision',      /session "intake-s1": needs at least one decision point/],
  ['two-criteria',     /criteria/],
  ['unknown-skill',    /skill "small-talk" is not one of the module skills/],
])('invalid fixture %s fails with a clear message', async (name, re) => {
  await expect(buildContent({ contentDir: fx(name), outDir, locale: 'en' })).rejects.toThrow(re);
});
test('reviewed flag comes from REVIEW.md with exact version match', async () => { /* intake 已登記 → true；alliance 未登記 → false */ });
```

`module.yaml` 多一個欄位 `version`（semver）；`REVIEW.md` 表格欄 `| slug | locale | version | reviewed_on |`。

- [ ] **Step 2:** `npx vitest run scripts src/content` → FAIL
- [ ] **Step 3: 實作 schema 和 `buildContent`**。每個失敗夾具由 `ok` 夾具複製後改一處；寫一個測試輔助函式產生，避免手抄 30 題。
- [ ] **Step 4:** → PASS
- [ ] **Step 5:** commit `feat: content schema and build`

### Task 2: 進度邏輯與 LocalStore

**Files:**
- Create: `src/progress/types.ts`、`src/progress/rules.ts`、`src/progress/localStore.ts`
- Test: `src/progress/rules.test.ts`、`src/progress/localStore.test.ts`

**Interfaces:**
- Consumes: `Drill`、`Level`、`Session`、`isDecision` from Task 1
- Produces（`types.ts`）：spec §6.1 的 `ProgressStore`、`Attempt`、`NewAttempt`、`Decision`、`NewDecision`、`Reflection`、`NewReflection`，原樣照抄。
- Produces（`rules.ts`）：
  - `MIN_RESPONSE = 20`
  - `itemMet(attempts: Attempt[], itemId: string): boolean`
  - `levelPassed(attempts: Attempt[], drills: Drill[], level: Level): boolean`
  - `unlockedLevels(attempts: Attempt[], drills: Drill[]): Level[]`
  - `walkthroughDone(decisions: Decision[], sessions: Session[]): boolean`
  - `unlockedModules(decisions: Decision[], modules: { slug: string; sessions: Session[] }[]): string[]`（依陣列次序；第一個永遠解鎖）
- Produces（`localStore.ts`）：`createLocalStore(storage?: Storage): ProgressStore & { wasReset: boolean }`

- [ ] **Step 1: 寫失敗的測試**

```ts
// rules
test('item met needs 2 of 3 criteria on the latest attempt', () => {
  expect(itemMet([att('a', [true, true, false])], 'a')).toBe(true);
  expect(itemMet([att('a', [true, false, false])], 'a')).toBe(false);
  expect(itemMet([att('a', [true, true, true], t1), att('a', [true, false, false], t2)], 'a')).toBe(false); // 以最新為準
});
test('short or blank response is never met', () => {
  expect(itemMet([att('a', [true, true, true], t1, '   ')], 'a')).toBe(false);
  expect(itemMet([att('a', [true, true, true], t1, 'x'.repeat(19))], 'a')).toBe(false);
  expect(itemMet([att('a', [true, true, true], t1, '  ' + 'x'.repeat(20) + '  ')], 'a')).toBe(true);
});
test('level passes at 8 of 10', () => { /* 7 題達標 → false；8 題 → true */ });
test('levels unlock in order', () => {
  expect(unlockedLevels([], drills)).toEqual(['easy']);
  expect(unlockedLevels(pass('easy'), drills)).toEqual(['easy', 'medium']);
  expect(unlockedLevels([...pass('easy'), ...pass('medium')], drills)).toEqual(['easy', 'medium', 'hard']);
  expect(unlockedLevels(pass('medium'), drills)).toEqual(['easy']);          // 跳級不算
});
test('walkthrough done needs every decision point answered', () => { /* 少一個 → false */ });
test('modules unlock one at a time', () => {
  expect(unlockedModules([], mods)).toEqual(['intake']);
  expect(unlockedModules(allDecisions('intake'), mods)).toEqual(['intake', 'alliance']);
});
// localStore
test('attempts are appended, never replaced', async () => { /* 同一 itemId 存兩次 → listAttempts 長度 2，id 不同，createdAt 遞增 */ });
test('survives reload', async () => { /* 新建 store 指向同一 storage → 讀得到 */ });
test('corrupt JSON is backed up and store starts empty', async () => {
  storage.setItem('cm.practice.v1', '{not json');
  const s = createLocalStore(storage);
  expect(s.wasReset).toBe(true);
  expect(storage.getItem('cm.practice.v1.corrupt')).toBe('{not json');
  expect(await s.listAttempts()).toEqual([]);
});
test('wrong shape is treated as corrupt', async () => { /* '{"attempts":"nope"}' → 同上 */ });
test('writes from two store instances do not clobber each other', async () => {
  const a = createLocalStore(storage), b = createLocalStore(storage);
  await a.saveAttempt(n('x')); await b.saveAttempt(n('y'));
  expect((await a.listAttempts()).map(t => t.itemId).sort()).toEqual(['x', 'y']);
});
test('criteriaMet must have length 3', async () => { await expect(s.saveAttempt({ itemId: 'a', response: 'r', criteriaMet: [true] })).rejects.toThrow(); });
test('storage quota error surfaces as a rejected promise, not a silent loss', async () => { /* setItem 丟 QuotaExceededError → saveAttempt rejects */ });
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS（`npx vitest run src/progress`）
- [ ] **Step 5:** commit `feat: progress rules and local store`

### Task 3: 練習介面

**Files:**
- Create: `src/content/client.ts`、`src/routes/DrillsPage.tsx`、`src/components/DrillCard.tsx`、`src/i18n/en.ts`、`src/StoreContext.tsx`
- Test: `src/components/DrillCard.test.tsx`、`src/content/client.test.ts`

**Interfaces:**
- Consumes: `ProgressStore`、rules、`ModuleBundle`、`Model`
- Produces（`client.ts`）：`loadStage(): Promise<StageIndex>`、`loadModule(slug: string): Promise<ModuleBundle>`、`loadModels(slug: string): Promise<Record<string, Model>>`。三者都快取；fetch 失敗丟 `ContentLoadError`。
- Produces：`<DrillCard drill={Drill} attempts={Attempt[]} onSubmit={(a: NewAttempt) => Promise<void>} getModel={() => Promise<Model>} />`
- Produces：`useStore(): ProgressStore`（`StoreContext`）

DrillCard 狀態機：`writing` →（提交）→ `rating`（顯示 3 個勾選框）→（儲存）→ `review`（此時才呼叫 `getModel`，顯示示範回應、why、avoid 和「再試一次」「下一題」）。

- [ ] **Step 1: 寫失敗的測試**

```tsx
test('submit is disabled until the response has non-blank text', …);
test('getModel is not called before an attempt is saved', async () => {
  render(<DrillCard … getModel={getModel} />);
  await user.type(textbox, 'A response that is long enough.');
  expect(getModel).not.toHaveBeenCalled();
  await user.click(submit); await user.click(criterion1); await user.click(save);
  expect(onSubmit).toHaveBeenCalledWith({ itemId: 'intake-e01', response: 'A response that is long enough.', criteriaMet: [true, false, false] });
  expect(getModel).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(model.model_response)).toBeVisible();
});
test('shows a hint when fewer than 2 criteria are ticked or the response is under 20 characters', …);
test('retry clears the text box and keeps earlier attempts listed', …);
test('if saving fails the typed response stays in the box and an error is shown', …);
test('if the model fails to load, a retry button is shown and the attempt is still saved', …);
test('every input has an accessible name', …);   // getByRole('textbox', { name: /your response/i }) 等
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: drill practice UI`

### Task 4: 走讀介面

**Files:**
- Create: `src/routes/WalkthroughPage.tsx`、`src/components/DecisionPointView.tsx`
- Test: `src/routes/WalkthroughPage.test.tsx`

**Interfaces:**
- Consumes: `Session`、`DecisionPoint`、`ProgressStore.saveDecision/listDecisions`

行為：輪次逐段顯示到下一個未作答的決策點為止。作答後顯示該選項的 `fit` 標籤和 `note`（choice），再顯示 `actual` 和 `rationale`，然後繼續。全部作答後顯示會談筆記。已作答的決策點重新進入時直接顯示結果，不可改答。

- [ ] **Step 1: 寫失敗的測試**

```tsx
test('turns after an unanswered decision point are not in the DOM', …);
test('choosing an option saves { sessionId, decisionId, optionId } and reveals fit, note, actual, rationale', …);
test('free decision requires non-blank text, saves { response }, then reveals actual and rationale', …);
test('fit is shown as a text label ("Strong fit" / "Workable" / "Weak fit"), not colour alone', …);
test('session notes appear only after the last decision is answered', …);
test('returning to a finished session shows everything and no submit controls', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: walkthrough UI`

### Task 5: 模組首頁、階段總覽、反思、路由守衛

**Files:**
- Create: `src/App.tsx`、`src/routes/StagePage.tsx`、`src/routes/ModulePage.tsx`、`src/routes/ReflectPage.tsx`、`src/routes/NotFound.tsx`、`src/components/Layout.tsx`、`src/styles.css`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: Task 1–4 全部
- Produces: 路由 `/`、`/m/:slug`、`/m/:slug/walkthrough/:sessionId`、`/m/:slug/drills/:level`、`/m/:slug/reflect`、`*`

- [ ] **Step 1: 寫失敗的測試**

```tsx
test('stage page lists modules; locked ones are marked and not links', …);
test('module page shows per-level progress as "n / 10 met" and lock state', …);
test('deep link to a locked level redirects to the module page with the reason', async () => {
  renderAt('/m/intake/drills/hard');
  expect(await screen.findByText(/pass medium first/i)).toBeVisible();
  expect(location.pathname).toBe('/m/intake');
});
test('deep link to a locked module redirects to / with the reason', …);
test('unknown slug, level or session shows the not-found page', …);
test('unreviewed module is hidden from the stage page', …);
test('reflection saves text per prompt and lists earlier entries newest first', …);
test('footer safety line is on every route', …);
test('a one-time notice is shown when the local store was reset', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS；`npm run check` 全過
- [ ] **Step 5:** commit `feat: navigation, guards and reflection`

### Task 6: 內容：Client M 與模組 1–2

**Files:**
- Create: `content/en/stages/foundations/stage.yaml`、`content/CLIENT_M.md`（個案設定：背景、主訴、5P、8 階段的弧線；不對學生顯示）
- Create: `content/en/stages/foundations/{intake,alliance}/{module,walkthrough,drills,models}.yaml`

- [ ] **Step 1:** 寫 `CLIENT_M.md`，交用戶確認（spec §14 問題 4）後才寫走讀
- [ ] **Step 2:** 寫 `intake` 四個檔；`npm run content` exit 0
- [ ] **Step 3:** 寫 `alliance` 四個檔；`npm run content` exit 0
- [ ] **Step 4:** 每個模組一個 commit；交用戶審核，審核後在 `REVIEW.md` 登記

### Task 7: 端到端測試與部署設定

**Files:**
- Create: `playwright.config.ts`、`e2e/student-journey.spec.ts`、`public/_headers`、`public/_redirects`（`/* /index.html 200`）

- [ ] **Step 1: 寫端到端測試**（對 `vite preview`，用 `ok` 夾具內容）

```ts
test('student completes easy level and unlocks medium', async ({ page }) => { /* 做 8 題達標 → medium 連結可點 */ });
test('models.json is never requested before the first submit', async ({ page }) => {
  const hits: string[] = []; page.on('request', r => r.url().includes('models.json') && hits.push(r.url()));
  await page.goto('/m/intake/drills/easy'); await page.getByRole('textbox').fill('A response that is long enough.');
  expect(hits).toHaveLength(0);
  /* 提交並儲存 */ expect(hits).toHaveLength(1);
});
test('progress survives a reload', …);
test('usable at 360px wide: no horizontal scroll on stage, module, drill, walkthrough pages', …);
test('whole drill can be done with the keyboard only', …);
```

- [ ] **Step 2:** `npx playwright test --trace off` → PASS
- [ ] **Step 3:** `public/_headers` 設 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'`
- [ ] **Step 4:** commit `test: e2e student journey; chore: deploy config`
- [ ] **Step 5:** 部署到 Cloudflare Pages 要用戶批准並由用戶連結帳號

## Self-Review 紀錄

- Spec §3.1–3.3 → Task 2、3、4；§5 → Task 1、6；§6.1 → Task 2；§11 學生路由 → Task 5；§13 階段 1 驗收 → Task 7。
- 已知取捨：走讀的 `actual`、`rationale`、選項 `note` 與題目同檔載入（只有示範回應分檔）。走讀是教學展示，不是測驗，所以可接受。
