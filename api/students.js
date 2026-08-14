const {context,rows,fail}=require("./_lib");
const isManager=c=>c.roles.some(x=>["manager","admin"].includes(x));
async function access(c,id){if(isManager(c))return;const x=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&student_id=eq.${id}&ended_at=is.null&select=id`);if(!x.length)throw Object.assign(new Error("Student not assigned"),{status:403});}
const audit=(c,action,id,before,after,reason)=>rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:action,p_entity_type:"student",p_entity_id:id,p_source:"mini_app",p_before:before,p_after:after,p_metadata:{reason}})});
const phoneData=value=>{const phone=String(value||"").trim(),normalizedPhone=phone.replace(/[^0-9]/g,"");if(!phone||normalizedPhone.length<8||normalizedPhone.length>15)throw Object.assign(new Error("請輸入正確的電話號碼"),{status:400});return{phone,normalizedPhone}};
async function duplicatePhone(c,normalized,id=""){const x=await rows(c.url,c.headers,`students?normalized_phone=eq.${encodeURIComponent(normalized)}${id?`&id=neq.${id}`:""}&select=id,name&limit=1`);if(x[0])throw Object.assign(new Error(`此電話已屬於學員 ${x[0].name}`),{status:409});}

module.exports=async function(req,res){try{
 const c=await context(req,["coach","manager","admin"]);
 if(req.method==="GET"){
  let query="students?archived_at=is.null&select=id,name,phone,status,joined_at,note,birthday,gender,tags,created_at&order=created_at.desc";
  // A dual-role manager/coach must still see only their own roster in Coach View.
  // All-student access is returned only when Manager View explicitly requests it.
  const coachScope=c.roles.includes("coach")&&String(req.query.scope||"coach")!=="manager";
  if(coachScope||!isManager(c)){const links=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&ended_at=is.null&select=student_id`),ids=links.map(x=>x.student_id);if(!ids.length)return res.json({students:[]});query=`students?id=in.(${encodeURIComponent(ids.map(x=>`"${x}"`).join(","))})&archived_at=is.null&select=id,name,phone,status,joined_at,note,birthday,gender,tags,created_at&order=created_at.desc`;}
  return res.json({students:await rows(c.url,c.headers,query)});
 }
 const b=req.body||{};
 if(req.method==="POST"){
  const name=String(b.name||"").trim(),{phone,normalizedPhone}=phoneData(b.phone),note=String(b.note||"").trim();if(!name||name.length>50||note.length>500)return res.status(400).json({error:"請確認姓名與備註長度"});await duplicatePhone(c,normalizedPhone);
  const student=(await rows(c.url,c.headers,"students",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({name,phone,note:note||null,status:"active",birthday:b.birthday||null,gender:b.gender||null,tags:Array.isArray(b.tags)?b.tags:[]})}))[0];
  await rows(c.url,c.headers,"coach_students",{method:"POST",body:JSON.stringify({coach_id:c.user.id,student_id:student.id,is_primary:true})});return res.status(201).json({student});
 }
 if(req.method!=="PATCH")return res.status(405).json({error:"Method not allowed"});
 const id=String(b.studentId||""),action=String(b.action||"update"),reason=String(b.reason||"").trim();if(!id)return res.status(400).json({error:"studentId required"});await access(c,id);const old=(await rows(c.url,c.headers,`students?id=eq.${id}&select=*`))[0];if(!old)return res.status(404).json({error:"Student not found"});
 if(action==="update"){
  const name=String(b.name||"").trim(),{phone,normalizedPhone}=phoneData(b.phone);if(!name||name.length>50)return res.status(400).json({error:"請輸入學員姓名"});await duplicatePhone(c,normalizedPhone,id);
  const patch={name,phone,note:String(b.note||"").trim().slice(0,500)||null,status:["active","paused","inactive"].includes(b.status)?b.status:"active",birthday:b.birthday||null,gender:b.gender||null,tags:Array.isArray(b.tags)?b.tags.map(String).slice(0,20):[],updated_at:new Date().toISOString()};
  const result=await rows(c.url,c.headers,`students?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify(patch)});await audit(c,"update",id,old,result[0],reason||"編輯學員資料");return res.json({student:result[0]});
 }
 if(action==="archive"){
  if(!reason)return res.status(400).json({error:"請填寫結案原因"});const result=await rows(c.url,c.headers,`students?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"inactive",archived_at:new Date().toISOString(),updated_at:new Date().toISOString()})});await audit(c,"archive",id,old,result[0],reason);return res.json({student:result[0]});
 }
 if(action==="transfer"){
  if(!isManager(c))return res.status(403).json({error:"轉移教練需主管權限"});const coachId=String(b.coachId||"");if(!coachId)return res.status(400).json({error:"請選擇新教練"});await rows(c.url,c.headers,`coach_students?student_id=eq.${id}&ended_at=is.null`,{method:"PATCH",body:JSON.stringify({ended_at:new Date().toISOString()})});await rows(c.url,c.headers,"coach_students",{method:"POST",body:JSON.stringify({student_id:id,coach_id:coachId,is_primary:true})});await audit(c,"transfer",id,old,old,reason||"主管轉移教練");return res.json({ok:true});
 }
 return res.status(400).json({error:"Unsupported action"});
}catch(e){return fail(res,e)}};
