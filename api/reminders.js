const {config,rows,fail}=require("./_lib");

async function push(lineUserId,text){
 const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
 if(!token)throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
 const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({to:lineUserId,messages:[{type:"text",text:text.slice(0,5000)}]})});
 if(!r.ok)throw new Error(`LINE push failed: ${await r.text()}`);
}

module.exports=async function(req,res){
 try{
  if(req.method!=="GET"&&req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const expected=process.env.CRON_SECRET, auth=req.headers.authorization||"";
  if(!expected||auth!==`Bearer ${expected}`)return res.status(401).json({error:"Unauthorized"});
  const c=config(), now=new Date(), next25=new Date(now.getTime()+25*3600000), month=`${now.toISOString().slice(0,7)}-01`;
  let usage=(await rows(c.url,c.headers,`message_usage_monthly?month=eq.${month}&select=*`))[0];
  if(!usage){usage=(await rows(c.url,c.headers,"message_usage_monthly",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({month,sent_count:0,monthly_limit:Number(process.env.LINE_MONTHLY_MESSAGE_LIMIT||200)})}))[0]}
  const [users,links,students,packages,sessions,prefs]=await Promise.all([
   rows(c.url,c.headers,"users?is_active=eq.true&line_user_id=not.is.null&select=id,line_user_id,display_name"),
   rows(c.url,c.headers,"coach_students?ended_at=is.null&select=coach_id,student_id"),
   rows(c.url,c.headers,"students?status=eq.active&select=id,name"),
   rows(c.url,c.headers,"packages?status=eq.active&select=id,student_id,remaining_sessions,expires_at,price,paid_amount"),
   rows(c.url,c.headers,`sessions?status=eq.scheduled&scheduled_at=gte.${now.toISOString()}&scheduled_at=lte.${next25.toISOString()}&select=id,student_id,coach_id,scheduled_at`),
   rows(c.url,c.headers,"notification_preferences?select=*")
  ]);
  const studentMap=Object.fromEntries(students.map(x=>[x.id,x])), prefMap=Object.fromEntries(prefs.map(x=>[x.user_id,x])), coachByStudent=Object.fromEntries(links.map(x=>[x.student_id,x.coach_id]));
  const grouped=new Map();
  for(const user of users)grouped.set(user.id,{user,classes:[],renewals:[]});
  for(const s of sessions){const g=grouped.get(s.coach_id);if(g)g.classes.push(`${new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(s.scheduled_at))} ${studentMap[s.student_id]?.name||"學員"}`)}
  for(const p of packages){const remaining=Number(p.remaining_sessions||0),expiry=p.expires_at?Math.ceil((new Date(p.expires_at)-now)/86400000):null;if(remaining>3&&(expiry==null||expiry>30))continue;const coachId=coachByStudent[p.student_id],g=grouped.get(coachId);if(g)g.renewals.push(`${studentMap[p.student_id]?.name||"學員"}（剩 ${remaining} 堂${expiry!=null?`，${expiry} 天到期`:""}）`)}
  let sent=0,skipped=0,failed=0;
  for(const {user,classes,renewals} of grouped.values()){
   const pref=prefMap[user.id]||{class_reminders:true,renewal_reminders:true}; const parts=[];
   if(pref.class_reminders&&classes.length)parts.push(`明日課程\n${classes.slice(0,10).join("\n")}`);
   if(pref.renewal_reminders&&renewals.length)parts.push(`續約待辦\n${renewals.slice(0,10).join("\n")}`);
   if(!parts.length)continue;
   const eventKey=`daily:${now.toISOString().slice(0,10)}:${user.id}`;
   const exists=await rows(c.url,c.headers,`notification_jobs?event_key=eq.${encodeURIComponent(eventKey)}&select=id,status`);if(exists.length){skipped++;continue}
   if(Number(usage.sent_count)+sent>=Number(usage.monthly_limit)){skipped++;continue}
   const job=(await rows(c.url,c.headers,"notification_jobs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({recipient_user_id:user.id,event_type:"daily_coach_digest",event_key:eventKey,scheduled_for:now.toISOString(),payload:{classes,renewals}})}))[0];
   try{await push(user.line_user_id,`Chilling Coach OS 提醒\n\n${parts.join("\n\n")}`);sent++;await rows(c.url,c.headers,`notification_jobs?id=eq.${job.id}`,{method:"PATCH",body:JSON.stringify({status:"sent",sent_at:new Date().toISOString(),attempts:1})})}catch(e){failed++;await rows(c.url,c.headers,`notification_jobs?id=eq.${job.id}`,{method:"PATCH",body:JSON.stringify({status:"failed",attempts:1,last_error:String(e.message).slice(0,1000)})})}
  }
  if(sent)await rows(c.url,c.headers,`message_usage_monthly?month=eq.${month}`,{method:"PATCH",body:JSON.stringify({sent_count:Number(usage.sent_count)+sent,updated_at:new Date().toISOString()})});
  return res.json({ok:true,sent,skipped,failed,limit:usage.monthly_limit});
 }catch(e){return fail(res,e)}
};
