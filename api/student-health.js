const {context,rows,fail}=require("./_lib");

const numberOrNull=value=>value===""||value==null?null:Number(value);
async function requireStudentAccess(c,studentId){
 const student=await rows(c.url,c.headers,`students?id=eq.${encodeURIComponent(studentId)}&select=id,name`);
 if(!student[0])throw Object.assign(new Error("Student not found"),{status:404});
 if(c.roles.includes("coach")&&!c.roles.some(x=>["manager","admin"].includes(x))){
  const link=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&student_id=eq.${studentId}&ended_at=is.null&select=id`);
  if(!link.length)throw Object.assign(new Error("Student not assigned"),{status:403});
 }
 return student[0];
}
async function audit(c,action,type,id,after){
 await rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:action,p_entity_type:type,p_entity_id:id,p_source:"mini_app",p_after:after})});
}
module.exports=async function(req,res){
 try{
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const c=await context(req,["coach","manager","admin"]), b=req.body||{}, studentId=String(b.studentId||""), type=String(b.type||"");
  if(!studentId)return res.status(400).json({error:"studentId required"});
  await requireStudentAccess(c,studentId);
  if(type==="measurement"){
   const values={weight_kg:numberOrNull(b.weightKg),body_fat_pct:numberOrNull(b.bodyFatPct),muscle_mass_kg:numberOrNull(b.muscleMassKg),waist_cm:numberOrNull(b.waistCm),hip_cm:numberOrNull(b.hipCm),chest_cm:numberOrNull(b.chestCm)};
   if(Object.values(values).every(v=>v===null))return res.status(400).json({error:"At least one measurement is required"});
   if(values.weight_kg!==null&&(values.weight_kg<=0||values.weight_kg>500))return res.status(400).json({error:"Invalid weight"});
   if(values.body_fat_pct!==null&&(values.body_fat_pct<0||values.body_fat_pct>100))return res.status(400).json({error:"Invalid body fat percentage"});
   const payload={student_id:studentId,measured_at:b.measuredAt||new Date().toISOString(),...values,source:"manual",note:String(b.note||"").trim().slice(0,1000)||null,recorded_by:c.user.id};
   const created=await rows(c.url,c.headers,"body_measurements",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
   await audit(c,"create","body_measurement",created[0].id,created[0]); return res.status(201).json({record:created[0]});
  }
  if(type==="assessment"){
   const assessmentType=String(b.assessmentType||"").trim(), injuries=String(b.injuries||"").trim(), limitations=String(b.limitations||"").trim(), note=String(b.note||"").trim();
   if(!assessmentType)return res.status(400).json({error:"Assessment type required"});
   const payload={student_id:studentId,assessment_type:assessmentType.slice(0,100),assessed_at:b.assessedAt||new Date().toISOString(),results:{summary:String(b.summary||"").trim().slice(0,2000)},injuries:injuries.slice(0,2000)||null,limitations:limitations.slice(0,2000)||null,note:note.slice(0,2000)||null,assessed_by:c.user.id};
   const created=await rows(c.url,c.headers,"student_assessments",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
   await audit(c,"create","student_assessment",created[0].id,created[0]); return res.status(201).json({record:created[0]});
  }
  if(type==="goal"){
   const title=String(b.title||"").trim(); if(!title)return res.status(400).json({error:"Goal title required"});
   const payload={student_id:studentId,title:title.slice(0,200),description:String(b.description||"").trim().slice(0,2000)||null,target_value:numberOrNull(b.targetValue),unit:String(b.unit||"").trim().slice(0,30)||null,target_date:b.targetDate||null,status:"active",created_by:c.user.id};
   const created=await rows(c.url,c.headers,"student_goals",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(payload)});
   await audit(c,"create","student_goal",created[0].id,created[0]); return res.status(201).json({record:created[0]});
  }
  return res.status(400).json({error:"Unsupported record type"});
 }catch(e){return fail(res,e)}
};
