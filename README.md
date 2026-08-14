# Chilling Coach OS — 學生管理與續約營運系統

## 2.0 功能範圍
- 學員、電話唯一識別、方案與剩餘堂數
- 課程、訓練計畫、身體數據、評估與目標
- 剩餘 3 堂／30 天內到期的續約提醒
- 主管查看各教練學員數、總剩餘堂數、本月業績與續約營收預測
- LINE 提醒資料結構、重複防護及每月訊息上限（主動推播待確認收件人與費用後啟用）
- 新教練申請與主管核准

員工差勤、打卡、請假、薪資、獎金與 Google 班表同步已退出產品範圍。

部署前執行 `supabase/migrations/202608140001_student_crm.sql`。LINE 推播引擎預設不排程；確認收件人、內容、時段與費用上限後，才設定 `CRON_SECRET`、`LINE_MONTHLY_MESSAGE_LIMIT` 並啟用排程。

> V12 / 1.0 implementation is included as additive Supabase migrations, live Mini App APIs, and a permission-scoped data Copilot. Deployment instructions: `docs/DEPLOY_V12.md`. Company/Google Sheets mapping contract: `docs/INTEGRATIONS.md`.

這是一個可直接開啟展示的前端原型，先驗證「教練端 + 主管端」操作流程。

## 已完成
- 教練端 Dashboard
- 學員剩餘堂數、上課頻率、預估完課、續約機率
- 學員卡片與詳細資料
- 今日課程「完成課程」互動，會模擬扣除剩餘堂數
- 主管端真實營運摘要、教練權限與請假審核
- 尚未提供公司規則的續約、薪資與會計預測不顯示推測數字
- 手機版 RWD，適合後續包成 LIFF / LINE MINI App

## 本機預覽
直接開啟 index.html 即可。

若瀏覽器限制本機 JS，可在資料夾內執行：
python3 -m http.server 8000
然後開啟 http://localhost:8000

## 正式版建議架構
- Frontend: Next.js / React
- Auth: LINE Login / LIFF
- Database: Supabase PostgreSQL
- API: Next.js Route Handlers / Supabase Edge Functions
- LINE Messaging API: 提醒教練、主管營運摘要
- Hosting: Vercel

## LINE 串接流程
1. 建立 LINE Official Account。
2. 啟用 Messaging API。
3. 建立 LINE Login channel / LIFF 或 LINE MINI App。
4. 把正式網站 URL 設為 LIFF Endpoint URL。
5. 前端透過 liff.init() / LINE Login 取得登入狀態。
6. 後端驗證 LINE 身分後，再對應 users 表中的 coach / manager 權限。
7. Messaging API webhook 必須驗證 x-line-signature。
8. 主動提醒使用 push message API。

## 建議資料表
users
- id
- line_user_id
- name
- role (coach / manager)
- coach_id

students
- id
- coach_id
- name
- status
- joined_at

packages
- id
- student_id
- purchased_sessions
- remaining_sessions
- purchased_at
- price

sessions
- id
- student_id
- coach_id
- session_at
- workout_note
- status

renewals
- id
- student_id
- coach_id
- previous_package_id
- renewed
- renewed_at
- amount

## 第一版預測邏輯
estimated_finish_date =
today + remaining_sessions / average_sessions_per_week * 7

建議續約接觸日 =
estimated_finish_date - 7~14 days

renewal_probability 第一版先使用規則分數：
- 近 4 週上課頻率
- 頻率是否下降
- 剩餘堂數
- 距離最後一次上課天數
- 歷史續約次數
- 取消 / 請假比例

累積 3–6 個月資料後，再改成真正的統計 / ML 預測模型。


## V2：LINE 身分辨識測試
本版已加入 LINE LIFF SDK，使用 Developing LIFF ID：
`2011008227-7rnEFNrI`

測試目的：
- 從 LINE MINI App 開啟時讀取實際 LINE 顯示名稱
- 頁首顯示「LINE 身分已連線」
- 外部瀏覽器會透過 LINE Login 流程登入
- 尚未接資料庫，因此教練 / 主管權限切換仍為 Demo

安全注意：
- 本版只在瀏覽器記憶體中使用 `liff.getProfile()` 的結果。
- 正式接後端時，不會把 `getProfile()` 取得的 userId / displayName 直接當可信任身分送給伺服器。
- 正式版會把 LINE ID token 或 access token 傳給後端，由後端向 LINE 驗證後再對應資料庫權限。


# V3 — Secure LINE → Supabase account bootstrap

## Architecture
LINE MINI App
→ LIFF obtains LINE access token
→ POST /api/me
→ Vercel server validates token with LINE `/v2/profile`
→ server uses Supabase Secret key
→ creates/finds `users`
→ returns `user_roles`

The browser never receives `SUPABASE_SECRET_KEY`.

## Required Vercel environment variables

Set these in Vercel → Project → Settings → Environment Variables:

SUPABASE_URL
https://ctlpugehkcmqeabocksq.supabase.co

SUPABASE_SECRET_KEY
Use the Supabase Secret key from Project Settings → API Keys → Secret keys.
Do NOT place this value in GitHub or frontend files.

## First launch behavior
The first successful LINE launch creates a row in `users`.
It does NOT automatically grant coach/manager permissions.

After the first launch, assign roles in SQL Editor using the user's row ID, for example:

insert into public.user_roles (user_id, role)
select id, 'coach'
from public.users
where display_name = 'YOUR_LINE_DISPLAY_NAME'
on conflict do nothing;

insert into public.user_roles (user_id, role)
select id, 'manager'
from public.users
where display_name = 'YOUR_LINE_DISPLAY_NAME'
on conflict do nothing;

For production, prefer assigning by users.id rather than display_name.


# V4 — Real student creation + live student list

## What changed
- `+ 新增學員` now opens a real form.
- POST `/api/students` creates a row in `students`.
- The same request automatically creates the `coach_students` relationship for the logged-in coach.
- GET `/api/students` returns only students currently assigned to the logged-in coach.
- LINE access token is validated server-side before any data operation.
- Coach role is required for both read and create operations.
- The frontend no longer uses the demo student cards for the main student list.

## Deploy
Upload/replace:
- index.html
- styles.css
- app.js
- README.md
- vercel.json
- api/students.js

Keep:
- api/me.js

No new environment variables are required.


# V5B
- MINI App 學員詳情可建立課程方案
- 方案包含名稱、購買堂數、剩餘堂數、金額、到期日
- LINE Bot 的「某某剩幾堂」會讀真實方案
- 有有效方案後，預約指令可建立 sessions


# V5C — Complete session + deduct + training records

Before deploying, run `supabase_v5c_migration.sql` in Supabase SQL Editor.

New LINE commands:
- `測試學員A 完成上課`
- `測試學員A 8/12 完成上課`

Training record:
```
測試學員A 8/12
Back squat 30kg 10*3
Bench press 20kg 12*3 RPE8
```

Completion uses the Postgres RPC `complete_session_and_deduct()` so session completion and remaining-session deduction happen in one database transaction.
