const {context,rows,fail}=require("./_lib");
module.exports=async function(req,res){
 try{
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const c=await context(req,["coach","manager","admin"]), now=new Date(), start=new Date(now);
  start.setUTCHours(0,0,0,0); start.setUTCHours(start.getUTCHours()-8);
  const end=new Date(start.getTime()+86400000), month=new Date(start); month.setUTCDate(1);
  const manager=c.roles.some(r=>["manager","admin"].includes(r)), coachFilter=manager?"":`&coach_id=eq.${c.user.id}`;
  const [students,sessions,pending,monthDone]=await Promise.all([
   manager?rows(c.url,c.headers,"students?status=eq.active&select=id"):
    rows(c.url,c.headers,`coach_students?coach_id=eq.${c.user.id}&ended_at=is.null&select=student_id`),
   rows(c.url,c.headers,`sessions?scheduled_at=gte.${start.toISOString()}&scheduled_at=lt.${end.toISOString()}${coachFilter}&select=id,student_id,scheduled_at,status&order=scheduled_at.asc`),
   rows(c.url,c.headers,`sessions?status=eq.scheduled&scheduled_at=lt.${now.toISOString()}${coachFilter}&select=id`),
   rows(c.url,c.headers,`sessions?status=eq.completed&completed_at=gte.${month.toISOString()}${coachFilter}&select=id`)
  ]);
  const ids=[...new Set(sessions.map(x=>x.student_id))]; let names=[];
  if(ids.length)names=await rows(c.url,c.headers,`students?id=in.(${encodeURIComponent(ids.map(x=>`"${x}"`).join(","))})&select=id,name`);
  const map=Object.fromEntries(names.map(x=>[x.id,x.name]));
  res.json({version:"1.0",metrics:{students:students.length,today:sessions.length,pending:pending.length,monthCompleted:monthDone.length},today:sessions.map(x=>({...x,student_name:map[x.student_id]||"學員"}))});
 }catch(e){return fail(res,e)}
};
