const {context,rows,fail}=require("./_lib");

const managers=c=>c.roles.some(x=>["manager","admin"].includes(x));
const day=v=>v?String(v).slice(0,10):null;
const daysBetween=(a,b)=>Math.ceil((new Date(a)-new Date(b))/86400000);

async function permittedStudentIds(c,scope="coach"){
 if(managers(c)&&scope==="manager")return null;
 const links=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&ended_at=is.null&select=student_id`);
 return new Set(links.map(x=>x.student_id));
}

module.exports=async function(req,res){
 try{
  if(req.query?.cron==="daily")return require("../lib/reminders")(req,res);
  const c=await context(req,["coach","manager","admin"]), scope=String(req.query?.scope||"coach"), allowed=await permittedStudentIds(c,scope);
  if(req.method==="POST"){
   const b=req.body||{};
   if(b.action==="restore_session"){
    const sessionId=String(b.sessionId||""),reason=String(b.reason||"").trim();if(!sessionId||!reason)return res.status(400).json({error:"課程與復原原因必填"});
    const session=(await rows(c.url,c.headers,`sessions?id=eq.${sessionId}&select=id,student_id,status`))[0];if(!session)return res.status(404).json({error:"Session not found"});if(allowed&&!allowed.has(session.student_id))return res.status(403).json({error:"Student not assigned"});
    const result=await rows(c.url,c.headers,"rpc/reopen_session_and_restore",{method:"POST",body:JSON.stringify({p_session_id:sessionId,p_actor:c.user.id,p_reason:reason})});return res.json({session:Array.isArray(result)?result[0]:result});
   }
   if(b.action==="update_preferences"){
    const value={user_id:c.user.id,class_reminders:b.classReminders!==false,renewal_reminders:b.renewalReminders!==false,manager_digest:managers(c)&&b.managerDigest===true,quiet_start:String(b.quietStart||"21:00").slice(0,5),quiet_end:String(b.quietEnd||"08:00").slice(0,5),updated_at:new Date().toISOString()};
    const saved=await rows(c.url,c.headers,"notification_preferences?on_conflict=user_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(value)});return res.json({preferences:saved[0]});
   }
   const id=String(b.id||""), status=String(b.status||"");
   if(!id||!["pending","contacted","interested","confirmed","renewed","lost"].includes(status))return res.status(400).json({error:"Invalid follow-up"});
   const existing=(await rows(c.url,c.headers,`renewal_followups?id=eq.${id}&select=id,student_id`))[0];
   if(!existing)return res.status(404).json({error:"Follow-up not found"});
   if(allowed&&!allowed.has(existing.student_id))return res.status(403).json({error:"Student not assigned"});
   await rows(c.url,c.headers,`renewal_followups?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status,last_contact_at:["contacted","interested","confirmed","renewed","lost"].includes(status)?new Date().toISOString():null,note:String(b.note||"").slice(0,1000)||null,updated_at:new Date().toISOString()})});
   return res.json({ok:true});
  }
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});

  const [students,links,packages,sessions,users,sales,followups,usage,preferences]=await Promise.all([
   rows(c.url,c.headers,"students?status=eq.active&archived_at=is.null&select=id,name,phone,joined_at"),
   rows(c.url,c.headers,"coach_students?ended_at=is.null&select=coach_id,student_id,is_primary,started_at"),
   rows(c.url,c.headers,"packages?status=eq.active&voided_at=is.null&select=id,student_id,coach_id,package_name,purchased_sessions,remaining_sessions,price,paid_amount,purchased_at,expires_at,payment_status&order=purchased_at.desc"),
   rows(c.url,c.headers,"sessions?select=id,student_id,coach_id,status,scheduled_at,completed_at&order=scheduled_at.desc&limit=5000"),
   rows(c.url,c.headers,"users?is_active=eq.true&select=id,display_name"),
   rows(c.url,c.headers,"sales_records?status=eq.confirmed&select=coach_id,student_id,amount,record_type,occurred_on"),
   rows(c.url,c.headers,"renewal_followups?status=in.(pending,contacted,interested,confirmed)&select=*&order=next_contact_at.asc.nullslast"),
   rows(c.url,c.headers,`message_usage_monthly?month=eq.${new Date().toISOString().slice(0,7)}-01&select=sent_count,monthly_limit`),
   rows(c.url,c.headers,`notification_preferences?user_id=eq.${c.user.id}&select=*`)
  ]);
  const visibleStudents=allowed?students.filter(x=>allowed.has(x.id)):students;
  const visibleIds=new Set(visibleStudents.map(x=>x.id)), userMap=Object.fromEntries(users.map(x=>[x.id,x.display_name||"未命名教練"]));
  const linkByStudent=new Map(); for(const x of links)if(!linkByStudent.has(x.student_id)||x.is_primary)linkByStudent.set(x.student_id,x.coach_id);
  if(allowed)for(const student of visibleStudents)linkByStudent.set(student.id,c.user.id);
  const packageByStudent=new Map(); for(const x of packages)if(!packageByStudent.has(x.student_id))packageByStudent.set(x.student_id,x);
  const sessionsByStudent=new Map(); for(const x of sessions){if(!sessionsByStudent.has(x.student_id))sessionsByStudent.set(x.student_id,[]);sessionsByStudent.get(x.student_id).push(x)}
  const today=new Date(), cutoff=new Date(today.getTime()+30*86400000), month=today.toISOString().slice(0,7);
  const candidates=[];
  for(const student of visibleStudents){
   const pkg=packageByStudent.get(student.id), history=sessionsByStudent.get(student.id)||[], completed=history.filter(x=>x.status==="completed"), coachId=linkByStudent.get(student.id)||pkg?.coach_id;
   const recent=completed.filter(x=>new Date(x.completed_at||x.scheduled_at)>=new Date(today.getTime()-28*86400000)).length;
   const weekly=recent/4, projectedDays=pkg&&weekly>0?Math.ceil(Number(pkg.remaining_sessions)/weekly*7):null;
   const expiryDays=pkg?.expires_at?daysBetween(pkg.expires_at,today):null;
   const due=!!pkg&&(Number(pkg.remaining_sessions)<=3||(expiryDays!=null&&expiryDays<=30)||(projectedDays!=null&&projectedDays<=30));
   if(!due)continue;
   let probability=40; if(Number(pkg.remaining_sessions)<=1)probability+=20;if(recent>=4)probability+=20;if(expiryDays!=null&&expiryDays<=14)probability+=10;probability=Math.min(90,probability);
   const existing=followups.find(x=>x.student_id===student.id&&x.package_id===pkg.id);
   candidates.push({id:existing?.id||null,studentId:student.id,studentName:student.name,phone:student.phone,coachId,coachName:userMap[coachId]||"未指派",remaining:Number(pkg.remaining_sessions),expiresAt:day(pkg.expires_at),projectedFinish:projectedDays!=null?new Date(today.getTime()+projectedDays*86400000).toISOString().slice(0,10):null,probability:existing?.probability??probability,expectedAmount:Number(existing?.expected_amount||pkg.paid_amount||pkg.price||0),status:existing?.status||"pending",lastClass:completed[0]?.completed_at||completed[0]?.scheduled_at||null});
  }
  const coachIds=allowed?[c.user.id]:[...new Set(links.filter(x=>visibleIds.has(x.student_id)).map(x=>x.coach_id))];
  const coachPerformance=coachIds.map(coachId=>{
   const ids=new Set(links.filter(x=>x.coach_id===coachId&&visibleIds.has(x.student_id)).map(x=>x.student_id));
   const pkgs=packages.filter(x=>ids.has(x.student_id)), due=candidates.filter(x=>x.coachId===coachId), monthSales=sales.filter(x=>x.coach_id===coachId&&String(x.occurred_on).startsWith(month)).reduce((n,x)=>n+Number(x.amount||0),0);
   const completedMonth=sessions.filter(x=>x.coach_id===coachId&&x.status==="completed"&&String(x.completed_at||x.scheduled_at).startsWith(month)).length;
   return {coachId,coachName:userMap[coachId]||"未命名教練",students:ids.size,remaining:pkgs.reduce((n,x)=>n+Number(x.remaining_sessions||0),0),renewalDue:due.length,monthlySales:monthSales,completedSessions:completedMonth,forecast:Math.round(due.reduce((n,x)=>n+x.expectedAmount*x.probability/100,0))};
  }).sort((a,b)=>b.monthlySales-a.monthlySales);
  const totalRemaining=visibleStudents.reduce((n,x)=>n+Number(packageByStudent.get(x.id)?.remaining_sessions||0),0), forecast=coachPerformance.reduce((n,x)=>n+x.forecast,0);
  return res.json({metrics:{students:visibleStudents.length,totalRemaining,renewalDue:candidates.length,forecast},renewals:candidates.sort((a,b)=>a.remaining-b.remaining),coaches:coachPerformance,messageUsage:usage[0]||{sent_count:0,monthly_limit:200},preferences:preferences[0]||{class_reminders:true,renewal_reminders:true,manager_digest:managers(c),quiet_start:"21:00",quiet_end:"08:00"},rules:{remainingSessions:3,windowDays:30}});
 }catch(e){return fail(res,e)}
};
