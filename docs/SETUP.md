# 上線步驟（只有專案擁有人能做）

應用有兩種模式。沒有設定 Supabase 時是「本機模式」：不用登入，進度存在學生的瀏覽器。設定後是「雲端模式」：邀請碼加入、登入、進度同步、督導後台。

## A. 本機模式上線（最快，零成本）

專案用 Cloudflare Workers 的靜態資源功能部署。設定已寫在 repo 的 `wrangler.jsonc`，不用在 Cloudflare 介面填輸出目錄。

1. 在 Cloudflare 連結 `clinicmind/practice`（Workers → 由 Git 匯入）。
2. Build command：`npm run build`。Deploy command：`npx wrangler deploy`。
3. 每次推送到正式分支，Cloudflare 會自動重新建置和部署。

注意：不要加入 `public/_redirects`。Cloudflare 會把「全部轉到 index.html」的規則判為無限循環而拒絕部署。深層連結由 `wrangler.jsonc` 的 `not_found_handling` 處理。

## B. 雲端模式

1. 在 supabase.com 建立專案，區域選 Singapore。
2. 套用資料庫結構：打開 `supabase/setup-all.sql`，全部複製，貼到 Supabase 的 SQL Editor 執行一次。
3. Authentication → URL Configuration：Site URL 填你的網址；Redirect URLs 加上 `https://你的網址/auth/callback`。
4. 修改 `public/_headers` 最後一行，加入你的 Supabase 網址（檔案頂部有範例）。**不做這一步，瀏覽器會擋住登入和儲存。**
5. 在 Cloudflare 該專案的 Settings → Build → Variables and secrets 設定兩個建置變數，然後重新部署：
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

目前狀態：基礎階段 8 個模組全部已審核（2026-11-15）。

## 指令

```bash
npm ci
npm run check
npm run e2e
npm run dev
```
