const {context,rows,fail}=require("./_lib");
module.exports=async function(req,res){
 try{
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const c=await context(req,["coach","manager","admin"]), q=String(req.body?.query||"").trim();
  if(!q||q.length>500)return res.status(400).json({error:"Query must be 1-500 characters"});
  const manager=c.roles.some(x=>["manager","admin"].includes(x));
  const links=!manager&&c.roles.includes("coach")?await rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&ended_at=is.null&select=student_id`):[];
  const filter=links.length?`&id=in.(${encodeURIComponent(links.map(x=>`"${x.student_id}"`).join(","))})`:"";
  const students=await rows(c.url,c.headers,`students?status=eq.active${filter}&select=id,name`);
  const student=students.find(s=>q.includes(s.name));
  if(!student)return res.json({answer:"請在問題中包含你有權限查看的學員姓名，例如「王小明最近進步怎樣？」。",intent:"help",sources:[]});
  const [sessions,measurements,exercises,pkg]=await Promise.all([
   rows(c.url,c.headers,`sessions?student_id=eq.${student.id}&select=id,scheduled_at,status&order=scheduled_at.desc&limit=20`),
   rows(c.url,c.headers,`body_measurements?student_id=eq.${student.id}&select=measured_at,weight_kg,body_fat_pct,muscle_mass_kg&order=measured_at.desc&limit=2`),
   rows(c.url,c.headers,`session_exercises?student_id=eq.${student.id}&select=exercise_name,weight_kg,reps,sets,rpe,created_at&order=created_at.desc&limit=30`),
   rows(c.url,c.headers,`packages?student_id=eq.${student.id}&status=eq.active&select=remaining_sessions,expires_at&order=purchased_at.desc&limit=1`)
  ]);
  const completed=sessions.filter(x=>x.status==="completed").length, upcoming=sessions.filter(x=>x.status==="scheduled"&&new Date(x.scheduled_at)>new Date()).length;
  const bits=[`${student.name}：最近資料中已完成 ${completed} 堂、未來預約 ${upcoming} 堂`,pkg[0]?`剩餘 ${pkg[0].remaining_sessions} 堂`:"目前沒有有效方案"];
  if(measurements[0])bits.push(`最近體重 ${measurements[0].weight_kg??"未記錄"} kg、體脂 ${measurements[0].body_fat_pct??"未記錄"}%`);
  if(exercises[0])bits.push(`最近動作為 ${exercises[0].exercise_name}（${exercises[0].weight_kg??"—"} kg × ${exercises[0].reps??"—"} × ${exercises[0].sets??"—"}）`);
  bits.push("此摘要只根據已儲存資料，不取代專業醫療判斷；下一堂建議需由教練確認傷病、疲勞與當日狀態。");
  res.json({answer:bits.join("；")+"。",intent:"student_summary",student_id:student.id,sources:["sessions","packages","body_measurements","session_exercises"]});
 }catch(e){return fail(res,e)}
};
