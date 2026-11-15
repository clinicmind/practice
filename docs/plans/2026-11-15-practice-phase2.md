# ClinicMind Practice 階段 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 學生用邀請碼加入、登入後進度跨裝置同步；督導看到本班進度和作答；8 個模組齊備。

**Architecture:** Supabase 提供 Auth 和 Postgres。所有授權由 Row Level Security 決定，前端不做授權判斷。`SupabaseStore` 實作階段 1 的 `ProgressStore`，介面不變。督導後台是同一個前端的 `/supervisor` 路由。

**Tech Stack:** 階段 1 的全部，加 `@supabase/supabase-js`、Supabase CLI（migrations）、`@electric-sql/pglite`（RLS 測試用的行程內 Postgres）。

**Spec:** `docs/specs/2026-11-15-practice-system-design.md`（§2、§3.2 的手動解鎖、§6.1、§7、§11 的 `/join`、`/login`、`/supervisor*`、§13 階段 2）

**前置條件：** 階段 1 完成。用戶已建 Supabase 專案（區域新加坡）並把 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 設到部署環境。service role 金鑰不進 repo、不進前端。

## Global Constraints

- 每張表都啟用 RLS。沒有 policy 就沒有存取。
- `attempts`、`decisions`、`reflections` 只可 insert 和 select，沒有 update、delete policy。
- 學生不可改自己的 `role` 和 `cohort_id`。這兩欄只能由 security definer 函式寫入。
- 登入方式：電郵一次性連結（magic link）。不存密碼。
- 學生的 `display_name` 自訂，可用化名。介面在輸入欄旁說明這一點。
- 前端不出現 service role 金鑰；CI 用 `grep` 檢查 `dist/` 不含 `service_role`。
- 未設定 Supabase 環境變數時，應用退回階段 1 的 LocalStore 模式（方便本機開發和示範）。
- 階段 1 的 Global Constraints 全部仍然適用。

## Review Focus

1. 學生用 API 直接 `update profiles set role='supervisor'` → 必須被拒。（Task 1）
2. 邀請碼：錯誤、已過期（cohort 的 `term_end` 已過）、重複加入、暴力猜測 → 各有明確結果；`join_cohort` 每個帳號每小時最多 10 次失敗。（Task 1、2）
3. 儲存作答時斷網 → 文字留在輸入框，顯示重試，不可靜默遺失。（Task 3）
4. 本機進度匯入雲端執行兩次（例如中途重新整理）→ 不可產生重複紀錄。（Task 3）
5. 作答中途登入逾時 → 提示重新登入，登入後回到同一題，輸入的文字仍在。（Task 3）

---

### Task 1: Schema、RLS 與資料庫測試

**Files:**
- Create: `supabase/migrations/0001_core.sql`、`supabase/tests/harness.ts`、`supabase/tests/rls.test.ts`

**Interfaces:**
- Produces（SQL）：表 `cohorts`、`profiles`、`attempts`、`decisions`、`reflections`、`unlocks`、`audit_log`，欄位依 spec §7。另加：
  - `attempts.client_id uuid not null`，`unique (user_id, client_id)`；`decisions`、`reflections` 同樣。這是匯入冪等的依據。
  - `join_attempts(user_id, created_at, ok boolean)`
  - `function join_cohort(code text, display_name text) returns uuid`（security definer；成功時建立或更新呼叫者的 profile 為 student 並回傳 cohort id；失敗丟 `invalid_code`、`cohort_closed`、`rate_limited`）
  - `function create_cohort(name text, term_end date) returns table(id uuid, invite_code text)`（security definer；只限 `role = 'supervisor'`；邀請碼 10 個字元，字集不含 `0O1Il`）
  - `function is_supervisor_of(student uuid) returns boolean`（stable、security definer；policy 用它避免 RLS 遞迴）
- Produces（`harness.ts`）：`createDb(): Promise<{ as(userId: string | null): Client; admin: Client; close(): Promise<void> }>`。以 pglite 建庫，建立 `auth` schema 和 `auth.uid()`（讀 `current_setting('request.jwt.claim.sub', true)`），建立 `authenticated`、`anon` 角色，套用 migrations。`as(id)` 回傳的 client 每次查詢前 `set local role authenticated` 並設定 claim。

- [ ] **Step 1:** 先寫一個冒煙測試確認 pglite 支援 `create role`、`set role` 和 RLS。若不支援，改用 CI 的 Postgres service container，並在本計畫記下改動；`harness.ts` 的介面不變。
- [ ] **Step 2: 寫失敗的測試**

```ts
// 夾具：supervisor S1 帶 cohort C1（學生 A、B）；supervisor S2 帶 cohort C2（學生 X）
test('student reads only own attempts', async () => {
  expect(await rows(as(A), 'select user_id from attempts')).toEqual([{ user_id: A }]);
});
test('student cannot insert an attempt for someone else', () => expectDenied(as(A), insertAttempt({ user_id: B })));
test('student cannot update or delete attempts', async () => { /* update、delete 影響 0 列 */ });
test('student cannot change own role or cohort', async () => {
  await as(A).query(`update profiles set role='supervisor' where id=$1`, [A]).catch(() => {});
  expect(await roleOf(A)).toBe('student');
  await as(A).query(`update profiles set cohort_id=$1 where id=$2`, [C2, A]).catch(() => {});
  expect(await cohortOf(A)).toBe(C1);
});
test('student can change own display_name', …);
test('supervisor reads own cohort only', async () => {
  expect(new Set((await rows(as(S1), 'select user_id from attempts')).map(r => r.user_id))).toEqual(new Set([A, B]));
});
test('supervisor of another cohort reads nothing of A', async () => {
  for (const t of ['attempts', 'decisions', 'reflections', 'profiles']) expect(await rows(as(S2), `select * from ${t} where ${t === 'profiles' ? 'id' : 'user_id'}=$1`, [A])).toEqual([]);
});
test('supervisor cannot write student attempts', …);
test('anon reads nothing from any table', …);
test('unlocks: supervisor grants for own student only; student reads own; student cannot insert', …);
test('join_cohort: valid code creates a student profile', …);
test('join_cohort: wrong code raises invalid_code', …);
test('join_cohort: past term_end raises cohort_closed', …);
test('join_cohort: joining twice is a no-op and keeps the first cohort', …);
test('join_cohort: 11th failure within an hour raises rate_limited', …);
test('join_cohort: a supervisor calling it stays a supervisor', …);
test('create_cohort: denied for students; code is 10 chars from the allowed set and unique', …);
test('same client_id inserted twice yields one row', async () => { /* 第二次 insert … on conflict do nothing */ });
test('every public table has RLS enabled', async () => {
  expect(await rows(admin, `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`)).toEqual([]);
});
```

- [ ] **Step 3:** `npx vitest run supabase/tests` → FAIL
- [ ] **Step 4: 寫 `0001_core.sql`**
- [ ] **Step 5:** → PASS；commit `feat(db): core schema with row level security`

### Task 2: 登入與加入

**Files:**
- Create: `src/auth/supabase.ts`、`src/auth/AuthContext.tsx`、`src/routes/LoginPage.tsx`、`src/routes/JoinPage.tsx`、`src/routes/AuthCallback.tsx`
- Modify: `src/App.tsx`（路由守衛）、`src/i18n/en.ts`
- Test: `src/auth/*.test.tsx`

**Interfaces:**
- Produces: `getSupabase(): SupabaseClient | null`（環境變數缺少時回傳 null）
- Produces: `useAuth(): { status: 'loading'|'local'|'signedOut'|'needsCohort'|'student'|'supervisor'; profile?: Profile; signIn(email: string): Promise<void>; signOut(): Promise<void>; join(code: string, displayName: string): Promise<void> }`，`Profile = { id: string; role: 'student'|'supervisor'; displayName: string; cohortId: string | null }`
- `status = 'local'` 表示沒有 Supabase 設定，應用照階段 1 運作。

- [ ] **Step 1: 寫失敗的測試**（以假的 Supabase client 注入）

```tsx
test('signed-out user is sent to /login from any app route, and back after sign-in', …);
test('signed-in user without a profile is sent to /join', …);
test('join shows a specific message for invalid_code, cohort_closed and rate_limited', …);
test('display name field explains that a pseudonym is fine; 1–40 chars; trimmed', …);
test('student opening /supervisor sees the not-found page', …);
test('supervisor lands on /supervisor after sign-in', …);
test('sign-in form shows "check your email" and does not reveal whether the address is registered', …);
test('without Supabase env the app runs in local mode with no login screen', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: sign-in and cohort join`

### Task 3: SupabaseStore 與本機進度匯入

**Files:**
- Create: `src/progress/supabaseStore.ts`、`src/progress/importLocal.ts`
- Modify: `src/StoreContext.tsx`、`src/progress/localStore.ts`（每筆紀錄的 `id` 改用 `crypto.randomUUID()`，作為 `client_id`）
- Test: `src/progress/supabaseStore.test.ts`、`src/progress/importLocal.test.ts`

**Interfaces:**
- Consumes: `ProgressStore` 型別（階段 1）、`getSupabase()`
- Produces: `createSupabaseStore(client: SupabaseClient, userId: string): ProgressStore`。`saveAttempt` 以自產的 uuid 作 `client_id`，用 upsert `ignoreDuplicates`。網路或授權錯誤丟 `StoreError`，`kind: 'network'|'auth'|'other'`。
- Produces: `importLocal(local: ProgressStore, remote: ProgressStore, storage: Storage): Promise<{ attempts: number; decisions: number; reflections: number }>`。全部成功後才清除 `cm.practice.v1`；任何一筆失敗就保留本機資料並丟錯。
- `DrillCard` 已在階段 1 處理 `onSubmit` 失敗時保留文字；本任務加上 `kind: 'auth'` 時把草稿存到 `sessionStorage['cm.draft.<itemId>']`，重新登入後還原。

- [ ] **Step 1: 寫失敗的測試**

```ts
test('store methods map rows to the ProgressStore types (snake_case → camelCase)', …);
test('network failure rejects with StoreError kind "network"', …);
test('401 rejects with StoreError kind "auth"', …);
test('import copies everything, then clears local', …);
test('import run twice creates no duplicates', async () => {
  await importLocal(local, remote, storage).catch(() => {});   // 第一次在第 3 筆失敗
  restoreNetwork(); await importLocal(local, remote, storage);
  expect(await remote.listAttempts()).toHaveLength(5);
});
test('failed import keeps local data intact', …);
test('draft is restored after re-login and removed after a successful save', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: cloud progress store and local import`

### Task 4: 督導後台

**Files:**
- Create: `supabase/migrations/0002_supervisor_views.sql`、`src/supervisor/api.ts`、`src/routes/supervisor/{CohortPage,StudentPage}.tsx`、`src/supervisor/flags.ts`
- Test: `supabase/tests/supervisor.test.ts`、`src/supervisor/flags.test.ts`、`src/routes/supervisor/*.test.tsx`

**Interfaces:**
- Produces（`flags.ts`）：`flagAttempts(attempts: Attempt[]): { attemptId: string; reason: 'all-met-but-short'|'identical-to-previous'|'copied-model' }[]`
  - `all-met-but-short`：三條全勾且 `response.trim().length < 40`
  - `identical-to-previous`：同一學生同一題連續兩次回應完全相同
  - `copied-model`：回應與該題示範回應的正規化文字（小寫、去標點、併空白）相同
- Produces（`api.ts`）：`listStudents(): Promise<StudentSummary[]>`、`getStudent(id: string): Promise<StudentDetail>`、`grantUnlock(studentId: string, moduleSlug: string, level: Level): Promise<void>`、`createCohort(name: string, termEnd: string): Promise<{ id: string; inviteCode: string }>`
  - `StudentSummary = { id: string; displayName: string; lastActiveAt: string | null; modules: Record<string, { walkthroughDone: boolean; passed: Level[] }> }`
- 階段 1 的 `unlockedLevels` 加第三個可選參數 `granted: Level[]`，併入結果。

- [ ] **Step 1: 寫失敗的測試**

```ts
test.each([
  [[att({ met: [1,1,1], response: 'ok fine' })], 'all-met-but-short'],
  [[att({ response: R }), att({ response: R })], 'identical-to-previous'],
  [[att({ response: '  ' + MODEL.toUpperCase() + '!! ' })], 'copied-model'],
])('flags %#', …);
test('an honest 60-character attempt with 2 criteria is not flagged', …);
test('cohort page shows one row per student with per-module progress and last active date', …);
test('cohort page shows the invite code and a copy button; code is not shown to students', …);
test('student page lists attempts newest first with response, criteria and flags', …);
test('granting an unlock makes that level available to the student', …);     // 資料庫層＋rules 層各一個測試
test('supervisor with no cohort sees a "create cohort" form; term end must be a future date', …);
test('audit_log gets a row for grant_unlock and create_cohort, with no response text in it', …);
```

- [ ] **Step 2–4:** FAIL → 實作 → PASS
- [ ] **Step 5:** commit `feat: supervisor dashboard`

### Task 5: 模組 3–8 內容

**Files:** `content/en/stages/foundations/{assessment,formulation,planning,intervention,rupture,termination}/*.yaml`

- [ ] 每個模組：寫四個檔 → `npm run content` exit 0 → 一個 commit → 交用戶審核 → `REVIEW.md` 登記
- [ ] `rupture` 模組的走讀要同時示範一次退縮型和一次對抗型破裂，並示範修復步驟：注意到、點出、探索、承擔自己的部分、重新協商
- [ ] 未審核模組：學生看不到；督導看得到並標示 `Unreviewed`（加測試於 `StagePage.test.tsx`）

### Task 6: 端到端：兩個學生互相隔離

**Files:** `e2e/isolation.spec.ts`、`e2e/supervisor.spec.ts`、`.github/workflows/ci.yml`（加 Supabase 本機實例或測試專案）

- [ ] **Step 1: 寫測試**

```ts
test('student B never receives student A data', async ({ browser }) => {
  // A 作答一題；B 登入後檢查所有 /rest/v1/ 回應的 JSON 不含 A 的 user id 或 A 的回應文字
});
test('supervisor sees A and B; other supervisor sees neither', …);
test('progress made on one device appears on another after sign-in', …);
test('built bundle contains no service role key', …);   // grep dist/
```

- [ ] **Step 2:** `npx playwright test --trace off` → PASS
- [ ] **Step 3:** commit；部署由用戶批准

## Self-Review 紀錄

- Spec §2 → Task 2、4；§3.2 手動解鎖 → Task 4；§6.1 匯入 → Task 3；§7（`reports`、`feedback` 除外，留給階段 3）→ Task 1；§13 階段 2 驗收 → Task 6。
- 風險：pglite 的角色與 RLS 支援未實測，Task 1 Step 1 先驗證並備有替代方案。
