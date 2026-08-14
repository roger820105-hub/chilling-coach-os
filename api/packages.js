const {context,rows,fail}=require("./_lib");

async function ensureAccess(c,studentId){
 if(c.roles.some(x=>["manager","admin"].includes(x)))return;
 const x=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&student_id=eq.${studentId}&ended_at=is.null&select=id`);
 if(!x.length)throw Object.assign(new Error("Student not assigned"),{status:403});
}
async function getPackage(c,id){
 const x=(await rows(c.url,c.headers,`packages?id=eq.${id}&select=*`))[0];
 if(!x)throw Object.assign(new Error("Package not found"),{status:404});
 await ensureAccess(c,x.student_id); return x;
}
const audit=(c,action,id,before,after,reason)=>rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:action,p_entity_type:"package",p_entity_id:id,p_source:"mini_app",p_before:before,p_after:after,p_metadata:{reason}})});

module.exports=async function(req,res){try{
 const c=await context(req,["coach","manager","admin"]);
 if(req.method==="GET"){
  const studentId=String(req.query.student_id||"");if(!studentId)return res.status(400).json({error:"student_id required"});await ensureAccess(c,studentId);
  const packages=await rows(c.url,c.headers,`packages?student_id=eq.${studentId}&select=*&order=purchased_at.desc`);
  const ids=packages.map(x=>x.id);let adjustments=[];
  if(ids.length)adjustments=await rows(c.url,c.headers,`package_adjustments?package_id=in.(${encodeURIComponent(ids.map(x=>`"${x}"`).join(","))})&select=*&order=created_at.desc`);
  return res.json({package:packages.find(x=>x.status==="active"&&!x.voided_at)||null,packages,adjustments});
 }
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const b=req.body||{},action=String(b.action||"create");
 if(action==="create"){
  const sessions=Number(b.purchasedSessions);if(!b.studentId||!Number.isInteger(sessions)||sessions<=0||sessions>500)return res.status(400).json({error:"Invalid session count"});await ensureAccess(c,b.studentId);
  const created=await rows(c.url,c.headers,"packages",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({student_id:b.studentId,coach_id:c.user.id,package_name:String(b.packageName||"").trim()||null,purchased_sessions:sessions,remaining_sessions:sessions,price:Number(b.price||0),paid_amount:Number(b.price||0),payment_status:"paid",expires_at:b.expiresAt||null,status:"active",renewed_from_id:b.renewedFromId||null})});
  return res.status(201).json({package:created[0]});
 }
 const old=await getPackage(c,String(b.packageId||"")),reason=String(b.reason||"").trim();if(!reason)return res.status(400).json({error:"請填寫修改原因"});
 if(action==="adjust"){
  const purchased=Number(b.purchasedSessions),remaining=Number(b.remainingSessions);if(!Number.isInteger(purchased)||!Number.isInteger(remaining)||purchased<0||remaining<0||remaining>purchased||purchased>500)return res.status(400).json({error:"堂數不正確：剩餘堂數不可大於購買堂數"});
  const result=await rows(c.url,c.headers,"rpc/adjust_package_sessions",{method:"POST",body:JSON.stringify({p_package_id:old.id,p_actor:c.user.id,p_purchased:purchased,p_remaining:remaining,p_reason:reason})});return res.json({package:Array.isArray(result)?result[0]:result});
 }
 if(action==="update"){
  const patch={package_name:String(b.packageName||"").trim()||null,price:Number(b.price||0),paid_amount:Number(b.paidAmount??b.price??0),payment_status:["paid","partial","unpaid","refunded"].includes(b.paymentStatus)?b.paymentStatus:"paid",expires_at:b.expiresAt||null,frozen_until:b.frozenUntil||null,updated_at:new Date().toISOString()};
  const result=await rows(c.url,c.headers,`packages?id=eq.${old.id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});await audit(c,"update",old.id,old,result[0],reason);return res.json({package:result[0]});
 }
 if(action==="void"){
  if(!c.roles.some(x=>["manager","admin"].includes(x)))return res.status(403).json({error:"方案作廢需主管權限"});
  const result=await rows(c.url,c.headers,`packages?id=eq.${old.id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({voided_at:new Date().toISOString(),void_reason:reason,updated_at:new Date().toISOString()})});await audit(c,"void",old.id,old,result[0],reason);return res.json({package:result[0]});
 }
 return res.status(400).json({error:"Unsupported action"});
}catch(e){return fail(res,e)}};
