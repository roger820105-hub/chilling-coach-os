const {context,rows,fail}=require("./_lib");

const manager=c=>c.roles.some(r=>["manager","admin"].includes(r));
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||""));
const audit=(c,action,id,before,after,reason)=>rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:action,p_entity_type:"session",p_entity_id:id,p_source:"mini_app",p_before:before,p_after:after,p_metadata:{reason}})});

async function coachStudentIds(c){
 const links=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&ended_at=is.null&select=student_id`);
 return new Set(links.map(x=>x.student_id));
}
async function ensureStudent(c,studentId){
 if(!isUuid(studentId))throw Object.assign(new Error("請選擇學員"),{status:400});
 if(c.roles.includes("coach")){
  const ids=await coachStudentIds(c);if(!ids.has(studentId))throw Object.assign(new Error("這位學員未指派給你"),{status:403});
 }else if(!manager(c))throw Object.assign(new Error("權限不足"),{status:403});
}
async function getSession(c,id){
 if(!isUuid(id))throw Object.assign(new Error("課程資料不正確"),{status:400});
 const x=(await rows(c.url,c.headers,`sessions?id=eq.${id}&select=*`))[0];
 if(!x)throw Object.assign(new Error("找不到課程"),{status:404});
 if(c.roles.includes("coach")&&x.coach_id!==c.user.id)throw Object.assign(new Error("你不能修改其他教練的課程"),{status:403});
 await ensureStudent(c,x.student_id);return x;
}
async function sessionList(c,req){
 const from=new Date(String(req.query.from||new Date(Date.now()-7*86400000).toISOString()));
 const to=new Date(String(req.query.to||new Date(Date.now()+31*86400000).toISOString()));
 if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||to<=from)return {status:400,error:"日期範圍不正確"};
 let filter="";
 if(c.roles.includes("coach"))filter=`&coach_id=eq.${c.user.id}`;
 else if(!manager(c))return {status:403,error:"權限不足"};
 const sessions=await rows(c.url,c.headers,`sessions?scheduled_at=gte.${from.toISOString()}&scheduled_at=lt.${to.toISOString()}${filter}&select=id,student_id,coach_id,package_id,scheduled_at,completed_at,status&order=scheduled_at.asc&limit=500`);
 const ids=[...new Set(sessions.map(x=>x.student_id))];let students=[];
 if(ids.length)students=await rows(c.url,c.headers,`students?id=in.(${encodeURIComponent(ids.map(x=>`"${x}"`).join(","))})&select=id,name,phone`);
 const names=Object.fromEntries(students.map(x=>[x.id,x]));
 return {sessions:sessions.map(x=>({...x,student_name:names[x.student_id]?.name||"學員",student_phone:names[x.student_id]?.phone||null}))};
}

module.exports=async function(req,res){
 try{
  const c=await context(req,["coach","manager","admin"]);
  if(req.method==="POST"){
   const b=req.body||{},action=String(b.action||"");
   if(action==="create_session"){
    const studentId=String(b.studentId||""),when=new Date(String(b.scheduledAt||""));await ensureStudent(c,studentId);
    if(Number.isNaN(when.getTime()))return res.status(400).json({error:"請選擇上課日期與時間"});
    const packages=await rows(c.url,c.headers,`packages?student_id=eq.${studentId}&status=eq.active&voided_at=is.null&remaining_sessions=gt.0&select=id,remaining_sessions,expires_at&order=purchased_at.desc&limit=1`);
    if(!packages[0])return res.status(400).json({error:"學員沒有可用的課程方案"});
    const collision=await rows(c.url,c.headers,`sessions?coach_id=eq.${c.user.id}&scheduled_at=eq.${encodeURIComponent(when.toISOString())}&status=eq.scheduled&select=id`);
    if(collision.length)return res.status(409).json({error:"這個時段已經有課程"});
    const created=await rows(c.url,c.headers,"sessions",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({student_id:studentId,coach_id:c.user.id,package_id:packages[0].id,scheduled_at:when.toISOString(),status:"scheduled"})});
    await audit(c,"create",created[0].id,null,created[0],"Mini App 建立課程");return res.status(201).json({session:created[0]});
   }
   const old=await getSession(c,String(b.sessionId||"")),reason=String(b.reason||"").trim();
   if(action==="update_session"){
    if(old.status!=="scheduled")return res.status(409).json({error:"只有尚未完成的課程可以改期"});
    if(!reason)return res.status(400).json({error:"請填寫改期原因"});
    const when=new Date(String(b.scheduledAt||""));if(Number.isNaN(when.getTime()))return res.status(400).json({error:"請選擇新的日期與時間"});
    const collision=await rows(c.url,c.headers,`sessions?coach_id=eq.${old.coach_id}&scheduled_at=eq.${encodeURIComponent(when.toISOString())}&status=eq.scheduled&id=neq.${old.id}&select=id`);
    if(collision.length)return res.status(409).json({error:"這個時段已經有課程"});
    const changed=await rows(c.url,c.headers,`sessions?id=eq.${old.id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({scheduled_at:when.toISOString()})});await audit(c,"update",old.id,old,changed[0],reason);return res.json({session:changed[0]});
   }
   if(action==="cancel_session"){
    if(old.status!=="scheduled")return res.status(409).json({error:"只有尚未完成的課程可以取消"});
    if(!reason)return res.status(400).json({error:"請填寫取消原因"});
    const changed=await rows(c.url,c.headers,`sessions?id=eq.${old.id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"cancelled"})});await audit(c,"cancel",old.id,old,changed[0],reason);return res.json({session:changed[0]});
   }
   if(action==="complete_session"){
    if(old.status!=="scheduled")return res.status(409).json({error:"這堂課目前不能完成"});
    const result=await rows(c.url,c.headers,"rpc/complete_session_and_deduct",{method:"POST",body:JSON.stringify({p_session_id:old.id,p_coach_id:old.coach_id})});return res.json({session:Array.isArray(result)?result[0]:result});
   }
   if(action==="restore_session"){
    if(old.status!=="completed")return res.status(409).json({error:"只有已完成的課程可以復原"});
    if(!reason)return res.status(400).json({error:"請填寫復原原因"});
    const result=await rows(c.url,c.headers,"rpc/reopen_session_and_restore",{method:"POST",body:JSON.stringify({p_session_id:old.id,p_actor:c.user.id,p_reason:reason})});return res.json({session:Array.isArray(result)?result[0]:result});
   }
   return res.status(400).json({error:"不支援的課程操作"});
  }
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  if(req.query.scope==="sessions"){
   const result=await sessionList(c,req);if(result.error)return res.status(result.status).json({error:result.error});return res.json(result);
  }
  const now=new Date(), start=new Date(now);start.setUTCHours(0,0,0,0);start.setUTCHours(start.getUTCHours()-8);
  const end=new Date(start.getTime()+86400000),month=new Date(start);month.setUTCDate(1);
  const coachFilter=c.roles.includes("coach")?`&coach_id=eq.${c.user.id}`:"", studentIds=c.roles.includes("coach")?await coachStudentIds(c):null;
  const [allStudents,sessions,pending,monthDone]=await Promise.all([
   studentIds?Promise.resolve([...studentIds].map(id=>({id}))):rows(c.url,c.headers,"students?status=eq.active&select=id"),
   rows(c.url,c.headers,`sessions?scheduled_at=gte.${start.toISOString()}&scheduled_at=lt.${end.toISOString()}${coachFilter}&select=id,student_id,scheduled_at,status&order=scheduled_at.asc`),
   rows(c.url,c.headers,`sessions?status=eq.scheduled&scheduled_at=lt.${now.toISOString()}${coachFilter}&select=id`),
   rows(c.url,c.headers,`sessions?status=eq.completed&completed_at=gte.${month.toISOString()}${coachFilter}&select=id`)
  ]);
  const ids=[...new Set(sessions.map(x=>x.student_id))];let names=[];if(ids.length)names=await rows(c.url,c.headers,`students?id=in.(${encodeURIComponent(ids.map(x=>`"${x}"`).join(","))})&select=id,name`);
  const map=Object.fromEntries(names.map(x=>[x.id,x.name]));return res.json({version:"2.0",metrics:{students:allStudents.length,today:sessions.length,pending:pending.length,monthCompleted:monthDone.length},today:sessions.map(x=>({...x,student_name:map[x.student_id]||"學員"}))});
 }catch(e){return fail(res,e)}
};
