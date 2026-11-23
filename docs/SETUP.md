# 上線步驟（只有專案擁有人能做）

應用有兩種模式。沒有設定 Supabase 時是「本機模式」：不用登入，進度存在學生的瀏覽器。設定後是「雲端模式」：邀請碼加入、登入、進度同步、督導後台。

## A. 本機模式上線（最快，零成本）

專案用 Cloudflare Workers 的靜態資源功能部署。設定已寫在 repo 的 `wrangler.jsonc`，不用在 Cloudflare 介面填輸出目錄。

1. 在 Cloudflare 連結 `clinicmind/practice`（Workers → 由 Git 匯入）。
2. Build command：`npm run build`。Deploy command：`npx wrangler deploy`。
3. 每次推送到正式分支，Cloudflare 會自動重新建置和部署。

注意：不要加入 `public/_redirects`。Cloudflare 會把「全部轉到 index.html」的規則判為無限循環而拒絕部署。深層連結由 `wrangler.jsonc` 的 `not_found_handling` 處理。

## B. 雲端模式

已完成（2026-11-15）：Supabase 專案已建立，`supabase/setup-all.sql` 已套用，安全標頭已加入專案網址。已用公開金鑰實測：未登入者讀不到、寫不進任何資料表，也呼叫不了任何函式。

餘下三步由專案擁有人做，**請按這個次序**。做完第 2 步，網站就會要求登入。

1. Supabase → Authentication → URL Configuration：
   - Site URL：填 Cloudflare 給你的網址（例如 `https://practice.你的帳號.workers.dev`）。
   - Redirect URLs：加上 `https://你的網址/auth/callback`。
   - 不做這一步，電郵裡的登入連結會跳到錯誤的地址。
2. Cloudflare → 該專案 → Settings → Build → Variables and secrets，新增兩個變數，然後重新部署：
   - `VITE_SUPABASE_URL` ＝ `https://amjukuutiqnsprgzxkan.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` ＝ 你的 publishable key（`sb_publishable_` 開頭那一個）。service role／secret key 絕對不可以放在這裡。
3. 建立你的督導帳號：
   1. 用你的電郵在網站登入一次（會收到登入連結）。
   2. 在 Supabase 的 SQL Editor 執行（換成你的電郵和想顯示的名稱）：
      ```sql
      insert into profiles (id, role, display_name)
      select id, 'supervisor', 'Supervisor' from auth.users order by created_at limit 1
      on conflict (id) do update set role = 'supervisor';
      select u.email, p.role, p.display_name from profiles p join auth.users u on u.id = p.id;
      ```
      這段指令把**最早註冊的帳號**設為督導，不用修改任何字。執行前先開一個新的查詢分頁（SQL Editor 左上的「+」），分頁裡只貼這一段。結果表格應顯示你的電郵和 `supervisor`。顯示的不是你的電郵時，告訴接手的 session，不要自行再試。
   3. 重新整理網站，進入 `/supervisor`，建立班別，取得邀請碼。
4. 把邀請碼和網址發給學生。學生登入後在 `/join` 輸入邀請碼。

全班使用前的完整準備（自訂 SMTP、學生隔離檢查、開班流程）見 [`docs/SETUP-class.md`](SETUP-class.md)。

注意：Supabase 免費方案內建的電郵服務每小時只能發很少的信，只適合自己測試。全班學生同一時間登入前，要在 Supabase → Authentication → Emails 設定自己的 SMTP 服務。

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

目前狀態：英文版 8 個模組全部已審核（2026-11-15）。繁中版 8 個模組待審核：審核後在 `content/REVIEW.md` 加入 `locale` 為 `zh-Hant` 的列。繁中模組未登記前，選了繁中的學生會看到該模組的英文版和一行提示。

## 指令

```bash
npm ci
npm run check
npm run e2e
npm run dev
```
