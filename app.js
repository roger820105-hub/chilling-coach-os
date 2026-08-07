
// ===== LINE MINI App / V3 secure account bootstrap =====
const LIFF_ID = "2011008227-7rnEFNrI";

function setRoleUI(roles) {
  const coachBtn = document.getElementById("coachBtn");
  const managerBtn = document.getElementById("managerBtn");
  const roleSwitch = document.getElementById("roleSwitch");
  const coachView = document.getElementById("coachView");
  const managerView = document.getElementById("managerView");

  const isCoach = roles.includes("coach");
  const isManager = roles.includes("manager") || roles.includes("admin");

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
      await loadStudents();
    }

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
        <h4>${escapeHtml(s.name)}</h4>
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

function openStudent(s){
 document.getElementById("dialogName").textContent=s.name;
 document.getElementById("dialogBody").innerHTML=`
 <div class="detail-grid">
  <div><small>狀態</small><b>${s.status === "active" ? "進行中" : (s.status === "paused" ? "暫停" : "停用")}</b></div>
  <div><small>加入日期</small><b>${formatDateTW(s.joined_at)}</b></div>
  <div><small>電話</small><b>${s.phone ? escapeHtml(s.phone) : "—"}</b></div>
  <div><small>教練關係</small><b>主要教練</b></div>
 </div>
 <div class="eyebrow">備註</div>
 <div class="timeline">
  <p>${s.note ? escapeHtml(s.note) : "尚無備註"}</p>
 </div>
 <div class="callout">V4 已完成真實學員資料。剩餘堂數、上課紀錄與續約預測會在下一階段接上 packages / sessions。</div>`;
 document.getElementById("studentDialog").showModal();
}

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

  if(!name){
    addStudentMessage.textContent="請輸入學員姓名。";
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
    addStudentMessage.textContent="建立失敗，請稍後再試。";
    addStudentMessage.className="form-message error";
  }finally{
    saveStudentBtn.disabled=false;
    saveStudentBtn.textContent="建立學員";
  }
};

document.getElementById("exportBtn").onclick=()=>alert("MVP 下一步：可輸出 Excel / PDF 月報，或每日自動推送至主管 LINE。");
