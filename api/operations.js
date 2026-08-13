const {context,rows,fail}=require("./_lib");

module.exports=async function(req,res){
 try{
  const c=await context(req,["manager","admin"]);
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());
  const monthStart=`${today.slice(0,7)}-01`;
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
