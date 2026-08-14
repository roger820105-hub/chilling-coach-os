
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
    window.chillingRoles = roles;
    setRoleUI(roles);

    if (roles.includes("coach")) {
      await Promise.all([loadStudents(), loadDashboard(),loadCrm()]);
    }
    if (roles.includes("manager") || roles.includes("admin")) await Promise.all([loadRoleRequests(),loadCrm(),...(roles.includes("coach")?[]:[loadStudents()])]);

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
let currentStudent = null, currentDetail=null, currentPackageData=null, packageMode="create", healthRecord=null;
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

const editStudentDialog=document.getElementById("editStudentDialog"),editStudentMessage=document.getElementById("editStudentMessage");
document.getElementById("editStudentBtn").onclick=()=>{if(!currentStudent)return;document.getElementById("editStudentName").value=currentStudent.name||"";document.getElementById("editStudentPhone").value=currentStudent.phone||"";document.getElementById("editStudentBirthday").value=currentStudent.birthday||"";document.getElementById("editStudentStatus").value=currentStudent.status||"active";document.getElementById("editStudentTags").value=(currentStudent.tags||[]).join(", ");document.getElementById("editStudentNote").value=currentStudent.note||"";editStudentMessage.textContent="";const managerBox=document.getElementById("managerTransferFields"),coaches=latestCrm?.coaches||[];managerBox.classList.toggle("hidden",!coaches.length);if(coaches.length)document.getElementById("transferCoachId").innerHTML='<option value="">選擇新教練</option>'+coaches.map(x=>`<option value="${x.coachId}">${escapeHtml(x.coachName)}</option>`).join("");editStudentDialog.showModal()};
document.getElementById("closeEditStudentDialog").onclick=()=>editStudentDialog.close();
document.getElementById("saveStudentEditBtn").onclick=async()=>{const button=document.getElementById("saveStudentEditBtn"),body={studentId:currentStudent.id,action:"update",name:document.getElementById("editStudentName").value.trim(),phone:document.getElementById("editStudentPhone").value.trim(),birthday:document.getElementById("editStudentBirthday").value||null,status:document.getElementById("editStudentStatus").value,tags:document.getElementById("editStudentTags").value.split(",").map(x=>x.trim()).filter(Boolean),note:document.getElementById("editStudentNote").value.trim()};if(!body.name||!body.phone){editStudentMessage.textContent="姓名與電話為必填。";editStudentMessage.className="form-message error";return}button.disabled=true;button.textContent="儲存中…";try{const d=await apiJson("/api/students",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});currentStudent={...currentStudent,...d.student};editStudentDialog.close();document.getElementById("studentDialog").close();await loadStudents();await openStudent(currentStudent)}catch(e){editStudentMessage.textContent=e.message;editStudentMessage.className="form-message error"}finally{button.disabled=false;button.textContent="儲存修改"}};
document.getElementById("transferStudentBtn").onclick=async()=>{const coachId=document.getElementById("transferCoachId").value,reason=document.getElementById("transferReason").value.trim();if(!coachId||!reason){editStudentMessage.textContent="請選擇新教練並填寫轉移原因。";editStudentMessage.className="form-message error";return}if(!confirm("確定轉移主要教練？新教練將可查看完整學員歷史。"))return;try{await apiJson("/api/students",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({studentId:currentStudent.id,action:"transfer",coachId,reason})});editStudentDialog.close();document.getElementById("studentDialog").close();await Promise.all([loadStudents(),loadCrm()])}catch(e){editStudentMessage.textContent=e.message;editStudentMessage.className="form-message error"}};
document.getElementById("archiveStudentBtn").onclick=async()=>{if(!currentStudent)return;const reason=prompt("請輸入封存原因（既有紀錄不會被刪除）：");if(!reason)return;if(!confirm(`確定封存「${currentStudent.name}」？封存後不會出現在日常名單。`))return;try{await apiJson("/api/students",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({studentId:currentStudent.id,action:"archive",reason})});editStudentDialog.close();document.getElementById("studentDialog").close();await Promise.all([loadStudents(),loadCrm()])}catch(e){editStudentMessage.textContent=e.message;editStudentMessage.className="form-message error"}};

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
  const d=await apiJson(`/api/student-detail?student_id=${encodeURIComponent(studentId)}`);currentDetail=d;const body=document.getElementById("dialogBody"), latest=d.measurements.at(-1), completed=d.sessions.filter(x=>x.status==="completed").length;
  const points=d.measurements.slice(-8), values=points.map(x=>Number(x.weight_kg)).filter(Number.isFinite), min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):0,span=max-min||1;
  const bars=points.map(x=>{const v=Number(x.weight_kg);return Number.isFinite(v)?`<div class="trend-bar" style="height:${24+((v-min)/span)*56}px" title="${escapeHtml(String(v))} kg"><span>${escapeHtml(String(v))}</span></div>`:""}).join("");
  const assessment=d.assessments[0], activeGoals=d.goals.filter(x=>x.status==="active");
  const recordButtons=(type,x)=>`<span class="row-actions"><button type="button" onclick="editHealthRecord('${type}','${x.id}')">編輯</button><button type="button" class="danger-link" onclick="archiveHealthRecord('${type}','${x.id}')">作廢</button></span>`;
  body.insertAdjacentHTML("beforeend",`<div class="detail-grid v12-detail"><div><small>累積完成</small><b>${completed} 堂</b></div><div><small>最近身體數據</small><b>${latest?`${latest.weight_kg??"—"} kg / ${latest.body_fat_pct??"—"}%`:"尚未記錄"}</b></div><div><small>評估</small><b>${d.assessments.length} 筆</b></div><div><small>進行中目標</small><b>${activeGoals.length} 個</b></div></div><div class="health-panels"><div><div class="eyebrow">體重趨勢</div>${bars?`<div class="trend-chart">${bars}</div>`:"<p class=\"muted\">新增至少一筆體重後顯示趨勢。</p>"}</div><div><div class="eyebrow">身體紀錄</div>${d.measurements.length?d.measurements.slice(-6).reverse().map(x=>`<div class="editable-row"><span>${formatDateTW(x.measured_at)}｜${x.weight_kg??"—"} kg｜體脂 ${x.body_fat_pct??"—"}%</span>${recordButtons("measurement",x)}</div>`).join(""):"<p>尚無紀錄</p>"}</div><div><div class="eyebrow">評估紀錄</div>${d.assessments.length?d.assessments.slice(0,6).map(x=>`<div class="editable-row"><span>${formatDateTW(x.assessed_at)}｜${escapeHtml(x.assessment_type)}</span>${recordButtons("assessment",x)}</div>`).join(""):"<p>尚無評估</p>"}</div><div><div class="eyebrow">會員目標</div>${activeGoals.length?activeGoals.map(x=>`<div class="editable-row"><span><b>${escapeHtml(x.title)}</b>${x.target_value!=null?`｜${x.target_value} ${escapeHtml(x.unit||"")}`:""}${x.target_date?`｜${escapeHtml(x.target_date)}`:""}</span>${recordButtons("goal",x)}</div>`).join(""):"<p>尚無進行中目標</p>"}</div><div><div class="eyebrow">近期已完成課程</div>${d.sessions.filter(x=>x.status==="completed").slice(0,6).map(x=>`<div class="editable-row"><span>${formatDateTW(x.completed_at||x.scheduled_at)}</span><button type="button" onclick="restoreCompletedSession('${x.id}')">復原並補回堂數</button></div>`).join("")||"<p>尚無已完成課程</p>"}</div></div>`);
 }catch(e){console.error(e)}
}

const healthDialog=document.getElementById("healthDialog"),healthForm=document.getElementById("healthForm"),healthMessage=document.getElementById("healthMessage");let healthType="measurement";
function input(label,id,type="text",extra=""){return `<label class="field-label" for="${id}">${label}</label><input id="${id}" class="text-input" type="${type}" ${extra}/>`}
function localDateTime(value){if(!value)return"";const d=new Date(value),offset=d.getTimezoneOffset()*60000;return new Date(d-offset).toISOString().slice(0,16)}
function openHealth(type,record=null){healthType=type;healthRecord=record;healthMessage.textContent="";document.getElementById("healthDialogTitle").textContent=`${record?"編輯":"新增"}${type==="measurement"?"身體數據":type==="assessment"?"會員評估":"會員目標"}`;healthForm.innerHTML=type==="measurement"?`${input("測量時間","healthDate","datetime-local")}${input("體重 kg","healthWeight","number",'step="0.1" min="1"')}${input("體脂 %","healthFat","number",'step="0.1" min="0" max="100"')}${input("肌肉量 kg","healthMuscle","number",'step="0.1" min="0"')}${input("腰圍 cm","healthWaist","number",'step="0.1" min="0"')}${input("臀圍 cm","healthHip","number",'step="0.1" min="0"')}${input("胸圍 cm","healthChest","number",'step="0.1" min="0"')}${input("備註","healthNote")}`:type==="assessment"?`${input("評估類型 *","healthAssessmentType")}${input("評估時間","healthDate","datetime-local")}${input("摘要","healthSummary")}${input("傷病","healthInjuries")}${input("動作／訓練限制","healthLimitations")}${input("備註","healthNote")}`:`${input("目標名稱 *","healthGoalTitle")}${input("目標說明","healthGoalDescription")}${input("目標數值","healthTargetValue","number",'step="0.1"')}${input("單位","healthUnit")}${input("目標日期","healthTargetDate","date")}`;if(record){const set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v??""};if(type==="measurement"){set("healthDate",localDateTime(record.measured_at));set("healthWeight",record.weight_kg);set("healthFat",record.body_fat_pct);set("healthMuscle",record.muscle_mass_kg);set("healthWaist",record.waist_cm);set("healthHip",record.hip_cm);set("healthChest",record.chest_cm);set("healthNote",record.note)}else if(type==="assessment"){set("healthAssessmentType",record.assessment_type);set("healthDate",localDateTime(record.assessed_at));set("healthSummary",record.results?.summary);set("healthInjuries",record.injuries);set("healthLimitations",record.limitations);set("healthNote",record.note)}else{set("healthGoalTitle",record.title);set("healthGoalDescription",record.description);set("healthTargetValue",record.target_value);set("healthUnit",record.unit);set("healthTargetDate",record.target_date)}}healthDialog.showModal()}
document.getElementById("openMeasurementBtn").onclick=()=>openHealth("measurement");document.getElementById("openAssessmentBtn").onclick=()=>openHealth("assessment");document.getElementById("openGoalBtn").onclick=()=>openHealth("goal");document.getElementById("closeHealthDialog").onclick=()=>healthDialog.close();document.getElementById("closeStudentDialog").onclick=document.getElementById("closeStudentDialogBottom").onclick=()=>document.getElementById("studentDialog").close();
document.getElementById("saveHealthBtn").onclick=async()=>{const v=id=>document.getElementById(id)?.value||"",payload={studentId:currentStudent.id,type:healthType,action:healthRecord?"update":"create",recordId:healthRecord?.id};if(healthType==="measurement")Object.assign(payload,{measuredAt:v("healthDate")?new Date(v("healthDate")).toISOString():null,weightKg:v("healthWeight"),bodyFatPct:v("healthFat"),muscleMassKg:v("healthMuscle"),waistCm:v("healthWaist"),hipCm:v("healthHip"),chestCm:v("healthChest"),note:v("healthNote")});else if(healthType==="assessment")Object.assign(payload,{assessmentType:v("healthAssessmentType"),assessedAt:v("healthDate")?new Date(v("healthDate")).toISOString():null,summary:v("healthSummary"),injuries:v("healthInjuries"),limitations:v("healthLimitations"),note:v("healthNote")});else Object.assign(payload,{title:v("healthGoalTitle"),description:v("healthGoalDescription"),targetValue:v("healthTargetValue"),unit:v("healthUnit"),targetDate:v("healthTargetDate")});healthMessage.textContent="儲存中…";try{await apiJson("/api/student-health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});healthDialog.close();document.getElementById("studentDialog").close();await openStudent(currentStudent)}catch(e){healthMessage.textContent=e.message||"儲存失敗，請確認必填欄位與數值。";healthMessage.className="form-message error"}};
window.editHealthRecord=(type,id)=>{const list=type==="measurement"?currentDetail.measurements:type==="assessment"?currentDetail.assessments:currentDetail.goals,record=list.find(x=>x.id===id);if(record)openHealth(type,record)};
window.archiveHealthRecord=async(type,id)=>{if(!confirm("確定作廢這筆紀錄？紀錄仍會保留在稽核歷史中。"))return;try{await apiJson("/api/student-health",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({studentId:currentStudent.id,type,action:"archive",recordId:id})});document.getElementById("studentDialog").close();await openStudent(currentStudent)}catch(e){alert(e.message)}};
window.restoreCompletedSession=async id=>{const reason=prompt("請輸入復原原因（系統會自動補回 1 堂）：");if(!reason)return;try{await apiJson("/api/crm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"restore_session",sessionId:id,reason})});alert("課程已復原，堂數已自動補回。 ");document.getElementById("studentDialog").close();await openStudent(currentStudent);await loadCrm()}catch(e){alert(e.message)}};

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
    const pkg=payload.package;currentPackageData=payload;
    if(!pkg){box.innerHTML="<b>目前沒有有效方案</b><br>請建立方案後再進行預約與扣堂。";return;}
    const history=(payload.packages||[]).map(x=>`<div class="editable-row"><span>${escapeHtml(x.package_name||`${x.purchased_sessions}堂方案`)}｜剩 ${x.remaining_sessions}/${x.purchased_sessions} 堂｜${x.status==="active"?"使用中":"歷史"}</span>${x.id===pkg.id?'<button type="button" onclick="openPackageEditor()">修正方案</button>':""}</div>`).join("");
    box.innerHTML=`<b>${escapeHtml(pkg.package_name||`${pkg.purchased_sessions}堂方案`)}</b><br>剩餘：${pkg.remaining_sessions} / ${pkg.purchased_sessions} 堂${pkg.expires_at?`<br>有效至：${escapeHtml(pkg.expires_at)}`:""}${Number(pkg.price)>0?`<br>金額：NT$${Number(pkg.price).toLocaleString()}`:""}<div class="package-history"><div class="eyebrow">方案紀錄</div>${history}</div>`;
  }catch(e){console.error(e);box.textContent="方案資料讀取失敗。";}
}
const packageDialog=document.getElementById("packageDialog");
const packageMessage=document.getElementById("packageMessage");
document.getElementById("openPackageBtn").onclick=()=>{
  if(!currentStudent)return;
  packageMode="create";
  document.getElementById("packageStudentName").textContent=`${currentStudent.name}｜建立課程方案`;
  ["packageName","packageSessions","packagePrice","packageExpiresAt"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("packageEditFields").classList.add("hidden");document.getElementById("savePackageBtn").textContent="建立方案";
  packageMessage.textContent="";
  packageDialog.showModal();
};
window.openPackageEditor=()=>{const p=currentPackageData?.package;if(!p)return;packageMode="edit";document.getElementById("packageStudentName").textContent=`${currentStudent.name}｜修正課程方案`;document.getElementById("packageName").value=p.package_name||"";document.getElementById("packageSessions").value=p.purchased_sessions;document.getElementById("packageRemaining").value=p.remaining_sessions;document.getElementById("packagePrice").value=p.price||0;document.getElementById("packageExpiresAt").value=p.expires_at||"";document.getElementById("packagePaymentStatus").value=p.payment_status||"paid";document.getElementById("packageReason").value="";document.getElementById("packageEditFields").classList.remove("hidden");document.getElementById("savePackageBtn").textContent="確認並儲存修正";packageMessage.textContent="";packageDialog.showModal()};
document.getElementById("closePackageDialog").onclick=()=>packageDialog.close();
document.getElementById("savePackageBtn").onclick=async()=>{
  const purchasedSessions=Number(document.getElementById("packageSessions").value);
  if(!Number.isInteger(purchasedSessions)||purchasedSessions<=0){packageMessage.textContent="請輸入正確的購買堂數。";packageMessage.className="form-message error";return;}
  try{
    packageMessage.textContent=packageMode==="edit"?"正在核對並儲存修正…":"正在建立方案…";
    if(packageMode==="edit"){
      const p=currentPackageData.package,remaining=Number(document.getElementById("packageRemaining").value),reason=document.getElementById("packageReason").value.trim();if(!reason){throw new Error("請填寫修改原因")};if(!Number.isInteger(remaining)||remaining<0||remaining>purchasedSessions)throw new Error("剩餘堂數不可大於購買堂數");
      await apiJson("/api/packages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"adjust",packageId:p.id,purchasedSessions,remainingSessions:remaining,reason})});
      await apiJson("/api/packages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update",packageId:p.id,packageName:document.getElementById("packageName").value.trim(),price:Number(document.getElementById("packagePrice").value||0),paymentStatus:document.getElementById("packagePaymentStatus").value,expiresAt:document.getElementById("packageExpiresAt").value||null,reason})});
      packageMessage.textContent="方案修正已儲存，並保留調整紀錄。";packageMessage.className="form-message ok";await loadStudentPackage(currentStudent.id);setTimeout(()=>packageDialog.close(),500);return;
    }
    const response=await fetch("/api/packages",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${window.chillingLineAccessToken}`},body:JSON.stringify({
      action:"create",
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
  }catch(e){console.error(e);packageMessage.textContent=e.message||"建立失敗，請稍後再試。";packageMessage.className="form-message error";}
};

let latestCrm=null;
function csvCell(value){return `"${String(value??"").replace(/"/g,'""')}"`}
document.getElementById("exportBtn").onclick=()=>{if(!latestCrm)return alert("學生營運資料尚未載入完成。");const lines=[["教練","有效學員","總剩餘堂數","需續約人數","本月業績","本月完成課程","預估續約營收"],...latestCrm.coaches.map(x=>[x.coachName,x.students,x.remaining,x.renewalDue,x.monthlySales,x.completedSessions,x.forecast]),[],["續約學員","教練","剩餘堂數","到期日","預估金額","機率","狀態"],...latestCrm.renewals.map(x=>[x.studentName,x.coachName,x.remaining,x.expiresAt,x.expectedAmount,x.probability+"%",x.status])],csv="\uFEFF"+lines.map(r=>r.map(csvCell).join(",")).join("\r\n"),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=`Chilling-Coach-OS-學生營運-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};

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

// Retired employee attendance/payroll implementation retained in source history only.
if(false){

async function loadOperations(){
 const box=document.getElementById("leaveRequestList"); if(!box)return;
 try{const d=await apiJson("/api/operations"),m=d.metrics;
  latestOperations=d;
  document.getElementById("opsSales").textContent=Number(m.monthlySales).toLocaleString("zh-TW");document.getElementById("opsClasses").textContent=m.groupClasses;document.getElementById("opsHours").textContent=m.workHours;document.getElementById("opsOvertime").textContent=m.overtimeHours;document.getElementById("opsLeaves").textContent=m.pendingLeaves;
  document.getElementById("opsAdapterState").textContent=m.activeAdapters?`已有 ${m.activeAdapters} 個營運資料介面啟用。`:`Google Sheets 與薪資規則尚未啟用，等待實際欄位與規則。`;
  document.getElementById("staffMonthlyRows").innerHTML=d.staff.length?d.staff.map(x=>`<tr><td><b>${escapeHtml(x.display_name)}</b></td><td>${x.work_hours} 小時</td><td>${x.overtime_hours} 小時</td><td>${x.leave_hours} 小時</td></tr>`).join(""):`<tr><td colspan="4">本月尚無已配對員工資料。</td></tr>`;
  box.innerHTML=d.leaves.length?d.leaves.map(x=>`<div class="approval-row"><div><b>${escapeHtml(x.display_name)}｜${escapeHtml(x.leave_type)}</b><span>${new Date(x.starts_at).toLocaleString("zh-TW")} ～ ${new Date(x.ends_at).toLocaleString("zh-TW")}${x.reason?`<br>${escapeHtml(x.reason)}`:""}</span></div><div><button class="primary" onclick="reviewLeave('${x.id}',true)">核准</button><button class="secondary" onclick="reviewLeave('${x.id}',false)">拒絕</button></div></div>`).join(""):`<div class="load-state empty">目前沒有待審核請假。</div>`;
 }catch(e){box.textContent="營運資料載入失敗。"}
}
window.reviewLeave=async(id,approve)=>{if(!confirm(approve?"確定核准此請假？":"確定拒絕此請假？"))return;try{await apiJson("/api/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:id,approve})});await loadOperations()}catch(e){alert("審核失敗，請重新整理後再試。")}};
document.getElementById("refreshOperations").onclick=loadOperations;

async function loadSheetMappings(){const box=document.getElementById("sheetMappingList");if(!box)return;try{const d=await apiJson("/api/operations?scope=sheet_mappings"),mapped=Object.fromEntries(d.mappings.map(x=>[x.external_key,x.user_id])),warning=d.warnings?.length?`<p class="muted">部分資料尚未就緒（${d.warnings.join(", ")}）。</p>`:"";box.innerHTML=warning+d.sheetNames.map((name,i)=>`<div class="mapping-row"><b>${escapeHtml(name)}</b><select class="text-input" id="sheetMap${i}"><option value="">尚未配對</option>${d.users.map(u=>`<option value="${u.id}" ${mapped[name]===u.id?"selected":""}>${escapeHtml(u.display_name)}</option>`).join("")}</select><button class="secondary" onclick="saveSheetMapping('${escapeHtml(name)}','sheetMap${i}')">儲存</button></div>`).join("")}catch(e){box.textContent=`姓名配對資料載入失敗：${e.message||"未知錯誤"}`}}
window.saveSheetMapping=async(name,selectId)=>{const userId=document.getElementById(selectId).value;if(!userId)return alert("請先選擇 LINE 教練帳號。");try{await apiJson("/api/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"map_sheet_staff",externalName:name,userId})});alert("配對已儲存。")}catch(e){alert(`配對儲存失敗：${e.message||"未知錯誤"}`)}};document.getElementById("refreshSheetMappings").onclick=loadSheetMappings;

const leaveDialog=document.getElementById("leaveDialog");
const statusLabels={pending:"審核中",approved:"已核准",rejected:"已拒絕",cancelled:"已取消"};
async function loadMyOperations(){
 try{const d=await apiJson("/api/operations?scope=me");document.getElementById("myWorkHours").textContent=d.metrics.monthHours;document.getElementById("myOvertimeHours").textContent=d.metrics.overtimeHours;document.getElementById("clockState").textContent=d.metrics.clockedIn?`已於 ${new Date(d.openWorkLog.started_at).toLocaleString("zh-TW")} 上班打卡`:`目前尚未上班打卡`;
  document.getElementById("clockInBtn").disabled=d.metrics.clockedIn;document.getElementById("clockOutBtn").disabled=!d.metrics.clockedIn;
  document.getElementById("myShiftList").innerHTML=d.shifts.length?d.shifts.map(x=>`<div><b>${new Date(x.starts_at).toLocaleString("zh-TW")} ～ ${new Date(x.ends_at).toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}</b><span>${escapeHtml(x.status)}${x.note?`｜${escapeHtml(x.note)}`:""}</span></div>`).join(""):`<div class="muted">目前沒有近期班表。</div>`;
  document.getElementById("myLeaveList").innerHTML=d.leaves.length?d.leaves.map(x=>`<div><b>${escapeHtml(x.leave_type)}｜${new Date(x.starts_at).toLocaleString("zh-TW")}</b><span class="status-text ${escapeHtml(x.status)}">${statusLabels[x.status]||escapeHtml(x.status)}</span></div>`).join(""):`<div class="muted">目前沒有請假紀錄。</div>`;
 }catch(e){console.error(e);document.getElementById("clockState").textContent="工時資料載入失敗。"}
}
async function clock(action){try{await apiJson("/api/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action})});await loadMyOperations()}catch(e){alert(action==="clock_in"?"無法上班打卡，可能已有未結束的工時。":"無法下班打卡，請確認已先上班打卡。")}}
document.getElementById("clockInBtn").onclick=()=>clock("clock_in");document.getElementById("clockOutBtn").onclick=()=>clock("clock_out");document.getElementById("openLeaveBtn").onclick=()=>{document.getElementById("leaveMessage").textContent="";leaveDialog.showModal()};document.getElementById("closeLeaveDialog").onclick=()=>leaveDialog.close();
document.getElementById("submitLeaveBtn").onclick=async()=>{const msg=document.getElementById("leaveMessage"),body={action:"request_leave",leaveType:document.getElementById("leaveType").value,startsAt:document.getElementById("leaveStartsAt").value,endsAt:document.getElementById("leaveEndsAt").value,reason:document.getElementById("leaveReason").value};try{msg.textContent="正在送出…";await apiJson("/api/operations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});msg.textContent="請假申請已送出。";msg.className="form-message ok";await loadMyOperations();setTimeout(()=>leaveDialog.close(),500)}catch(e){msg.textContent="送出失敗，請確認假別與時間。";msg.className="form-message error"}};
}

async function loadCrm(){
 try{
  const d=await apiJson("/api/crm");latestCrm=d;
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  set("crmStudents",d.metrics.students);set("crmRemaining",d.metrics.totalRemaining);set("crmRenewals",d.metrics.renewalDue);set("crmForecast",Number(d.metrics.forecast).toLocaleString("zh-TW"));
  set("messageUsage",`LINE 主動訊息：本月 ${d.messageUsage.sent_count} / ${d.messageUsage.monthly_limit} 則`);
  const p=d.preferences||{};document.getElementById("prefClasses").checked=p.class_reminders!==false;document.getElementById("prefRenewals").checked=p.renewal_reminders!==false;document.getElementById("prefManager").checked=p.manager_digest!==false;document.getElementById("prefQuietStart").value=String(p.quiet_start||"21:00").slice(0,5);document.getElementById("prefQuietEnd").value=String(p.quiet_end||"08:00").slice(0,5);document.getElementById("prefManagerRow").classList.toggle("hidden",!(window.chillingRoles||[]).some(x=>["manager","admin"].includes(x)));
  set("crmInsight",d.renewals.length?`優先聯絡 ${d.renewals.slice(0,3).map(x=>x.studentName).join("、")}；共 ${d.renewals.length} 位進入續約區間。`:"目前沒有進入續約區間的學員。");
  const table=document.getElementById("coachPerformanceRows");if(table)table.innerHTML=d.coaches.length?d.coaches.map(x=>`<tr><td><b>${escapeHtml(x.coachName)}</b></td><td>${x.students}</td><td>${x.remaining}</td><td>${x.renewalDue}</td><td>NT$${Number(x.monthlySales).toLocaleString("zh-TW")}</td><td>NT$${Number(x.forecast).toLocaleString("zh-TW")}</td></tr>`).join(""):`<tr><td colspan="6">目前尚無教練學員資料。</td></tr>`;
  const box=document.getElementById("coachRenewalList");if(box){const mine=d.renewals.filter(x=>!window.chillingUser||x.coachId===window.chillingUser.id);box.innerHTML=mine.length?mine.map(x=>`<div><b>${escapeHtml(x.studentName)}｜剩 ${x.remaining} 堂</b><span>${x.expiresAt?`到期 ${escapeHtml(x.expiresAt)}｜`:""}預估 NT$${Number(x.expectedAmount).toLocaleString("zh-TW")}｜${x.probability}%</span></div>`).join(""):`<div class="muted">目前沒有需要聯絡的學員。</div>`}
 }catch(e){console.error(e);const box=document.getElementById("coachRenewalList");if(box)box.textContent="續約資料尚未啟用，請先執行 2.0 資料庫升級。"}
}
document.getElementById("refreshCoachCrm").onclick=loadCrm;
document.getElementById("saveReminderPreferences").onclick=async()=>{const btn=document.getElementById("saveReminderPreferences"),msg=document.getElementById("preferenceMessage");btn.disabled=true;msg.textContent="儲存中…";try{await apiJson("/api/crm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update_preferences",classReminders:document.getElementById("prefClasses").checked,renewalReminders:document.getElementById("prefRenewals").checked,managerDigest:document.getElementById("prefManager").checked,quietStart:document.getElementById("prefQuietStart").value,quietEnd:document.getElementById("prefQuietEnd").value})});msg.textContent="已儲存";msg.className="form-message ok"}catch(e){msg.textContent=e.message;msg.className="form-message error"}finally{btn.disabled=false}};

const trainingPlanDialog=document.getElementById("trainingPlanDialog"),trainingPlanContent=document.getElementById("trainingPlanContent");
document.getElementById("closeTrainingPlanDialog").onclick=()=>trainingPlanDialog.close();
document.getElementById("openTrainingPlanBtn").onclick=async()=>{trainingPlanDialog.showModal();trainingPlanContent.innerHTML="<div class=\"load-state\">正在載入訓練計畫…</div>";await loadTrainingPlans()};
async function loadTrainingPlans(){try{const d=await apiJson(`/api/training-plans?student_id=${encodeURIComponent(currentStudent.id)}`),next=d.workouts.filter(x=>x.status==="planned").slice(0,8),active=d.plans.filter(x=>x.status==="active");trainingPlanContent.innerHTML=`<div class="plan-section"><h3>指派模板</h3><select id="planTemplate" class="text-input"><option value="">選擇模板</option>${d.templates.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join("")}</select>${input("開始日期","planStartsOn","date")}<button class="primary full" id="assignTemplateBtn" type="button">指派給學員</button></div><div class="plan-section"><h3>使用中的計畫</h3>${active.length?active.map(x=>`<div class="editable-row"><span>${escapeHtml(x.name)}｜${escapeHtml(x.starts_on)}</span><button onclick="cancelTrainingPlan('${x.id}')">取消計畫</button></div>`).join(""):"<p>目前沒有使用中的計畫。</p>"}</div><div class="plan-section"><h3>未來課表</h3>${next.length?next.map(x=>`<div class="planned-row"><div class="editable-row"><b>${escapeHtml(x.planned_for)}｜${escapeHtml(x.title||"訓練")}</b><button onclick="editWorkoutDate('${x.id}','${x.planned_for}')">修改日期</button></div>${(x.items||[]).map(i=>`<span>${escapeHtml(i.exercise_name)}｜${i.sets??"—"}組 × ${escapeHtml(i.reps??"—")}${i.rpe?`｜RPE ${i.rpe}`:""}</span>`).join("")}</div>`).join(""):"<p>尚未指派訓練計畫。</p>"}</div><div class="plan-section"><h3>建立新模板</h3>${input("模板名稱 *","templateName")}${input("目標","templateGoal")}${input("週數","templateWeeks","number",'min="1" value="1"')}<textarea id="templateItems" class="text-input textarea-input" placeholder="每行一個動作，例如：&#10;1,1,Back squat,3,8,RPE7&#10;1,2,Bench press,3,10,RPE8"></textarea><small>格式：週次,訓練日,動作,組數,次數,RPE</small><button class="secondary full" id="createTemplateBtn" type="button">建立模板</button></div><div id="trainingPlanMessage" class="form-message"></div>`;document.getElementById("assignTemplateBtn").onclick=assignTemplate;document.getElementById("createTemplateBtn").onclick=createTemplate}catch(e){trainingPlanContent.textContent="訓練計畫載入失敗。"}}
window.cancelTrainingPlan=async id=>{const reason=prompt("請輸入取消計畫的原因：");if(!reason)return;try{await apiJson("/api/training-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"cancel_plan",planId:id,reason})});await loadTrainingPlans()}catch(e){alert(e.message)}};
window.editWorkoutDate=async(id,current)=>{const plannedFor=prompt("請輸入新的日期（YYYY-MM-DD）：",current);if(!plannedFor||plannedFor===current)return;const reason=prompt("請輸入修改日期的原因：");if(!reason)return;try{await apiJson("/api/training-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update_workout",workoutId:id,plannedFor,reason})});await loadTrainingPlans()}catch(e){alert(e.message)}};
async function assignTemplate(){const templateId=document.getElementById("planTemplate").value,startsOn=document.getElementById("planStartsOn").value,msg=document.getElementById("trainingPlanMessage");if(!templateId||!startsOn){msg.textContent="請選擇模板與開始日期。";return}try{await apiJson("/api/training-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"assign",studentId:currentStudent.id,templateId,startsOn})});await loadTrainingPlans()}catch(e){msg.textContent="指派失敗，請確認日期沒有重複計畫。"}}
async function createTemplate(){const msg=document.getElementById("trainingPlanMessage"),lines=document.getElementById("templateItems").value.split(/\n/).filter(Boolean),items=lines.map(x=>{const p=x.split(",").map(v=>v.trim());return{weekNo:Number(p[0]),dayNo:Number(p[1]),exerciseName:p[2],sets:Number(p[3]),reps:p[4],rpe:p[5]?Number(p[5].replace(/rpe/i,"")):null}}).filter(x=>x.exerciseName),name=document.getElementById("templateName").value.trim();if(!name||!items.length){msg.textContent="請輸入模板名稱與至少一個動作。";return}try{await apiJson("/api/training-plans",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"create_template",name,goal:document.getElementById("templateGoal").value,weeks:Number(document.getElementById("templateWeeks").value),items})});await loadTrainingPlans()}catch(e){msg.textContent="模板建立失敗，請確認格式與動作名稱。"}}
