import fs from "node:fs";
import assert from "node:assert/strict";
const webhook=fs.readFileSync(new URL("../api/webhook.js",import.meta.url),"utf8");
const core=fs.readFileSync(new URL("../supabase/migrations/202608120001_v12_core.sql",import.meta.url),"utf8");
const security=fs.readFileSync(new URL("../supabase/migrations/202608120003_v12_security.sql",import.meta.url),"utf8");
const access=fs.readFileSync(new URL("../supabase/migrations/202608130001_role_requests_student_phone.sql",import.meta.url),"utf8");
const health=fs.readFileSync(new URL("../api/student-health.js",import.meta.url),"utf8");
const plans=fs.readFileSync(new URL("../api/training-plans.js",import.meta.url),"utf8");
const atomicTemplate=fs.readFileSync(new URL("../supabase/migrations/202608130003_atomic_training_template.sql",import.meta.url),"utf8");
const operations=fs.readFileSync(new URL("../api/operations.js",import.meta.url),"utf8");
const leaveReview=fs.readFileSync(new URL("../supabase/migrations/202608130004_operations_leave_review.sql",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
const staffClock=fs.readFileSync(new URL("../supabase/migrations/202608130005_staff_clock_safety.sql",import.meta.url),"utf8");
const sheetAdapter=fs.readFileSync(new URL("../supabase/migrations/202608130006_google_shift_adapter.sql",import.meta.url),"utf8");
for(const marker of ["V6 Complete","createBooking","completeSession","complete_session_and_deduct","session_exercises","今日課表","近期預約","訓練摘要","進步多少","身體變化","最近一次評估","studentLookupMessage"])
 assert.ok(webhook.includes(marker),`V6 regression marker missing: ${marker}`);
for(const table of ["body_measurements","student_assessments","training_templates","student_training_plans","audit_logs","role_requests"])
 assert.ok(core.includes(table),`V12 core table missing: ${table}`);
for(const guard of ["user_roles_user_role_uidx","coach_students_active_uidx","sessions_coach_time_scheduled_uidx","review_role_request"])
 assert.ok(security.includes(guard),`V12 security guard missing: ${guard}`);
assert.ok(!core.match(/drop\s+(table|column)/i),"Core migration must be additive");
assert.ok(access.includes("students_normalized_phone_uidx"));
for(const entity of ["body_measurements","student_assessments","student_goals","write_audit_log"])assert.ok(health.includes(entity));
for(const entity of ["student_training_plans","planned_workouts","create_training_template"])assert.ok(plans.includes(entity));
for(const entity of ["training_templates","training_template_items","exercise_library"])assert.ok(atomicTemplate.includes(entity));
for(const entity of ["sales_records","group_classes","work_logs","leave_requests","accounting_exports","integration_adapters"])assert.ok(operations.includes(entity));
for(const entity of ["review_leave_request","approval_logs","write_audit_log"])assert.ok(leaveReview.includes(entity));
for(const demo of ["PT 學員</span><strong>143","預估續約率</span><strong>71%","<b>6 位</b> 高流失風險","<b>11 位</b>","<b>21 位</b>"])assert.ok(!html.includes(demo),`Demo metric must not ship: ${demo}`);
for(const entity of ["work_logs_one_open_per_user_uidx","record_work_clock","write_audit_log"])assert.ok(staffClock.includes(entity));
for(const entity of ["staff_external_mappings","shifts_external_ref_uidx","hills-shifts"])assert.ok(sheetAdapter.includes(entity));
console.log("V6 compatibility and V12 migration checks passed");
