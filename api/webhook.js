
import crypto from "node:crypto";

const j = (data, status=200) => new Response(JSON.stringify(data), {
  status, headers: {"Content-Type":"application/json; charset=utf-8"}
});

function verify(raw, sig, secret){
  if(!sig || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a,b);
}

async function reply(replyToken, text, token){
  const r = await fetch("https://api.line.me/v2/bot/message/reply",{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({replyToken,messages:[{type:"text",text}]})
  });
  if(!r.ok) throw new Error(await r.text());
}

const dbHeaders = secret => ({
  apikey:secret,
  Authorization:`Bearer ${secret}`,
  "Content-Type":"application/json"
});

async function getUser(url, secret, lineUserId){
  const h = dbHeaders(secret);
  const r = await fetch(`${url}/rest/v1/users?line_user_id=eq.${encodeURIComponent(lineUserId)}&is_active=eq.true&select=id,display_name`,{headers:h});
  const rows = r.ok ? await r.json() : [];
  if(!rows[0]) return null;
  const rr = await fetch(`${url}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(rows[0].id)}&select=role`,{headers:h});
  const roles = rr.ok ? (await rr.json()).map(x=>x.role) : [];
  return {...rows[0],roles};
}

async function getStudents(url, secret, coachId){
  const h = dbHeaders(secret);
  const r = await fetch(`${url}/rest/v1/coach_students?coach_id=eq.${encodeURIComponent(coachId)}&ended_at=is.null&select=student_id`,{headers:h});
  if(!r.ok) throw new Error(await r.text());
  const ids = [...new Set((await r.json()).map(x=>x.student_id).filter(Boolean))];
  if(!ids.length) return [];
  const filter = ids.map(id=>`"${id}"`).join(",");
  const s = await fetch(`${url}/rest/v1/students?id=in.(${encodeURIComponent(filter)})&select=id,name,status&order=name.asc`,{headers:h});
  if(!s.ok) throw new Error(await s.text());
  return await s.json();
}

async function findStudent(url, secret, coachId, name){
  const all = await getStudents(url, secret, coachId);
  const q = name.trim().toLowerCase();
  const exact = all.filter(s=>s.name.trim().toLowerCase()===q);
  if(exact.length===1) return exact[0];
  const partial = all.filter(s=>s.name.toLowerCase().includes(q));
  if(partial.length===1) return partial[0];
  return null;
}

async function getPackage(url, secret, studentId){
  const h = dbHeaders(secret);
  const r = await fetch(`${url}/rest/v1/packages?student_id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,package_name,purchased_sessions,remaining_sessions,expires_at&order=purchased_at.desc&limit=1`,{headers:h});
  if(!r.ok) throw new Error(await r.text());
  return (await r.json())[0] || null;
}

function parseDate(md, hm){
  const m = md.match(/^(\d{1,2})\/(\d{1,2})$/), t = hm.match(/^(\d{1,2}):(\d{2})$/);
  if(!m || !t) return null;
  const now = new Date();
  let y = now.getFullYear();
  const mo=+m[1], d=+m[2], h=+t[1], mi=+t[2];
  if(mo<1||mo>12||d<1||d>31||h>23||mi>59) return null;
  let dt = new Date(Date.UTC(y,mo-1,d,h-8,mi));
  if((dt-now)/86400000 < -120) dt = new Date(Date.UTC(y+1,mo-1,d,h-8,mi));
  return dt;
}

async function createBooking(url, secret, userId, studentId, packageId, when){
  const h = dbHeaders(secret);
  const r = await fetch(`${url}/rest/v1/sessions`,{
    method:"POST",
    headers:{...h,Prefer:"return=representation"},
    body:JSON.stringify({
      student_id:studentId,coach_id:userId,package_id:packageId,
      scheduled_at:when.toISOString(),status:"scheduled"
    })
  });
  if(!r.ok) throw new Error(await r.text());
  return (await r.json())[0];
}

function help(){
  return [
    "Chilling Coach Bot V5A",
    "",
    "可用指令：",
    "・我的權限",
    "・我的學員",
    "・王小明剩幾堂",
    "・3/1 15:00 王小明 預約上課",
    "",
    "下一版：完成上課、扣堂、訓練紀錄"
  ].join("\n");
}

async function command(text,user,url,secret){
  const s = text.trim();

  if(/^(幫助|help|說明|指令)$/i.test(s)) return help();
  if(/^(我的權限|權限)$/i.test(s)) return `你的系統權限：${user.roles.length?user.roles.join(" + "):"尚未指派"}`;

  if(/^(我的學員|學員名單)$/i.test(s)){
    if(!user.roles.includes("coach")) return "你的帳號目前沒有教練權限。";
    const list = await getStudents(url,secret,user.id);
    if(!list.length) return "你目前沒有綁定中的學員。";
    return `目前共 ${list.length} 位學員：\n` + list.map((x,i)=>`${i+1}. ${x.name}`).join("\n");
  }

  const remain = s.match(/^(.+?)\s*剩(?:餘)?(?:幾|多少)堂[？?]?$/);
  if(remain){
    if(!user.roles.includes("coach")) return "你的帳號目前沒有教練權限。";
    const st = await findStudent(url,secret,user.id,remain[1]);
    if(!st) return `找不到你的學員「${remain[1].trim()}」。`;
    const pkg = await getPackage(url,secret,st.id);
    if(!pkg) return `${st.name}\n目前沒有有效中的課程方案。`;
    return `${st.name}\n方案：${pkg.package_name || `${pkg.purchased_sessions}堂方案`}\n剩餘：${pkg.remaining_sessions}堂${pkg.expires_at?`\n有效至：${pkg.expires_at}`:""}`;
  }

  const book = s.match(/^(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+(.+?)\s*(?:預約上課|預約|上課預約)$/);
  if(book){
    if(!user.roles.includes("coach")) return "你的帳號目前沒有教練權限。";
    const when = parseDate(book[1],book[2]);
    if(!when) return "日期或時間無法辨識，例如：3/1 15:00 王小明 預約上課";
    const st = await findStudent(url,secret,user.id,book[3]);
    if(!st) return `找不到你的學員「${book[3].trim()}」。`;
    const pkg = await getPackage(url,secret,st.id);
    if(!pkg) return `尚未建立預約。\n${st.name}目前沒有有效中的課程方案。`;
    await createBooking(url,secret,user.id,st.id,pkg.id,when);
    return `✅ 已預約 ${st.name}\n時間：${book[1]} ${book[2]}\n方案：${pkg.package_name || `${pkg.purchased_sessions}堂方案`}\n剩餘：${pkg.remaining_sessions}堂\n\n※ 預約不先扣堂，完成上課才扣除。`;
  }

  return `目前還無法辨識這個指令。\n輸入「幫助」查看可用格式。`;
}

export async function POST(request){
  const lineSecret = process.env.LINE_CHANNEL_SECRET;
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const dbUrl = process.env.SUPABASE_URL;
  const dbSecret = process.env.SUPABASE_SECRET_KEY;
  if(!lineSecret||!lineToken||!dbUrl||!dbSecret) return j({error:"Server environment is not configured"},500);

  const raw = await request.text();
  if(!verify(raw,request.headers.get("x-line-signature"),lineSecret)) return j({error:"Invalid LINE signature"},401);

  let body;
  try{ body=JSON.parse(raw); }catch{ return j({error:"Invalid JSON"},400); }
  if(!body.events?.length) return j({ok:true});

  for(const e of body.events){
    if(e.type!=="message" || e.message?.type!=="text" || !e.replyToken) continue;
    try{
      const lineUserId = e.source?.userId;
      if(!lineUserId){
        await reply(e.replyToken,"目前只支援一對一文字訊息。",lineToken);
        continue;
      }
      const user = await getUser(dbUrl,dbSecret,lineUserId);
      if(!user){
        await reply(e.replyToken,"你的帳號尚未完成 Chilling Coach OS 註冊，請先開啟 MINI App 登入。",lineToken);
        continue;
      }
      if(!user.roles.length){
        await reply(e.replyToken,"你的帳號尚未取得權限，請等待權限管理人核准。",lineToken);
        continue;
      }
      const out = await command(e.message.text,user,dbUrl,dbSecret);
      await reply(e.replyToken,out,lineToken);
    }catch(err){
      console.error(err);
      try{ await reply(e.replyToken,"系統處理這則訊息時發生錯誤，請稍後再試。",lineToken); }catch{}
    }
  }
  return j({ok:true});
}

export async function GET(){
  return j({service:"Chilling Coach OS LINE Webhook",status:"ready"});
}
