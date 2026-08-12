import crypto from "node:crypto";

const json = (data, status=200) => new Response(JSON.stringify(data), {
  status,
  headers: {"Content-Type":"application/json; charset=utf-8"}
});

function verifySignature(raw, signature, secret){
  if(!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

async function lineReply(replyToken, text, token){
  const r = await fetch("https://api.line.me/v2/bot/message/reply",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      replyToken,
      messages:[{type:"text",text}]
    })
  });

  if(!r.ok) throw new Error(`LINE_REPLY:${await r.text()}`);
}

const dbHeaders = secret => ({
  apikey:secret,
  Authorization:`Bearer ${secret}`,
  "Content-Type":"application/json"
});

async function getUser(url, secret, lineUserId){
  const h=dbHeaders(secret);

  const r=await fetch(
    `${url}/rest/v1/users?line_user_id=eq.${encodeURIComponent(lineUserId)}&is_active=eq.true&select=id,display_name`,
    {headers:h}
  );

  if(!r.ok) throw new Error(await r.text());

  const rows=await r.json();

  if(!rows[0]) return null;

  const rr=await fetch(
    `${url}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(rows[0].id)}&select=role`,
    {headers:h}
  );

  if(!rr.ok) throw new Error(await rr.text());

  return {
    ...rows[0],
    roles:(await rr.json()).map(x=>x.role)
  };
}

async function getStudents(url, secret, coachId){
  const h=dbHeaders(secret);

  const r=await fetch(
    `${url}/rest/v1/coach_students?coach_id=eq.${encodeURIComponent(coachId)}&ended_at=is.null&select=student_id`,
    {headers:h}
  );

  if(!r.ok) throw new Error(await r.text());

  const ids=[
    ...new Set(
      (await r.json())
        .map(x=>x.student_id)
        .filter(Boolean)
    )
  ];

  if(!ids.length) return [];

  const filter=ids.map(id=>`"${id}"`).join(",");

  const s=await fetch(
    `${url}/rest/v1/students?id=in.(${encodeURIComponent(filter)})&select=id,name,status&order=name.asc`,
    {headers:h}
  );

  if(!s.ok) throw new Error(await s.text());

  return await s.json();
}

async function findStudent(url, secret, coachId, name){
  const all=await getStudents(url,secret,coachId);
  const q=name.trim().toLowerCase();

  const exact=all.filter(
    s=>s.name.trim().toLowerCase()===q
  );

  if(exact.length===1)
    return {status:"ok",student:exact[0]};

  if(exact.length>1)
    return {status:"multiple"};

  const partial=all.filter(
    s=>s.name.toLowerCase().includes(q)
  );

  if(partial.length===1)
    return {status:"ok",student:partial[0]};

  if(partial.length>1)
    return {status:"multiple"};

  return {status:"not_found"};
}

async function getActivePackage(url, secret, studentId){
  const h=dbHeaders(secret);

  const r=await fetch(
    `${url}/rest/v1/packages?student_id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,package_name,purchased_sessions,remaining_sessions,expires_at&order=purchased_at.desc&limit=1`,
    {headers:h}
  );

  if(!r.ok) throw new Error(await r.text());

  return (await r.json())[0]||null;
}

function parseMonthDay(md, hm="00:00"){
  const m=md.match(/^(\d{1,2})\/(\d{1,2})$/);
  const t=hm.match(/^(\d{1,2}):(\d{2})$/);

  if(!m||!t) return null;

  const now=new Date();
  let y=now.getFullYear();

  const mo=+m[1];
  const d=+m[2];
  const h=+t[1];
  const mi=+t[2];

  if(
    mo<1 || mo>12 ||
    d<1 || d>31 ||
    h>23 || mi>59
  ) return null;

  let dt=new Date(
    Date.UTC(y,mo-1,d,h-8,mi)
  );

  if((dt-now)/86400000 < -120){
    dt=new Date(
      Date.UTC(y+1,mo-1,d,h-8,mi)
    );
  }

  return dt;
}

function taiwanDayBounds(md){
  const start=parseMonthDay(md,"00:00");

  if(!start) return null;

  const end=new Date(
    start.getTime()+24*60*60*1000
  );

  return {start,end};
}

function formatTaiwanDate(iso){
  const d=new Date(iso);

  return new Intl.DateTimeFormat("zh-TW",{
    timeZone:"Asia/Taipei",
    month:"numeric",
    day:"numeric"
  }).format(d);
}

async function createBooking(
  url,
  secret,
  coachId,
  studentId,
  packageId,
  when
){
  const h=dbHeaders(secret);

  const collision=await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(coachId)}&scheduled_at=eq.${encodeURIComponent(when.toISOString())}&status=eq.scheduled&select=id`,
    {headers:h}
  );

  if(
    collision.ok &&
    (await collision.json()).length
  ){
    return {status:"collision"};
  }

  const r=await fetch(
    `${url}/rest/v1/sessions`,
    {
      method:"POST",
      headers:{
        ...h,
        Prefer:"return=representation"
      },
      body:JSON.stringify({
        student_id:studentId,
        coach_id:coachId,
        package_id:packageId,
        scheduled_at:when.toISOString(),
        status:"scheduled"
      })
    }
  );

  if(!r.ok) throw new Error(await r.text());

  return {
    status:"created",
    session:(await r.json())[0]
  };
}

async function findScheduledSession(
  url,
  secret,
  coachId,
  studentId,
  dateText=null
){
  const h=dbHeaders(secret);

  let start,end;

  if(dateText){
    const b=taiwanDayBounds(dateText);

    if(!b)
      return {status:"bad_date"};

    start=b.start;
    end=b.end;
  }else{
    const now=new Date();

    start=new Date(
      now.getTime()-12*60*60*1000
    );

    end=new Date(
      now.getTime()+6*60*60*1000
    );
  }

  const r=await fetch(
    `${url}/rest/v1/sessions?coach_id=eq.${encodeURIComponent(coachId)}&student_id=eq.${encodeURIComponent(studentId)}&status=eq.scheduled&scheduled_at=gte.${encodeURIComponent(start.toISOString())}&scheduled_at=lt.${encodeURIComponent(end.toISOString())}&select=id,scheduled_at,package_id&order=scheduled_at.asc`,
    {headers:h}
  );

  if(!r.ok)
    throw new Error(await r.text());

  const rows=await r.json();

  if(rows.length===0)
    return {status:"none"};

  if(rows.length>1)
    return {
      status:"multiple",
      sessions:rows
    };

  return {
    status:"ok",
    session:rows[0]
  };
}

async function completeSession(
  url,
  secret,
  sessionId,
  coachId
){
  const h=dbHeaders(secret);

  const r=await fetch(
    `${url}/rest/v1/rpc/complete_session_and_deduct`,
    {
      method:"POST",
      headers:h,
      body:JSON.stringify({
        p_session_id:sessionId,
        p_coach_id:coachId
      })
    }
  );

  if(!r.ok){
    const detail=await r.text();
    throw new Error(`COMPLETE:${detail}`);
  }

  const rows=await r.json();

  return rows[0];
}

function parseExerciseLine(line){
  const clean=line.trim();

  if(!clean) return null;

  const m=clean.match(
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*kg\s+(\d+)\s*[xX×*]\s*(\d+)(?:\s+RPE\s*(\d+(?:\.\d+)?))?$/i
  );

  if(!m) return null;

  return {
    exercise_name:m[1].trim(),
    weight_kg:Number(m[2]),
    reps:Number(m[3]),
    sets:Number(m[4]),
    rpe:m[5] ? Number(m[5]) : null
  };
}

async function saveExerciseRecords(
  url,
  secret,
  session,
  studentId,
  coachId,
  records
){
  const h=dbHeaders(secret);

  const payload=records.map(r=>({
    session_id:session.id,
    student_id:studentId,
    coach_id:coachId,
    exercise_name:r.exercise_name,
    weight_kg:r.weight_kg,
    reps:r.reps,
    sets:r.sets,
    rpe:r.rpe
  }));

  const res=await fetch(
    `${url}/rest/v1/session_exercises`,
    {
      method:"POST",
      headers:{
        ...h,
        Prefer:"return=representation"
      },
      body:JSON.stringify(payload)
    }
  );

  if(!res.ok){
    throw new Error(
      `SAVE_EXERCISES:${await res.text()}`
    );
  }

  return await res.json();
}

/* =========================
   V5E / V5F 訓練紀錄查詢
========================= */

async function getTrainingByDate(
  url,
  secret,
  studentId,
  coachId,
  dateText
){
  const h=dbHeaders(secret);
  const b=taiwanDayBounds(dateText);

  if(!b) return [];

  const sessionsRes=await fetch(
    `${url}/rest/v1/sessions?student_id=eq.${encodeURIComponent(studentId)}&coach_id=eq.${encodeURIComponent(coachId)}&scheduled_at=gte.${encodeURIComponent(b.start.toISOString())}&scheduled_at=lt.${encodeURIComponent(b.end.toISOString())}&select=id,scheduled_at,status&order=scheduled_at.asc`,
    {headers:h}
  );

  if(!sessionsRes.ok)
    throw new Error(
      `TRAINING_DATE_SESSIONS:${await sessionsRes.text()}`
    );

  const sessions=await sessionsRes.json();
  const output=[];

  for(const session of sessions){
    const exRes=await fetch(
      `${url}/rest/v1/session_exercises?session_id=eq.${encodeURIComponent(session.id)}&select=exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.asc`,
      {headers:h}
    );

    if(!exRes.ok)
      throw new Error(
        `TRAINING_DATE_EXERCISES:${await exRes.text()}`
      );

    const exercises=await exRes.json();

    if(exercises.length){
      output.push({
        ...session,
        exercises
      });
    }
  }

  return output;
}

async function getRecentTraining(
  url,
  secret,
  studentId,
  coachId,
  limit=5
){
  const h=dbHeaders(secret);

  const r=await fetch(
    `${url}/rest/v1/sessions?student_id=eq.${encodeURIComponent(studentId)}&coach_id=eq.${encodeURIComponent(coachId)}&select=id,scheduled_at,status&order=scheduled_at.desc&limit=30`,
    {headers:h}
  );

  if(!r.ok)
    throw new Error(
      `RECENT_SESSIONS:${await r.text()}`
    );

  const sessions=await r.json();
  const result=[];

  for(const session of sessions){
    const ex=await fetch(
      `${url}/rest/v1/session_exercises?session_id=eq.${encodeURIComponent(session.id)}&select=exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.asc`,
      {headers:h}
    );

    if(!ex.ok)
      throw new Error(
        `RECENT_EXERCISES:${await ex.text()}`
      );

    const exercises=await ex.json();

    if(exercises.length){
      result.push({
        ...session,
        exercises
      });
    }

    if(result.length>=limit)
      break;
  }

  return result;
}

async function getExerciseHistory(
  url,
  secret,
  studentId,
  coachId,
  exerciseName
){
  const h=dbHeaders(secret);

  const r=await fetch(
    `${url}/rest/v1/session_exercises?student_id=eq.${encodeURIComponent(studentId)}&coach_id=eq.${encodeURIComponent(coachId)}&exercise_name=ilike.${encodeURIComponent(`%${exerciseName}%`)}&select=session_id,exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.asc`,
    {headers:h}
  );

  if(!r.ok)
    throw new Error(
      `EXERCISE_HISTORY:${await r.text()}`
    );

  const rows=await r.json();

  if(!rows.length)
    return [];

  const output=[];

  for(const row of rows){
    const s=await fetch(
      `${url}/rest/v1/sessions?id=eq.${encodeURIComponent(row.session_id)}&select=scheduled_at,status&limit=1`,
      {headers:h}
    );

    if(!s.ok)
      throw new Error(
        `EXERCISE_SESSION:${await s.text()}`
      );

    const session=(await s.json())[0];

    if(session){
      output.push({
        ...row,
        scheduled_at:session.scheduled_at,
        session_status:session.status
      });
    }
  }

  output.sort(
    (a,b)=>
      new Date(a.scheduled_at)-
      new Date(b.scheduled_at)
  );

  return output;
}

function formatExercise(r){
  return `・${r.exercise_name}｜${Number(r.weight_kg)}kg｜${r.reps}下×${r.sets}組${r.rpe!=null?`｜RPE ${r.rpe}`:""}`;
}

function help(){
  return [
    "Chilling Coach Bot V5F",
    "",
    "可用指令：",
    "・我的權限",
    "・我的學員",
    "・王小明剩幾堂",
    "・8/12 15:00 王小明 預約上課",
    "・王小明 完成上課",
    "・王小明 8/12 完成上課",
    "",
    "訓練查詢：",
    "・王小明 上次訓練",
    "・王小明 最近訓練",
    "・王小明 8/12 訓練紀錄",
    "・王小明 Back squat 紀錄",
    "",
    "新增訓練紀錄：",
    "王小明 8/12",
    "Back squat 30kg 10*3",
    "Bench press 20kg 12*3 RPE8"
  ].join("\n");
}

async function handleCommand(
  text,
  user,
  url,
  secret
){
  const s=text.trim();

  if(/^(幫助|help|說明|指令)$/i.test(s))
    return help();

  if(/^(我的權限|權限)$/i.test(s)){
    return `你的系統權限：${
      user.roles.length
        ? user.roles.join(" + ")
        : "尚未指派"
    }`;
  }

  if(/^(我的學員|學員名單)$/i.test(s)){
    if(!user.roles.includes("coach"))
      return "你的帳號目前沒有教練權限。";

    const list=await getStudents(
      url,
      secret,
      user.id
    );

    if(!list.length)
      return "你目前沒有綁定中的學員。";

    return `目前共 ${list.length} 位學員：\n`+
      list.map(
        (x,i)=>`${i+1}. ${x.name}`
      ).join("\n");
  }

  /* =========================
     V5F 最近訓練
  ========================= */

  const recent=s.match(
    /^(.+?)\s+(?:最近訓練|最近訓練紀錄|上次訓練)$/
  );

  if(recent){
    const found=await findStudent(
      url,
      secret,
      user.id,
      recent[1]
    );

    if(found.status==="not_found")
      return `找不到你的學員「${recent[1].trim()}」。`;

    if(found.status==="multiple")
      return "找到多位符合的學員，請輸入完整姓名。";

    const requestedLast=/上次訓練$/.test(s);

    const sessions=await getRecentTraining(
      url,
      secret,
      found.student.id,
      user.id,
      requestedLast ? 1 : 5
    );

    if(!sessions.length)
      return `${found.student.name} 目前沒有訓練紀錄。`;

    if(requestedLast){
      const session=sessions[0];

      const exercises=session.exercises
        .map(formatExercise)
        .join("\n");

      return `📋 ${found.student.name} 上次訓練\n日期：${formatTaiwanDate(session.scheduled_at)}\n\n${exercises}`;
    }

    const blocks=sessions.map(session=>{
      const date=formatTaiwanDate(
        session.scheduled_at
      );

      const exercises=session.exercises
        .map(formatExercise)
        .join("\n");

      return `${date}\n${exercises}`;
    });

    return `📋 ${found.student.name}｜最近訓練\n\n${blocks.join("\n\n")}`;
  }

  /* =========================
     指定日期訓練紀錄
  ========================= */

  const datedTraining=s.match(
    /^(.+?)\s+(\d{1,2}\/\d{1,2})\s+(?:訓練紀錄|訓練)$/
  );

  if(datedTraining){
    const studentName=datedTraining[1].trim();
    const dateText=datedTraining[2];

    const found=await findStudent(
      url,
      secret,
      user.id,
      studentName
    );

    if(found.status==="not_found")
      return `找不到你的學員「${studentName}」。`;

    if(found.status==="multiple")
      return "找到多位符合的學員，請輸入完整姓名。";

    const sessions=await getTrainingByDate(
      url,
      secret,
      found.student.id,
      user.id,
      dateText
    );

    if(!sessions.length)
      return `${found.student.name} ${dateText} 找不到訓練紀錄。`;

    const blocks=sessions.map(session=>
      session.exercises
        .map(formatExercise)
        .join("\n")
    );

    return `📋 ${found.student.name} ${dateText} 訓練紀錄\n\n${blocks.join("\n\n")}`;
  }

  /* =========================
     V5F 單動作歷史
  ========================= */

  const exerciseHistory=s.match(
    /^(.+?)\s+(.+?)\s+(?:紀錄|歷史)$/
  );

  if(exerciseHistory){
    const studentName=
      exerciseHistory[1].trim();

    const exerciseName=
      exerciseHistory[2].trim();

    const found=await findStudent(
      url,
      secret,
      user.id,
      studentName
    );

    if(found.status==="not_found")
      return `找不到你的學員「${studentName}」。`;

    if(found.status==="multiple")
      return "找到多位符合的學員，請輸入完整姓名。";

    const records=await getExerciseHistory(
      url,
      secret,
      found.student.id,
      user.id,
      exerciseName
    );

    if(!records.length){
      return `${found.student.name} 找不到「${exerciseName}」的訓練紀錄。`;
    }

    const lines=records.map(r=>{
      const date=formatTaiwanDate(
        r.scheduled_at
      );

      return `${date}｜${Number(r.weight_kg)}kg｜${r.reps}下×${r.sets}組${r.rpe!=null?`｜RPE ${r.rpe}`:""}`;
    });

    const first=records[0];
    const last=records[records.length-1];

    let change="";

    if(
      first.weight_kg!=null &&
      last.weight_kg!=null &&
      Number(first.weight_kg)>0
    ){
      const firstWeight=
        Number(first.weight_kg);

      const lastWeight=
        Number(last.weight_kg);

      const diff=
        lastWeight-firstWeight;

      const pct=
        ((diff/firstWeight)*100)
          .toFixed(1);

      if(diff>0){
        change=
          `\n\n📈 重量變化：${firstWeight} → ${lastWeight}kg（+${pct}%）`;
      }
      else if(diff<0){
        change=
          `\n\n📉 重量變化：${firstWeight} → ${lastWeight}kg（${pct}%）`;
      }
      else{
        change=
          `\n\n重量變化：目前維持 ${lastWeight}kg`;
      }
    }

    return `📈 ${found.student.name}｜${records[0].exercise_name}\n\n${lines.join("\n")}${change}`;
  }

  /* =========================
     剩餘堂數
  ========================= */

  const remain=s.match(
    /^(.+?)\s*剩(?:餘)?(?:幾|多少)堂[？?]?$/
  );

  if(remain){
    const found=await findStudent(
      url,
      secret,
      user.id,
      remain[1]
    );

    if(found.status==="not_found")
      return `找不到你的學員「${remain[1].trim()}」。`;

    if(found.status==="multiple")
      return "找到多位符合的學員，請輸入完整姓名。";

    const pkg=await getActivePackage(
      url,
      secret,
      found.student.id
    );

    if(!pkg)
      return `${found.student.name}\n目前沒有有效中的課程方案。`;

    return `${found.student.name}\n方案：${
      pkg.package_name ||
      `${pkg.purchased_sessions}堂方案`
    }\n剩餘：${pkg.remaining_sessions}堂${
      pkg.expires_at
        ? `\n有效至：${pkg.expires_at}`
        : ""
    }`;
  }

  /* =========================
     預約
  ========================= */

  const booking=s.match(
    /^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+(.+?)\s*(?:預約上課|預約|上課預約)$/
  );

  if(booking){
    const when=parseMonthDay(
      booking[1],
      booking[2]
    );

    if(!when)
      return "日期或時間無法辨識。";

    const found=await findStudent(
      url,
      secret,
      user.id,
      booking[3]
    );

    if(found.status!=="ok")
      return "找不到唯一符合的學員，請輸入完整姓名。";

    const pkg=await getActivePackage(
      url,
      secret,
      found.student.id
    );

    if(!pkg)
      return `${found.student.name}目前沒有有效中的課程方案。`;

    const created=await createBooking(
      url,
      secret,
      user.id,
      found.student.id,
      pkg.id,
      when
    );

    if(created.status==="collision")
      return `⚠️ ${booking[1]} ${booking[2]} 你已經有其他預約。`;

    return `✅ 已預約 ${found.student.name}\n時間：${booking[1]} ${booking[2]}\n方案：${
      pkg.package_name ||
      `${pkg.purchased_sessions}堂方案`
    }\n剩餘：${pkg.remaining_sessions}堂\n\n※ 預約不先扣堂，完成上課才扣除。`;
  }

  /* =========================
     完成課程
  ========================= */

  const complete=s.match(
    /^(.+?)(?:\s+(\d{1,2}\/\d{1,2}))?\s+完成上課$/
  );

  if(complete){
    const studentName=
      complete[1].trim();

    const dateText=
      complete[2]||null;

    const found=await findStudent(
      url,
      secret,
      user.id,
      studentName
    );

    if(found.status!=="ok")
      return "找不到唯一符合的學員，請輸入完整姓名。";

    const sessionResult=
      await findScheduledSession(
        url,
        secret,
        user.id,
        found.student.id,
        dateText
      );

    if(sessionResult.status==="none")
      return `${found.student.name} 找不到可完成的預約課程。`;

    if(sessionResult.status==="multiple")
      return `${found.student.name} 找到多堂未完成課程，請加上日期，例如：${found.student.name} 8/12 完成上課`;

    const done=await completeSession(
      url,
      secret,
      sessionResult.session.id,
      user.id
    );

    return `✅ 已完成 ${found.student.name} 本次課程\n已扣除 1 堂\n剩餘：${done.remaining_sessions}堂`;
  }

  /* =========================
     新增訓練紀錄
  ========================= */

  const lines=s
    .split(/\r?\n/)
    .map(x=>x.trim())
    .filter(Boolean);

  if(lines.length>=2){
    const head=lines[0].match(
      /^(.+?)\s+(\d{1,2}\/\d{1,2})$/
    );

    if(head){
      const found=await findStudent(
        url,
        secret,
        user.id,
        head[1]
      );

      if(found.status!=="ok")
        return "找不到唯一符合的學員，請輸入完整姓名。";

      const records=[];
      const failed=[];

      for(const line of lines.slice(1)){
        const parsed=
          parseExerciseLine(line);

        if(parsed)
          records.push(parsed);
        else
          failed.push(line);
      }

      if(!records.length){
        return "目前無法辨識訓練紀錄格式。\n例如：Back squat 30kg 10*3";
      }

      const sessionResult=
        await findScheduledSession(
          url,
          secret,
          user.id,
          found.student.id,
          head[2]
        );

      if(sessionResult.status==="none")
        return `${found.student.name} ${head[2]} 找不到已預約課程，請先建立預約。`;

      if(sessionResult.status==="multiple")
        return `${found.student.name} ${head[2]} 有多堂預約，目前請先在 MINI App 選擇正確課程。`;

      await saveExerciseRecords(
        url,
        secret,
        sessionResult.session,
        found.student.id,
        user.id,
        records
      );

      const summary=
        records
          .map(formatExercise)
          .join("\n");

      const warn=
        failed.length
          ? `\n\n⚠️ 未辨識：\n${failed.join("\n")}`
          : "";

      return `✅ 已記錄 ${found.student.name} ${head[2]} 訓練內容\n\n${summary}${warn}\n\n對應：已完成課程`;
    }
  }

  return "目前還無法辨識這個指令。\n輸入「幫助」查看可用格式。";
}

export async function POST(request){
  const channelSecret=
    process.env.LINE_CHANNEL_SECRET;

  const channelToken=
    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  const dbUrl=
    process.env.SUPABASE_URL;

  const dbSecret=
    process.env.SUPABASE_SECRET_KEY;

  if(
    !channelSecret ||
    !channelToken ||
    !dbUrl ||
    !dbSecret
  ){
    return json({
      error:"Server environment is not configured"
    },500);
  }

  const raw=await request.text();

  if(
    !verifySignature(
      raw,
      request.headers.get("x-line-signature"),
      channelSecret
    )
  ){
    return json({
      error:"Invalid LINE signature"
    },401);
  }

  let body;

  try{
    body=JSON.parse(raw);
  }catch{
    return json({
      error:"Invalid JSON"
    },400);
  }

  if(!body.events?.length)
    return json({ok:true});

  for(const event of body.events){
    if(
      event.type!=="message" ||
      event.message?.type!=="text" ||
      !event.replyToken
    ) continue;

    try{
      const lineUserId=
        event.source?.userId;

      if(!lineUserId){
        await lineReply(
          event.replyToken,
          "目前只支援一對一文字訊息。",
          channelToken
        );
        continue;
      }

      const user=await getUser(
        dbUrl,
        dbSecret,
        lineUserId
      );

      if(!user){
        await lineReply(
          event.replyToken,
          "你的帳號尚未完成 Chilling Coach OS 註冊，請先開啟 MINI App 登入。",
          channelToken
        );
        continue;
      }

      if(!user.roles.includes("coach")){
        await lineReply(
          event.replyToken,
          "你的帳號目前沒有教練權限。",
          channelToken
        );
        continue;
      }

      const out=await handleCommand(
        event.message.text,
        user,
        dbUrl,
        dbSecret
      );

      await lineReply(
        event.replyToken,
        out,
        channelToken
      );

    }catch(err){
      console.error(err);

      try{
        await lineReply(
          event.replyToken,
          "系統處理這則訊息時發生錯誤，請稍後再試。",
          channelToken
        );
      }catch{}
    }
  }

  return json({ok:true});
}

export async function GET(){
  return json({
    service:"Chilling Coach OS LINE Webhook",
    version:"V5F",
    status:"ready"
  });
}
