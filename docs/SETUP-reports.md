# 報告功能設定（只有專案擁有人能做）

報告正文存在**你的 Google Drive**。資料庫只存標題和統計。函式 `reports` 負責把文字寫進 Drive、讀出來、刪除。

**狀態：未經冒煙測試。** 下面的步驟是按文件寫的，還沒有在真實的 Google 和 Supabase 上走過。第 4 節的冒煙測試通過之前，不要對學生開放。步驟名稱和按鈕可能和你看到的略有不同；差異大時停下來，告訴接手的 session。

**這些機密不可以貼在對話裡，也不可以交給任何人，包括 Claude：** Client secret、Refresh token。只貼在 Supabase 的「Secrets」頁面。

做完這份文件之前，網站不會有任何改變：報告介面預設隱藏（`VITE_REPORTS_ENABLED` 沒有設）。

## 1. Google Cloud（約 7 步，全在瀏覽器完成）

用**要存報告的那個 Google 帳號**登入。檔案會歸這個帳號所有。

1. 開 `https://console.cloud.google.com`。左上角專案選單 → **New project**（新增專案）→ 名稱填 `clinicmind-practice` → **Create**。建好後確認左上角顯示的是這個專案。
2. 左上角三條線選單 → **APIs & Services** → **Library**。搜尋 `Google Drive API` → 點進去 → **Enable**。
3. 左側選單 → **Google Auth Platform**（或 **APIs & Services** → **OAuth consent screen**）→ **Get started**。
   - App name：`ClinicMind Practice`
   - User support email：你的電郵
   - Audience：選 **External**
   - Contact information：你的電郵
   - 勾選同意 → **Create**
4. **這一步最重要：把應用程式設為「正式版」。** 左側 **Audience**（對象）→ Publishing status 區塊 → 按 **Publish app** → 確認。狀態要顯示 **In production**。
   - 如果停在 **Testing**，授權 7 天後失效，報告功能會突然停擺。
   - 本系統只用 `drive.file` 這一個權限。它屬於「非敏感」權限，不需要 Google 審核。如果畫面要求你提交審核，停下來，不要提交，告訴接手的 session。
5. 左側 **Data Access**（資料存取）→ **Add or remove scopes**。在清單或「Manually add scopes」欄位加入 `https://www.googleapis.com/auth/drive.file` → **Update** → **Save**。
6. 左側 **Clients** → **Create client**。
   - Application type：**Web application**
   - Name：`ClinicMind Practice`
   - Authorized redirect URIs → **Add URI** → 貼上 `https://developers.google.com/oauthplayground`
   - **Create**。畫面會顯示 **Client ID** 和 **Client secret**。先留在這一頁，或複製到只有你看得到的地方。
7. 取得 Refresh token（第 4 步完成後才做，否則 token 7 天後失效）：
   1. 開 `https://developers.google.com/oauthplayground`。
   2. 右上角齒輪圖示 → 勾選 **Use your own OAuth credentials** → 貼上 Client ID 和 Client secret → 關閉齒輪面板。
   3. 左側「Step 1」最下面的輸入欄貼上 `https://www.googleapis.com/auth/drive.file` → **Authorize APIs**。
   4. 選你的 Google 帳號 → 按 **Continue**／**Allow**（允許）。
   5. 回到 Playground，「Step 2」→ **Exchange authorization code for tokens**。
   6. 複製 **Refresh token**（一長串，通常 `1//` 開頭）。這是機密。

## 2. Supabase

1. **套用資料表。** 左側 **SQL Editor** → 左上「+」開一個**新的查詢分頁** → 只貼 `supabase/migrations/0005_reports.sql` 的內容 → **Run**。不要貼 `setup-all.sql`。成功時顯示 `Success. No rows returned`。
2. **貼上函式。**
   1. 左側 **Edge Functions** → **Deploy a new function** → **Via Editor**。
   2. 函式名稱填 `reports`（要完全一樣，小寫）。
   3. 刪掉編輯器裡的範例程式，貼上 `supabase/functions/reports/index.ts` 的**全部內容**。這個檔案是程式產生的單一檔案，不要修改。
   4. **Deploy function**。
   5. 如果之後測試時看到 `Invalid JWT`（在函式程式碼執行之前就被擋下），到這個函式的設定頁，把 **Verify JWT** 關掉再試一次。函式自己會向 Supabase 驗證登入，所以關掉不會讓未登入者通過。這一點尚未證實，見第 5 節。
3. **設定密鑰。** **Edge Functions** → **Secrets**（或 **Manage secrets**）→ 新增三個：
   - `GOOGLE_CLIENT_ID` ＝ 第 1 節第 6 步的 Client ID
   - `GOOGLE_CLIENT_SECRET` ＝ 第 1 節第 6 步的 Client secret
   - `GOOGLE_REFRESH_TOKEN` ＝ 第 1 節第 7 步的 Refresh token

   Supabase 會自動提供 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 給函式。**你不需要複製或貼上任何 Supabase 金鑰。**
4. **為一個測試班開啟報告。** SQL Editor → 新的查詢分頁 → 貼上（把名稱換成測試班的班名）：
   ```sql
   update cohorts set reports_enabled = true where name = '測試班名稱';
   select name, reports_enabled from cohorts;
   ```
   其他班維持關閉。

## 3. 不要做的事

- 不要改名、移動或刪除 Drive 裡的 `ClinicMind Practice Reports` 資料夾。程式按名稱在「我的雲端硬碟」根目錄找它；移走後程式會另建一個新資料夾。
- 不要在 Drive 裡手動刪除報告檔案。要刪報告，用網站上的刪除（會同時刪 Drive 檔和資料庫列）。手動刪除後，學生打開那份報告會看到「檔案已不存在」。
- 檔名只是報告編號，看不出是誰的。編號對應到學生，要查資料庫的 `reports` 表。
- 刪除某個學生的帳號時，資料庫的報告列會一併刪除，但 Drive 裡的檔案**不會**。目前沒有自動清理；要先在網站上刪掉他的報告，再刪帳號。

## 4. 冒煙測試（尚未做）

這一節要和接手的 session 一起做，因為要用到開啟報告功能的建置。測試項目：

1. 用測試班的學生帳號提交一份**虛構**的乾淨報告。預期：成功；你的 Drive 出現 `ClinicMind Practice Reports` 資料夾，裡面有一個以班級編號命名的子資料夾，內有一個 `.txt` 檔。
2. 提交含電話號碼的虛構報告。預期：被拒絕，Drive 沒有新檔案。
3. 打開剛才的報告。預期：文字完整。
4. 刪除它。預期：Drive 的檔案消失（程式用永久刪除，不經回收桶）。
5. 把 `GOOGLE_REFRESH_TOKEN` 暫時改成錯的值再提交。預期：看到「Google Drive 連結已經失效」的訊息，資料庫沒有新列。測完改回正確的值。

只有全部通過，才可以考慮對學生開放。開放前還需要你確認的事見 `docs/HANDOFF.md`。

## 5. 如果報告停止運作

- 學生看到「Google Drive 連結已經失效」：Refresh token 失效了。最常見原因是應用程式還在 Testing 狀態（回到第 1 節第 4 步檢查），或你在 Google 帳號的「第三方存取權」移除了它。重做第 1 節第 7 步，更新 `GOOGLE_REFRESH_TOKEN`。
- 學生看到「Google Drive 已滿」：清理 Drive 空間。
- 學生看到「Google Drive 沒有回應」：多數是暫時的，稍後再試。

## 6. 尚未證實的地方（如實列出）

- 上面所有 Google 和 Supabase 介面的按鈕名稱、順序，是按文件寫的，沒有在真實畫面上走過。
- 「Verify JWT」是否擋住新式登入憑證，尚未證實。
- `drive.file` 權限下，程式能否在「我的雲端硬碟」根目錄按名稱找到自己建立的資料夾，尚未在真實 Drive 上證實。
- Supabase 網頁編輯器能否接受 25 KB 的單一檔案，尚未證實。
- Google 把「非敏感權限」的正式版應用程式標為不需要審核，這是文件上的說法，尚未證實。
