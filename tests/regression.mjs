import fs from "node:fs";
import assert from "node:assert/strict";
const webhook=fs.readFileSync(new URL("../api/webhook.js",import.meta.url),"utf8");
const core=fs.readFileSync(new URL("../supabase/migrations/202608120001_v12_core.sql",import.meta.url),"utf8");
const security=fs.readFileSync(new URL("../supabase/migrations/202608120003_v12_security.sql",import.meta.url),"utf8");
const access=fs.readFileSync(new URL("../supabase/migrations/202608130001_role_requests_student_phone.sql",import.meta.url),"utf8");
const health=fs.readFileSync(new URL("../api/student-health.js",import.meta.url),"utf8");
for(const marker of ["V6 Complete","createBooking","completeSession","complete_session_and_deduct","session_exercises","今日課表","近期預約","訓練摘要","進步多少"])
 assert.ok(webhook.includes(marker),`V6 regression marker missing: ${marker}`);
for(const table of ["body_measurements","student_assessments","training_templates","student_training_plans","audit_logs","role_requests"])
 assert.ok(core.includes(table),`V12 core table missing: ${table}`);
for(const guard of ["user_roles_user_role_uidx","coach_students_active_uidx","sessions_coach_time_scheduled_uidx","review_role_request"])
 assert.ok(security.includes(guard),`V12 security guard missing: ${guard}`);
assert.ok(!core.match(/drop\s+(table|column)/i),"Core migration must be additive");
assert.ok(access.includes("students_normalized_phone_uidx"));
for(const entity of ["body_measurements","student_assessments","student_goals","write_audit_log"])assert.ok(health.includes(entity));
console.log("V6 compatibility and V12 migration checks passed");
