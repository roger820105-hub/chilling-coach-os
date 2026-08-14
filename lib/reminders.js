const {config,rows}=require("../api/_lib");

async function linePush(to,text){
 const token=process.env.LINE_CHANNEL_ACCESS_TOKEN;
 if(!token)throw new Error("LINE channel token missing");
 const r=await fetch("https://api.line.me/v2/bot/message/push",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({to,messages:[{type:"text",text:text.slice(0,5000)}]})});
 if(!r.ok)throw new Error(await r.text());
}

module.exports=async function runReminders(req,res){
 const secret=process.env.CRON_SECRET;
 if(!secret||(req.headers.authorization||"")!==`Bearer ${secret}`)return res.status(401).json({error:"Unauthorized"});
 const c=config(),now=new Date(),month=`${now.toISOString().slice(0,7)}-01`,isMonday=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Taipei",weekday:"short"}).format(now)==="Mon";
 let usage=(await rows(c.url,c.headers,`message_usage_monthly?month=eq.${month}&select=*`))[0];
 if(!usage)usage=(await rows(c.url,c.headers,"message_usage_monthly",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({month,monthly_limit:Number(process.env.LINE_MONTHLY_MESSAGE_LIMIT||200)})}))[0];
 const [users,roles,links,students,packages,sessions,preferences]=await Promise.all([
  rows(c.url,c.headers,"users?is_active=eq.true&line_user_id=not.is.null&select=id,line_user_id,display_name"),rows(c.url,c.headers,"user_roles?select=user_id,role"),rows(c.url,c.headers,"coach_students?ended_at=is.null&select=coach_id,student_id"),rows(c.url,c.headers,"students?status=eq.active&archived_at=is.null&select=id,name"),rows(c.url,c.headers,"packages?status=eq.active&voided_at=is.null&select=student_id,remaining_sessions,expires_at"),rows(c.url,c.headers,`sessions?status=eq.scheduled&scheduled_at=gte.${now.toISOString()}&scheduled_at=lte.${new Date(now.getTime()+25*3600000).toISOString()}&select=student_id,coach_id,scheduled_at`),rows(c.url,c.headers,"notification_preferences?select=*")
 ]);
 const prefs=Object.fromEntries(preferences.map(x=>[x.user_id,x])),names=Object.fromEntries(students.map(x=>[x.id,x.name])),coachByStudent=Object.fromEntries(links.map(x=>[x.student_id,x.coach_id])),groups=Object.fromEntries(users.map(x=>[x.id,{user:x,classes:[],renewals:[]}])) ;
 for(const s of sessions)if(groups[s.coach_id])groups[s.coach_id].classes.push(`${new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(s.scheduled_at))} ${names[s.student_id]||"學員"}`);
 for(const p of packages){const days=p.expires_at?Math.ceil((new Date(p.expires_at)-now)/86400000):null;if(Number(p.remaining_sessions)>3&&(days==null||days>30))continue;const g=groups[coachByStudent[p.student_id]];if(g)g.renewals.push(`${names[p.student_id]||"學員"}（剩 ${p.remaining_sessions} 堂${days!=null?`，${days} 天到期`:""}）`)}
 let sent=0,skipped=0,failed=0;
 const sendOnce=async(user,type,text)=>{const key=`${type}:${now.toISOString().slice(0,10)}:${user.id}`;if((await rows(c.url,c.headers,`notification_jobs?event_key=eq.${encodeURIComponent(key)}&select=id`)).length||Number(usage.sent_count)+sent>=Number(usage.monthly_limit)){skipped++;return}const job=(await rows(c.url,c.headers,"notification_jobs",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({recipient_user_id:user.id,event_type:type,event_key:key,scheduled_for:now.toISOString(),payload:{text}})}))[0];try{await linePush(user.line_user_id,text);sent++;await rows(c.url,c.headers,`notification_jobs?id=eq.${job.id}`,{method:"PATCH",body:JSON.stringify({status:"sent",sent_at:new Date().toISOString(),attempts:1})})}catch(e){failed++;await rows(c.url,c.headers,`notification_jobs?id=eq.${job.id}`,{method:"PATCH",body:JSON.stringify({status:"failed",attempts:1,last_error:String(e.message).slice(0,1000)})})}};
 for(const g of Object.values(groups)){const p=prefs[g.user.id]||{},parts=[];if(p.class_reminders!==false&&g.classes.length)parts.push(`未來 24 小時課程\n${g.classes.slice(0,12).join("\n")}`);if(p.renewal_reminders!==false&&g.renewals.length)parts.push(`續約待辦\n${g.renewals.slice(0,12).join("\n")}`);if(parts.length)await sendOnce(g.user,"daily_coach_digest",`Chilling Coach OS 每日提醒\n\n${parts.join("\n\n")}`)}
 if(isMonday){const managers=new Set(roles.filter(x=>["manager","admin"].includes(x.role)).map(x=>x.user_id)),renewalCount=packages.filter(p=>Number(p.remaining_sessions)<=3||(p.expires_at&&Math.ceil((new Date(p.expires_at)-now)/86400000)<=30)).length;for(const user of users.filter(x=>managers.has(x.id)&&(prefs[x.id]?.manager_digest!==false)))await sendOnce(user,"weekly_manager_digest",`Chilling Coach OS 主管週報\n有效學員：${students.length} 人\n30 天內需續約：${renewalCount} 人\n請開啟 Mini App 查看各教練明細。`)}
 if(sent)await rows(c.url,c.headers,`message_usage_monthly?month=eq.${month}`,{method:"PATCH",body:JSON.stringify({sent_count:Number(usage.sent_count)+sent,updated_at:new Date().toISOString()})});
 return res.json({ok:true,sent,skipped,failed,monthlyLimit:usage.monthly_limit});
};
