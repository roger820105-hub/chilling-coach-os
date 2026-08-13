
// ===== LINE MINI App / V3 secure account bootstrap =====
// Production uses the Published LINE MINI App channel. The Developing channel
// is limited to users explicitly enrolled as LINE Developers testers.
const LIFF_ID = "2011008229-HzPkUq3C";

function setRoleUI(roles) {
  const coachBtn = document.getElementById("coachBtn");
  const managerBtn = document.getElementById("managerBtn");
  const roleSwitch = document.getElementById("roleSwitch");
  const coachView = document.getElementById("coachView");
  const managerView = document.getElementById("managerView");

  const isCoach = roles.includes("coach");
  const isManager = roles.includes("manager") || roles.includes("admin");
  const requestBtn = document.getElementById("requestCoachRole");
  requestBtn.classList.toggle("hidden",isCoach||isManager);

  roleSwitch.classList.add("hidden");

  if (isCoach && isManager) {
    roleSwitch.classList.remove("hidden");
    coachView.classList.remove("hidden");
    managerView.classList.add("hidden");
    coachBtn.classList.add("active");
    managerBtn.classList.remove("active");
  } else if (isManager) {
    coachView.classList.add("hidden");
    managerView.classList.remove("hidden");
  } else {
    coachView.classList.remove("hidden");
    managerView.classList.add("hidden");
  }
}

async function initLineAccount() {
  const greeting = document.getElementById("lineGreeting");
  const status = document.getElementById("lineStatus");
  const accountState = document.getElementById("accountState");

  if (typeof liff === "undefined") {
    greeting.textContent = "LINE SDK 載入失敗";
    status.textContent = "LINE SDK 未載入";
    status.className = "line-status error";
    accountState.textContent = "無法確認系統帳號";
    accountState.className = "account-state error";
    return;
  }

  try {
    await liff.init({
      liffId: LIFF_ID,
      withLoginOnExternalBrowser: true
    });

    if (!liff.isLoggedIn()) {
      status.textContent = "尚未登入 LINE";
      status.className = "line-status warn";
      accountState.textContent = "等待 LINE 登入…";
      accountState.className = "account-state warn";
      return;
    }

    const profile = await liff.getProfile();
    greeting.textContent = `早安，${profile.displayName}`;
    status.textContent = liff.isInClient()
      ? "LINE 身分已連線"
      : "LINE 身分已連線（外部瀏覽器）";
    status.className = "line-status ok";

    const accessToken = liff.getAccessToken();
    window.chillingLineAccessToken = accessToken;
    if (!accessToken) {
      throw new Error("Unable to obtain LINE access token");
    }

    const response = await fetch("/api/me", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ accessToken })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Account bootstrap failed");
    }

    window.chillingUser = payload.user;

    const roles = payload.roles || [];
    setRoleUI(roles);

    if (roles.includes("coach")) {
      await Promise.all([loadStudents(), loadDashboard()]);
    }
    if (roles.includes("manager") || roles.includes("admin")) await loadRoleRequests();

    if (payload.created) {
      accountState.textContent = "系統帳號已建立｜目前尚未指派角色";
      accountState.className = "account-state warn";
    } else if (roles.length === 0) {
      accountState.textContent = "帳號已存在｜尚未指派角色";
      accountState.className = "account-state warn";
    } else {
      accountState.textContent = `系統角色：${roles.join(" + ")}`;
      accountState.className = "account-state ok";
    }

  } catch (error) {
    console.error("LINE / account init error:", error);
    accountState.textContent = "系統帳號連線失敗";
    accountState.className = "account-state error";
  }
}

document.addEventListener("DOMContentLoaded", initLineAccount);
// ===== End V3 secure account bootstrap =====






let students = [];
let currentStudent = null;
const list = document.getElementById("studentList");
const studentLoadState = document.getElementById("studentLoadState");

function formatDateTW(value){
  if(!value) return "—";
  try{
    const d = new Date(value);
    if(Number.isNaN(d.getTime())) return value;
    return `${d.getMonth()+1}/${d.getDate()}`;
  }catch{
    return value;
  }
}

function render(filter="all"){
  list.innerHTML = "";

  let filtered = students;
  if(filter !== "all"){
    // V4 先保留篩選器 UI；續約風險會在後續版本由真實消課資料計算
    filtered = students.filter(s => s.statusBucket === filter);
  }

  if(filtered.length === 0){
    studentLoadState.classList.add("empty");
    studentLoadState.textContent = students.length === 0
      ? "目前還沒有學員。按右上角「＋新增學員」建立第一位。"
      : "目前沒有符合這個篩選條件的學員。";
    studentLoadState.style.display = "block";
    return;
  }

  studentLoadState.style.display = "none";
  studentLoadState.classList.remove("empty","error");

  filtered.forEach(s=>{
    const el=document.createElement("div");
    el.className="card student-card";

    const statusLabel = s.status === "paused" ? "暫停" : (s.status === "inactive" ? "停用" : "進行中");
    const statusClass = s.status === "active" ? "status-stable" : "status-risk";

    el.innerHTML=`
      <div class="student-top">
        <h4>${escapeHtml(s.name)}${s.phone?` <small>（${escapeHtml(s.phone.slice(-4))}）</small>`:""}</h4>
        <span class="${statusClass}">${statusLabel}</span>
      </div>
      <div class="student-meta">
        <div><small>建立日期</small><b>${formatDateTW(s.joined_at)}</b></div>
        <div><small>目前狀態</small><b>${statusLabel}</b></div>
      </div>
      ${s.note ? `<div class="note-preview">${escapeHtml(s.note)}</div>` : ""}
      <div class="live-badge">Supabase 即時資料</div>
    `;
    el.onclick=()=>openStudent(s);
    list.appendChild(el);
  });
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function loadStudents(){
  if(!window.chillingLineAccessToken) return;

  studentLoadState.style.display = "block";
  studentLoadState.classList.remove("error","empty");
  studentLoadState.textContent = "正在載入你的學員…";

  try{
    const response = await fetch("/api/students",{
      method:"GET",
      headers:{
        "Authorization":`Bearer ${window.chillingLineAccessToken}`
      }
    });

    const payload = await response.json();

    if(!response.ok){
      throw new Error(payload.error || "Unable to load students");
    }

    students = (payload.students || []).map(s => ({
      ...s,
      statusBucket: "stable"
    }));

    document.getElementById("studentCount").textContent = students.length;
    render(document.getElementById("studentFilter").value);
  }catch(error){
    console.error(error);
    studentLoadState.style.display = "block";
    studentLoadState.classList.add("error");
    studentLoadState.textContent = "學員資料載入失敗，請重新開啟 MINI App 再試一次。";
  }
}


document.getElementById("studentFilter").onchange=e=>render(e.target.value);
const coachView=document.getElementById("coachView"), managerView=document.getElementById("managerView");
document.getElementById("coachBtn").onclick=()=>{coachView.classList.remove("hidden");managerView.classList.add("hidden");coachBtn.classList.add("active");managerBtn.classList.remove("active")};
document.getElementById("managerBtn").onclick=()=>{managerView.classList.remove("hidden");coachView.classList.add("hidden");managerBtn.classList.add("active");coachBtn.classList.remove("active")};

async function openStudent(s){
 currentStudent = s;
 document.getElementById("dialogName").textContent=s.name;
 document.getElementById("dialogBody").innerHTML=`
 <div class="detail-grid">
  <div><small>狀態</small><b>${s.status === "active" ? "進行中" : (s.status === "paused" ? "暫停" : "停用")}</b></div>
  <div><small>加入日期</small><b>${formatDateTW(s.joined_at)}</b></div>
  <div><small>電話</small><b>${s.phone ? escapeHtml(s.phone) : "—"}</b></div>
  <div><small>教練關係</small><b>主要教練</b></div>
 </div>
 <div id="packageSummary" class="callout">正在讀取課程方案…</div>
 <div class="eyebrow" style="margin-top:16px">備註</div>
 <div class="timeline"><p>${s.note ? escapeHtml(s.note) : "尚無備註"}</p></div>`;
 document.getElementById("studentDialog").showModal();
 await Promise.all([loadStudentPackage(s.id),loadStudentV12Detail(s.id)]);
}

async function apiJson(path,options={}){
  const response=await fetch(path,{...options,headers:{Authorization:`Bearer ${window.chillingLineAccessToken}`,...(options.headers||{})}});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error||"Request failed");
  return payload;
}
async function loadDashboard(){
 try{
  const d=await apiJson("/api/dashboard");
  document.getElementById("monthSessions").textContent=d.metrics.monthCompleted;
  document.getElementById("todaySessions").textContent=d.metrics.today;
  document.getElementById("pendingSessions").textContent=d.metrics.pending;
  const box=document.getElementById("todaySchedule");
  box.innerHTML=d.today.length?d.today.map(x=>`<div class="session-row"><div><b>${new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(x.scheduled_at))} ${escapeHtml(x.student_name)}</b><span>${x.status==="completed"?"已完成":"已預約"}</span></div></div>`).join(""):"<div class=\"load-state empty\">今天沒有課程。</div>";
 }catch(e){console.error(e);document.getElementById("todaySchedule").textContent="今日課表載入失敗。"}
}
async function loadStudentV12Detail(studentId){
 try{
  const d=await apiJson(`/api/student-detail?student_id=${encodeURIComponent(studentId)}`), body=document.getElementById("dialogBody"), latest=d.measurements.at(-1), completed=d.sessions.filter(x=>x.status==="completed").length;
  const points=d.measurements.slice(-8), values=points.map(x=>Number(x.weight_kg)).filter(Number.isFinite), min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):0,span=max-min||1;
  const bars=points.map(x=>{const v=Number(x.weight_kg);return Number.isFinite(v)?`<div class="trend-bar" style="height:${24+((v-min)/span)*56}px" title="${escapeHtml(String(v))} kg"><span>${escapeHtml(String(v))}</span></div>`:""}).join("");
  const assessment=d.assessments[0], activeGoals=d.goals.filter(x=>x.status==="active");
  body.insertAdjacentHTML("beforeend",`<div class="detail-grid v12-detail"><div><small>累積完成</small><b>${completed} 堂</b></div><div><small>最近身體數據</small><b>${latest?`${latest.weight_kg??"—"} kg / ${latest.body_fat_pct??"—"}%`:"尚未記錄"}</b></div><div><small>評估</small><b>${d.assessments.length} 筆</b></div><div><small>進行中目標</small><b>${activeGoals.length} 個</b></div></div><div class="health-panels"><div><div class="eyebrow">體重趨勢</div>${bars?`<div class="trend-chart">${bars}</div>`:"<p class=\"muted\">新增至少一筆體重後顯示趨勢。</p>"}</div><div><div class="eyebrow">最近評估</div><p>${assessment?`${escapeHtml(assessment.assessment_type)}｜傷病：${escapeHtml(assessment.injuries||"無記錄")}｜限制：${escapeHtml(assessment.limitations||"無記錄")}`:"尚無評估"}</p></div><div><div class="eyebrow">會員目標</div>${activeGoals.length?activeGoals.map(x=>`<p><b>${escapeHtml(x.title)}</b>${x.target_value!=null?`｜${x.target_value} ${escapeHtml(x.unit||"")}`:""}${x.target_date?`｜${escapeHtml(x.target_date)}`:""}</p>`).join(""):"<p>尚無進行中目標</p>"}</div></div>`);
 }catch(e){console.error(e)}
}

const healthDialog=document.getElementById("healthDialog"),healthForm=document.getElementById("healthForm"),healthMessage=document.getElementById("healthMessage");let healthType="measurement";
function input(label,id,type="text",extra=""){return `<label class="field-label" for="${id}">${label}</label><input id="${id}" class="text-input" type="${type}" ${extra}/>`}
function openHealth(type){healthType=type;healthMessage.textContent="";document.getElementById("healthDialogTitle").textContent=type==="measurement"?"新增身體數據":type==="assessment"?"新增會員評估":"新增會員目標";healthForm.innerHTML=type==="measurement"?`${input("測量時間","healthDate","datetime-local")}${input("體重 kg","healthWeight","number",'step="0.1" min="1"')}${input("體脂 %","healthFat","number",'step="0.1" min="0" max="100"')}${input("肌肉量 kg","healthMuscle","number",'step="0.1" min="0"')}${input("腰圍 cm","healthWaist","number",'step="0.1" min="0"')}${input("臀圍 cm","healthHip","number",'step="0.1" min="0"')}${input("胸圍 cm","healthChest","number",'step="0.1" min="0"')}${input("備註","healthNote")}`:type==="assessment"?`${input("評估類型 *","healthAssessmentType")}${input("評估時間","healthDate","datetime-local")}${input("摘要","healthSummary")}${input("傷病","healthInjuries")}${input("動作／訓練限制","healthLimitations")}${input("備註","healthNote")}`:`${input("目標名稱 *","healthGoalTitle")}${input("目標說明","healthGoalDescription")}${input("目標數值","healthTargetValue","number",'step="0.1"')}${input("單位","healthUnit")}${input("目標日期","healthTargetDate","date")}`;healthDialog.showModal()}
document.getElementById("openMeasurementBtn").onclick=()=>openHealth("measurement");document.getElementById("openAssessmentBtn").onclick=()=>openHealth("assessment");document.getElementById("openGoalBtn").onclick=()=>openHealth("goal");document.getElementById("closeHealthDialog").onclick=()=>healthDialog.close();document.getElementById("closeStudentDialog").onclick=document.getElementById("closeStudentDialogBottom").onclick=()=>document.getElementById("studentDialog").close();
document.getElementById("saveHealthBtn").onclick=async()=>{const v=id=>document.getElementById(id)?.value||"",payload={studentId:currentStudent.id,type:healthType};if(healthType==="measurement")Object.assign(payload,{measuredAt:v("healthDate")?new Date(v("healthDate")).toISOString():null,weightKg:v("healthWeight"),bodyFatPct:v("healthFat"),muscleMassKg:v("healthMuscle"),waistCm:v("healthWaist"),hipCm:v("healthHip"),chestCm:v("healthChest"),note:v("healthNote")});else if(healthType==="assessment")Object.assign(payload,{assessmentType:v("healthAssessmentType"),assessedAt:v("healthDate")?new Date(v("healthDate")).toISOString():null,summary:v("healthSummary"),injuries:v("healthInjuries"),limitations:v("healthLimitations"),note:v("healthNote")});else Object.assign(payload,{title:v("healthGoalTitle"),description:v("healthGoalDescription"),targetValue:v("healthTargetValue"),unit:v("healthUnit"),targetDate:v("healthTargetDate")});healthMessage.textContent="儲存中…";try{await apiJson("/api/student-health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});healthDialog.close();document.getElementById("studentDialog").close();await openStudent(currentStudent)}catch(e){healthMessage.textContent="儲存失敗，請確認必填欄位與數值。";healthMessage.className="form-message error"}};

document.getElementById("askCopilot").onclick=async()=>{
 const answer=document.getElementById("copilotAnswer"), query=document.getElementById("copilotQuery").value.trim();
 if(!query){answer.textContent="請先輸入問題。";return}
 answer.textContent="正在整理已儲存資料…";
 try{const d=await apiJson("/api/copilot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query})});answer.textContent=d.answer}catch(e){answer.textContent="查詢失敗，請稍後再試。"}
};

window.completeSession=function(name){
 const s=students.find(x=>x.name===name);
 if(s && typeof s.remaining==="number" && s.remaining>0){s.remaining--; s.last="今天"; render(document.getElementById("studentFilter").value);}
 alert(`${name} 今日課程已完成，剩餘堂數已自動 -1，預估完課日將重新計算。`);
}


const addStudentDialog = document.getElementById("addStudentDialog");
const addStudentMessage = document.getElementById("addStudentMessage");
const saveStudentBtn = document.getElementById("saveStudentBtn");

document.getElementById("addStudent").onclick=()=>{
  document.getElementById("newStudentName").value="";
  document.getElementById("newStudentPhone").value="";
  document.getElementById("newStudentNote").value="";
  addStudentMessage.textContent="";
  addStudentMessage.className="form-message";
  addStudentDialog.showModal();
  setTimeout(()=>document.getElementById("newStudentName").focus(),50);
};

document.getElementById("closeAddStudentDialog").onclick=()=>addStudentDialog.close();

saveStudentBtn.onclick=async()=>{
  const name=document.getElementById("newStudentName").value.trim();
  const phone=document.getElementById("newStudentPhone").value.trim();
  const note=document.getElementById("newStudentNote").value.trim();

  if(!name||!phone){
    addStudentMessage.textContent="請輸入學員姓名與電話；電話用於辨識同名學員。";
    addStudentMessage.className="form-message error";
    return;
  }

  if(!window.chillingLineAccessToken){
    addStudentMessage.textContent="LINE 身分尚未完成，請重新開啟 MINI App。";
    addStudentMessage.className="form-message error";
    return;
  }

  saveStudentBtn.disabled=true;
  saveStudentBtn.textContent="建立中…";
  addStudentMessage.textContent="正在寫入 Supabase…";
  addStudentMessage.className="form-message";

  try{
    const response=await fetch("/api/students",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${window.chillingLineAccessToken}`
      },
      body:JSON.stringify({name,phone,note})
    });

    const payload=await response.json();

    if(!response.ok){
      throw new Error(payload.error || "Create student failed");
    }

    addStudentMessage.textContent="學員建立成功。";
    addStudentMessage.className="form-message ok";

    await loadStudents();
    setTimeout(()=>addStudentDialog.close(),450);
  }catch(error){
    console.error(error);
    addStudentMessage.textContent=error.message?.startsWith("Phone already belongs")?"此電話已建立學員資料，請勿重複新增。":"建立失敗，請稍後再試。";
    addStudentMessage.className="form-message error";
  }finally{
    saveStudentBtn.disabled=false;
    saveStudentBtn.textContent="建立學員";
  }
};


async function loadStudentPackage(studentId){
  const box=document.getElementById("packageSummary");
  if(!box||!window.chillingLineAccessToken)return;
  try{
    const response=await fetch(`/api/packages?student_id=${encodeURIComponent(studentId)}`,{headers:{Authorization:`Bearer ${window.chillingLineAccessToken}`}});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||"Package load failed");
    const pkg=payload.package;
    if(!pkg){box.innerHTML="<b>目前沒有有效方案</b><br>請建立方案後再進行預約與扣堂。";return;}
    box.innerHTML=`<b>${escapeHtml(pkg.package_name||`${pkg.purchased_sessions}堂方案`)}</b><br>剩餘：${pkg.remaining_sessions} / ${pkg.purchased_sessions} 堂${pkg.expires_at?`<br>有效至：${escapeHtml(pkg.expires_at)}`:""}${Number(pkg.price)>0?`<br>金額：NT$${Number(pkg.price).toLocaleString()}`:""}`;
  }catch(e){console.error(e);box.textContent="方案資料讀取失敗。";}
}
const packageDialog=document.getElementById("packageDialog");
const packageMessage=document.getElementById("packageMessage");
document.getElementById("openPackageBtn").onclick=()=>{
  if(!currentStudent)return;
  document.getElementById("packageStudentName").textContent=`${currentStudent.name}｜建立課程方案`;
  ["packageName","packageSessions","packagePrice","packageExpiresAt"].forEach(id=>document.getElementById(id).value="");
  packageMessage.textContent="";
  packageDialog.showModal();
};
document.getElementById("closePackageDialog").onclick=()=>packageDialog.close();
document.getElementById("savePackageBtn").onclick=async()=>{
  const purchasedSessions=Number(document.getElementById("packageSessions").value);
  if(!Number.isInteger(purchasedSessions)||purchasedSessions<=0){packageMessage.textContent="請輸入正確的購買堂數。";packageMessage.className="form-message error";return;}
  try{
    packageMessage.textContent="正在建立方案…";
    const response=await fetch("/api/packages",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${window.chillingLineAccessToken}`},body:JSON.stringify({
      studentId:currentStudent.id,
      packageName:document.getElementById("packageName").value.trim(),
      purchasedSessions,
      price:Number(document.getElementById("packagePrice").value||0),
      expiresAt:document.getElementById("packageExpiresAt").value||null
    })});
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||"Create package failed");
    packageMessage.textContent="方案建立成功。";packageMessage.className="form-message ok";
    await loadStudentPackage(currentStudent.id);
    setTimeout(()=>packageDialog.close(),400);
  }catch(e){console.error(e);packageMessage.textContent="建立失敗，請稍後再試。";packageMessage.className="form-message error";}
};

document.getElementById("exportBtn").onclick=()=>alert("MVP 下一步：可輸出 Excel / PDF 月報，或每日自動推送至主管 LINE。");

document.getElementById("requestCoachRole").onclick=async()=>{
 const btn=document.getElementById("requestCoachRole"); btn.disabled=true;
 try{const d=await apiJson("/api/role-requests",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role:"coach"})});btn.textContent=d.created?"申請已送出，等待主管核准":"申請審核中"}catch(e){btn.textContent=e.message==="Coach role already granted"?"已取得教練權限":"送出失敗，請稍後再試"}
};
async function loadRoleRequests(){
 const box=document.getElementById("roleRequestList"); if(!box)return;
 try{const d=await apiJson("/api/role-requests");box.innerHTML=d.requests.length?d.requests.map(x=>`<div class="approval-row"><div><b>${escapeHtml(x.display_name)}</b><span>申請教練權限｜${new Date(x.requested_at).toLocaleString("zh-TW")}</span></div><div><button class="primary" onclick="reviewRoleRequest('${x.id}',true)">核准</button><button class="secondary" onclick="reviewRoleRequest('${x.id}',false)">拒絕</button></div></div>`).join(""):"<div class=\"load-state empty\">目前沒有待審核申請。</div>"}catch(e){box.textContent="申請清單載入失敗。"}
}
window.reviewRoleRequest=async(id,approve)=>{if(!confirm(approve?"確定核准此教練權限？":"確定拒絕此申請？"))return;try{await apiJson("/api/role-request-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:id,approve})});await loadRoleRequests()}catch(e){alert("審核失敗，請重新整理後再試。")}};
document.getElementById("refreshRoleRequests").onclick=loadRoleRequests;

const trainingPlanDialog=document.getElementById("trainingPlanDialog"),trainingPlanContent=document.getElementById("trainingPlanContent");
document.getElementById("closeTrainingPlanDialog").onclick=()=>trainingPlanDialog.close();
document.getElementById("openTrainingPlanBtn").onclick=async()=>{trainingPlanDialog.showModal();trainingPlanContent.innerHTML="<div class=\"load-state\">正在載入訓練計畫…</div>";await loadTrainingPlans()};
async function loadTrainingPlans(){try{const d=await apiJson(`/api/training-plans?student_id=${encodeURIComponent(currentStudent.id)}`),next=d.workouts.filter(x=>x.status==="planned").slice(0,6);trainingPlanContent.innerHTML=`<div class="plan-section"><h3>指派模板</h3><select id="planTemplate" class="text-input"><option value="">選擇模板</option>${d.templates.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select>${input("開始日期","planStartsOn","date")}<button class="primary full" id="assignTemplateBtn" type="button">指派給學員</button></div><div class="plan-section"><h3>未來課表</h3>${next.length?next.map(x=>`<div class="planned-row"><b>${escapeHtml(x.planned_for)}｜${escapeHtml(x.title||"訓練")}</b>${(x.items||[]).map(i=>`<span>${escapeHtml(i.exercise_name)}｜${i.sets??"—"}組 × ${escapeHtml(i.reps??"—")}${i.rpe?`｜RPE ${i.rpe}`:""}</span>`).join("")}</div>`).join(""):"<p>尚未指派訓練計畫。</p>"}</div><div class="plan-section"><h3>建立新模板</h3>${input("模板名稱 *","templateName")}${input("目標","templateGoal")}${input("週數","templateWeeks","number",'min="1" value="1"')}<textarea id="templateItems" class="text-input textarea-input" placeholder="每行一個動作，例如：&#10;1,1,Back squat,3,8,RPE7&#10;1,2,Bench press,3,10,RPE8"></textarea><small>格式：週次,訓練日,動作,組數,次數,RPE</small><button class="secondary full" id="createTemplateBtn" type="button">建立模板</button></div><div id="trainingPlanMessage" class="form-message"></div>`;document.getElementById("assignTemplateBtn").onclick=assignTemplate;document.getElementById("createTemplateBtn").onclick=createTemplate}catch(e){trainingPlanContent.textContent="訓練計畫載入失敗。"}}
async function assignTemplate(){const templateId=document.getElementById("planTemplate").value,startsOn=document.getElementById("planStartsOn").value,msg=document.getElementById("trainingPlanMessage");if(!templateId||!startsOn){msg.textContent="請選擇模板與開始日期。";return}try{await apiJson("/api/training-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"assign",studentId:currentStudent.id,templateId,startsOn})});await loadTrainingPlans()}catch(e){msg.textContent="指派失敗，請確認日期沒有重複計畫。"}}
async function createTemplate(){const msg=document.getElementById("trainingPlanMessage"),lines=document.getElementById("templateItems").value.split(/\n/).filter(Boolean),items=lines.map(x=>{const p=x.split(",").map(v=>v.trim());return{weekNo:Number(p[0]),dayNo:Number(p[1]),exerciseName:p[2],sets:Number(p[3]),reps:p[4],rpe:p[5]?Number(p[5].replace(/rpe/i,"")):null}}).filter(x=>x.exerciseName),name=document.getElementById("templateName").value.trim();if(!name||!items.length){msg.textContent="請輸入模板名稱與至少一個動作。";return}try{await apiJson("/api/training-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create_template",name,goal:document.getElementById("templateGoal").value,weeks:Number(document.getElementById("templateWeeks").value),items})});await loadTrainingPlans()}catch(e){msg.textContent="模板建立失敗，請確認格式與動作名稱。"}}
