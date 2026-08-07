# Chilling Coach OS — LINE Mini App MVP

這是一個可直接開啟展示的前端原型，先驗證「教練端 + 主管端」操作流程。

## 已完成
- 教練端 Dashboard
- 學員剩餘堂數、上課頻率、預估完課、續約機率
- 學員卡片與詳細資料
- 今日課程「完成課程」互動，會模擬扣除剩餘堂數
- 主管端續約率、預估續約單數、預估營收
- 營運風險雷達與 AI Insight 區塊
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
