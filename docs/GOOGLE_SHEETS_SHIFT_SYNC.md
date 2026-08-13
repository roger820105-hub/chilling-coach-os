# Google Sheet 班表同步

資料流：`11508丘陵班表_加班請假管理_v2` → Apps Script → Coach OS `/api/operations` → Supabase 班表、加班與請假資料。

## 安全原則

- 原始 Sheet 保持唯讀來源。
- `GOOGLE_SHEETS_SYNC_SECRET` 只放在 Vercel 與 Apps Script Script Properties。
- Sheet 姓名必須先在主管端配對 LINE 帳號；未配對資料不匯入。
- 每筆班次使用 `spreadsheet ID + 姓名 + 日期 + 班別` 防止重複匯入。

## Apps Script

在試算表選「擴充功能 → Apps Script」，建立下列函式。先在「專案設定 → 指令碼屬性」加入 `COACH_OS_SYNC_SECRET`。

```javascript
function syncCoachOsShifts() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('班表');
  const values = sh.getRange('A1:AJ20').getDisplayValues();
  const roc = Number((ss.getName().match(/^(\d{3})/) || [])[1]);
  const month = Number(values[1][0].replace('月',''));
  if (!roc || !month) throw new Error('無法辨識民國年或月份');
  const year = roc + 1911;
  const codes = {};
  for (let r = 3; r < values.length; r++) {
    const code = values[r][33], start = values[r][34], end = values[r][35];
    if (code && start && end) codes[code] = {start, end};
  }
  const shifts = [];
  for (let r = 4; r < values.length; r++) {
    const employee = values[r][0];
    if (!employee) continue;
    for (let c = 1; c <= 31; c++) {
      const day = Number(values[1][c]), code = values[r][c];
      if (!day || !codes[code]) continue;
      shifts.push({employee, date: Utilities.formatString('%04d-%02d-%02d',year,month,day), shiftCode:code, start:codes[code].start, end:codes[code].end});
    }
  }
  const overtime = ss.getSheetByName('加班明細').getRange('A6:M200').getDisplayValues().map((r,i)=>({row:i+6,date:r[0],employee:r[1],start:r[2],end:r[3],shiftCode:r[4],breakHours:r[8]||r[7],hours:r[9],firstTwo:r[10],afterTwo:r[11],note:r[12]})).filter(x=>x.date&&x.employee&&x.start&&x.end&&x.hours);
  const leaves = ss.getSheetByName('請假明細').getRange('A6:J200').getDisplayValues().map((r,i)=>({row:i+6,date:r[0],employee:r[1],leaveType:r[2],start:r[3],end:r[4],hours:r[8],note:r[9]})).filter(x=>x.date&&x.employee&&x.leaveType&&x.start&&x.end&&x.hours);
  const response = UrlFetchApp.fetch('https://chilling-coach-os.vercel.app/api/operations', {
    method:'post', contentType:'application/json', headers:{'x-sync-secret':PropertiesService.getScriptProperties().getProperty('COACH_OS_SYNC_SECRET')},
    payload:JSON.stringify({action:'google_shift_sync',spreadsheetId:ss.getId(),period:Utilities.formatString('%04d-%02d',year,month),shifts,overtime,leaves}), muteHttpExceptions:true
  });
  Logger.log(response.getContentText());
  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
}
```
