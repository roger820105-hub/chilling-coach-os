const {context,rows,fail}=require("./_lib");
module.exports=async function(req,res){
 try{
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const c=await context(req,["coach","manager","admin"]), id=String(req.query.student_id||"");
  if(!id)return res.status(400).json({error:"student_id required"});
  if(c.roles.includes("coach")&&!c.roles.some(x=>["manager","admin"].includes(x))){
   const access=await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&student_id=eq.${id}&ended_at=is.null&select=id`);
   if(!access.length)return res.status(403).json({error:"Student not assigned"});
  }
  const [student,packages,sessions,exercises,measurements,assessments,plans,goals]=await Promise.all([
   rows(c.url,c.headers,`students?id=eq.${id}&select=*`), rows(c.url,c.headers,`packages?student_id=eq.${id}&select=*&order=purchased_at.desc`),
   rows(c.url,c.headers,`sessions?student_id=eq.${id}&select=*&order=scheduled_at.desc&limit=50`),
   rows(c.url,c.headers,`session_exercises?student_id=eq.${id}&select=*&order=created_at.desc&limit=100`),
   rows(c.url,c.headers,`body_measurements?student_id=eq.${id}&archived_at=is.null&select=*&order=measured_at.asc`),
   rows(c.url,c.headers,`student_assessments?student_id=eq.${id}&archived_at=is.null&select=*&order=assessed_at.desc`),
   rows(c.url,c.headers,`student_training_plans?student_id=eq.${id}&select=*&order=starts_on.desc`),
   rows(c.url,c.headers,`student_goals?student_id=eq.${id}&select=*&order=created_at.desc`)
  ]);
  if(!student[0])return res.status(404).json({error:"Student not found"});
  res.json({student:student[0],packages,sessions,exercises,measurements,assessments,plans,goals});
 }catch(e){return fail(res,e)}
};
