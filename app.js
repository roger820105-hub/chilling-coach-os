
// ===== LINE MINI App / LIFF identity test =====
// Developing LIFF ID for Chilling Coach OS
const LIFF_ID = "2011008227-7rnEFNrI";

async function initLineIdentity() {
  const greeting = document.getElementById("lineGreeting");
  const status = document.getElementById("lineStatus");

  if (typeof liff === "undefined") {
    greeting.textContent = "LINE SDK 載入失敗";
    status.textContent = "LINE SDK 未載入";
    status.className = "line-status error";
    return;
  }

  try {
    await liff.init({
      liffId: LIFF_ID,
      withLoginOnExternalBrowser: true
    });

    // In the LIFF browser, login is normally handled automatically.
    // In an external browser, withLoginOnExternalBrowser will initiate login.
    if (!liff.isLoggedIn()) {
      greeting.textContent = "等待 LINE 登入…";
      status.textContent = "尚未登入 LINE";
      status.className = "line-status warn";
      return;
    }

    const profile = await liff.getProfile();

    // Display only in the client UI for this test.
    greeting.textContent = `早安，${profile.displayName}`;
    status.textContent = liff.isInClient()
      ? "LINE 身分已連線"
      : "LINE 身分已連線（外部瀏覽器）";
    status.className = "line-status ok";

    // Keep identity locally in memory only; do not send profile data to a server.
    window.chillingLineIdentity = {
      displayName: profile.displayName,
      userId: profile.userId
    };

    console.log("LIFF initialized:", {
      isInClient: liff.isInClient(),
      os: liff.getOS(),
      displayName: profile.displayName
    });
  } catch (error) {
    console.error("LIFF init error:", error);
    greeting.textContent = "LINE 身分辨識失敗（Demo 仍可使用）";
    status.textContent = "LINE 連線失敗";
    status.className = "line-status error";
  }
}

document.addEventListener("DOMContentLoaded", initLineIdentity);
// ===== End LINE identity test =====


const students = [
 {name:"王小明",remaining:6,total:24,freq:1.8,last:"8/6",eta:"9/2",renew:"8/25–9/5",status:"renewal",label:"即將續約",prob:78},
 {name:"陳小華",remaining:15,total:24,freq:0.8,last:"7/26",eta:"12/18",renew:"需先恢復頻率",status:"risk",label:"高風險",prob:39},
 {name:"林怡君",remaining:11,total:24,freq:2.0,last:"8/5",eta:"9/15",renew:"9/5–9/15",status:"stable",label:"穩定",prob:84},
 {name:"黃志偉",remaining:4,total:12,freq:1.2,last:"8/3",eta:"8/31",renew:"8/20–8/31",status:"renewal",label:"即將續約",prob:69},
 {name:"張雅婷",remaining:20,total:36,freq:2.3,last:"8/6",eta:"10/10",renew:"9/28–10/10",status:"stable",label:"穩定",prob:88},
 {name:"李承翰",remaining:9,total:24,freq:0.6,last:"7/22",eta:"長期延後",renew:"需立即關懷",status:"risk",label:"高風險",prob:31}
];

const list = document.getElementById("studentList");
function render(filter="all"){
 list.innerHTML = "";
 students.filter(s=>filter==="all"||s.status===filter).forEach(s=>{
   const el=document.createElement("div");
   el.className="card student-card";
   const used=s.total-s.remaining, pct=Math.round(used/s.total*100);
   el.innerHTML=`<div class="student-top"><h4>${s.name}</h4><span class="status-${s.status}">${s.label}</span></div>
   <div class="student-meta">
     <div><small>剩餘堂數</small><b>${s.remaining} / ${s.total}</b></div>
     <div><small>平均頻率</small><b>${s.freq} 堂/週</b></div>
     <div><small>預估完課</small><b>${s.eta}</b></div>
     <div><small>續約機率</small><b>${s.prob}%</b></div>
   </div><div class="progress"><i style="width:${pct}%"></i></div>`;
   el.onclick=()=>openStudent(s);
   list.appendChild(el);
 });
}
render();

document.getElementById("studentFilter").onchange=e=>render(e.target.value);
const coachView=document.getElementById("coachView"), managerView=document.getElementById("managerView");
document.getElementById("coachBtn").onclick=()=>{coachView.classList.remove("hidden");managerView.classList.add("hidden");coachBtn.classList.add("active");managerBtn.classList.remove("active")};
document.getElementById("managerBtn").onclick=()=>{managerView.classList.remove("hidden");coachView.classList.add("hidden");managerBtn.classList.add("active");coachBtn.classList.remove("active")};

function openStudent(s){
 document.getElementById("dialogName").textContent=s.name;
 document.getElementById("dialogBody").innerHTML=`
 <div class="detail-grid">
  <div><small>剩餘堂數</small><b>${s.remaining} 堂</b></div>
  <div><small>平均頻率</small><b>${s.freq} 堂/週</b></div>
  <div><small>最近上課</small><b>${s.last}</b></div>
  <div><small>預估續約</small><b>${s.renew}</b></div>
 </div>
 <div class="eyebrow">最近課表</div>
 <div class="timeline">
  <p><b>8/6</b> 下肢力量｜深蹲、RDL、弓箭步</p>
  <p><b>8/2</b> 上肢拉｜划船、下拉、核心</p>
  <p><b>7/29</b> 全身循環｜動作品質＋心肺</p>
 </div>`;
 document.getElementById("studentDialog").showModal();
}

window.completeSession=function(name){
 const s=students.find(x=>x.name===name);
 if(s && s.remaining>0){s.remaining--; s.last="今天"; render(document.getElementById("studentFilter").value);}
 alert(`${name} 今日課程已完成，剩餘堂數已自動 -1，預估完課日將重新計算。`);
}

document.getElementById("addStudent").onclick=()=>alert("MVP 下一步：串接資料庫後，這裡會開啟新增學員表單。");
document.getElementById("exportBtn").onclick=()=>alert("MVP 下一步：可輸出 Excel / PDF 月報，或每日自動推送至主管 LINE。");
