const {context,rows,fail}=require("./_lib");

module.exports=async function(req,res){
 try{
  const c=await context(req,["coach","manager","admin"]), isManager=c.roles.some(x=>["manager","admin"].includes(x));
  if(req.method==="POST"){
   const action=String(req.body?.action||"");
   if(action==="clock_in"||action==="clock_out"){
    const result=await rows(c.url,c.headers,"rpc/record_work_clock",{method:"POST",body:JSON.stringify({p_user_id:c.user.id,p_action:action,p_source:"mini_app"})});
    return res.json({workLog:result});
   }
   if(action==="request_leave"){
    const type=String(req.body?.leaveType||"").trim().slice(0,50), startsAt=new Date(req.body?.startsAt), endsAt=new Date(req.body?.endsAt), reason=String(req.body?.reason||"").trim().slice(0,500)||null;
    if(!type||!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt)return res.status(400).json({error:"Invalid leave request"});
    const created=await rows(c.url,c.headers,"leave_requests",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:c.user.id,location_id:c.user.default_location_id||null,leave_type:type,starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),reason,status:"pending"})});
    await rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:"request",p_entity_type:"leave_request",p_entity_id:created[0].id,p_source:"mini_app",p_after:created[0]})});
    return res.json({leave:created[0]});
   }
   if(!isManager)return res.status(403).json({error:"Manager role required"});
   const id=String(req.body?.requestId||""), approve=req.body?.approve===true;
   if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Invalid request"});
   const result=await rows(c.url,c.headers,"rpc/review_leave_request",{method:"POST",body:JSON.stringify({p_request_id:id,p_reviewer:c.user.id,p_approve:approve,p_note:String(req.body?.note||"").slice(0,500)||null})});
   return res.json({request:result});
  }
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());
  const monthStart=`${today.slice(0,7)}-01`;
  if(req.query?.scope==="me"){
   const [workLogs,shifts,leaves]=await Promise.all([
    rows(c.url,c.headers,`work_logs?user_id=eq.${c.user.id}&started_at=gte.${monthStart}T00:00:00%2B08:00&select=id,started_at,ended_at,break_minutes,status&order=started_at.desc`),
    rows(c.url,c.headers,`shifts?user_id=eq.${c.user.id}&starts_at=gte.${today}T00:00:00%2B08:00&select=id,starts_at,ends_at,status,note&order=starts_at.asc&limit=20`),
    rows(c.url,c.headers,`leave_requests?user_id=eq.${c.user.id}&select=id,leave_type,starts_at,ends_at,status,reason,review_note&order=created_at.desc&limit=10`)
   ]);
   const open=workLogs.find(x=>!x.ended_at)||null, hours=workLogs.reduce((s,x)=>x.ended_at?s+Math.max(0,(new Date(x.ended_at)-new Date(x.started_at))/3600000-(x.break_minutes||0)/60):s,0);
   return res.json({metrics:{monthHours:Number(hours.toFixed(1)),clockedIn:!!open},openWorkLog:open,shifts,leaves});
  }
  if(!isManager)return res.status(403).json({error:"Manager role required"});
  const [sales,classes,attendance,workLogs,shifts,leaves,exports,adapters]=await Promise.all([
   rows(c.url,c.headers,`sales_records?occurred_on=gte.${monthStart}&status=eq.confirmed&select=amount`),
   rows(c.url,c.headers,`group_classes?starts_at=gte.${monthStart}T00:00:00%2B08:00&select=id,status,capacity`),
   rows(c.url,c.headers,"group_class_attendance?select=group_class_id,status,fee"),
   rows(c.url,c.headers,`work_logs?started_at=gte.${monthStart}T00:00:00%2B08:00&select=started_at,ended_at,break_minutes,status`),
   rows(c.url,c.headers,`shifts?starts_at=gte.${today}T00:00:00%2B08:00&starts_at=lt.${today}T23:59:59%2B08:00&select=id,status`),
   rows(c.url,c.headers,"leave_requests?status=eq.pending&select=id,user_id,leave_type,starts_at,ends_at,reason,created_at&order=created_at.asc"),
   rows(c.url,c.headers,"accounting_exports?select=id,status&order=created_at.desc&limit=50"),
   rows(c.url,c.headers,"integration_adapters?select=id,is_active")
  ]);
  const userIds=[...new Set(leaves.map(x=>x.user_id))]; let users=[];
  if(userIds.length)users=await rows(c.url,c.headers,`users?id=in.(${encodeURIComponent(userIds.map(x=>`\"${x}\"`).join(","))})&select=id,display_name`);
  const names=Object.fromEntries(users.map(x=>[x.id,x.display_name]));
  const hours=workLogs.reduce((sum,x)=>x.ended_at?sum+Math.max(0,(new Date(x.ended_at)-new Date(x.started_at))/3600000-(x.break_minutes||0)/60):sum,0);
  const attended=attendance.filter(x=>["attended","checked_in","completed"].includes(x.status)).length;
  res.json({metrics:{monthlySales:sales.reduce((s,x)=>s+Number(x.amount||0),0),groupClasses:classes.length,groupAttendance:attended,workHours:Number(hours.toFixed(1)),todayShifts:shifts.length,pendingLeaves:leaves.length,pendingExports:exports.filter(x=>x.status!=="completed").length,activeAdapters:adapters.filter(x=>x.is_active).length},leaves:leaves.map(x=>({...x,display_name:names[x.user_id]||"使用者"}))});
 }catch(e){return fail(res,e)}
};
