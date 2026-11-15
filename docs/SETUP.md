# 上線步驟（只有專案擁有人能做）

應用有兩種模式。沒有設定 Supabase 時是「本機模式」：不用登入，進度存在學生的瀏覽器。設定後是「雲端模式」：邀請碼加入、登入、進度同步、督導後台。

## A. 本機模式上線（最快，零成本）

1. 在 Cloudflare Pages 建立專案，連結 `clinicmind/practice`。
2. Build command：`npm run build`。Output directory：`dist`。Node 版本：22。
3. 部署。學生打開網址就能用模組 1–2。其餘模組要先審核（見 C）。

## B. 雲端模式

1. 在 supabase.com 建立專案，區域選 Singapore。
2. 套用資料庫結構：在 SQL Editor 依次執行 `supabase/migrations/` 內的 `0001_core.sql`、`0002_supervisor_views.sql`、`0003_hardening.sql`。
3. Authentication → URL Configuration：Site URL 填你的網址；Redirect URLs 加上 `https://你的網址/auth/callback`。
4. 修改 `public/_headers` 最後一行，加入你的 Supabase 網址（檔案頂部有範例）。**不做這一步，瀏覽器會擋住登入和儲存。**
5. 在 Cloudflare Pages 設定兩個環境變數，然後重新部署：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`（用 anon key。service role key 絕對不可以放在這裡。）
6. 建立你的督導帳號：
   1. 用你的電郵在網站登入一次（會收到登入連結）。
   2. 在 Supabase 的 SQL Editor 執行（換成你的電郵和想顯示的名稱）：
      ```sql
      insert into profiles (id, role, display_name)
      select id, 'supervisor', '你的顯示名稱' from auth.users where email = '你的電郵';
      ```
   3. 重新整理網站，進入 `/supervisor`，建立班別，取得邀請碼。
7. 把邀請碼和網址發給學生。學生登入後在 `/join` 輸入邀請碼。

### 雲端模式第一次上線後必須做的驗證

階段 2 有 4 個端到端測試需要真實後端，開發時沒有執行過。請在一個**測試用**的 Supabase 專案上執行：

```bash
E2E_SUPABASE_URL=... E2E_SUPABASE_ANON_KEY=... E2E_SUPABASE_SERVICE_KEY=... \
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run e2e
```

它們檢查：學生 B 收不到學生 A 的任何資料；督導只看到自己的班。全部通過才對學生開放雲端模式。

## C. 審核課程內容

未審核的模組學生看不到，督導看得到並標示 `Unreviewed`。
審核後，在 `content/REVIEW.md` 加一列（slug、locale、version 要和該模組的 `module.yaml` 一致），然後重新部署。

目前狀態：`intake`、`alliance` 已審核。`assessment`、`formulation`、`planning`、`intervention`、`rupture`、`termination` 待審核。

## 指令

```bash
npm ci
npm run check
npm run e2e
npm run dev
```
