
async function profile(token){
  const r=await fetch("https://api.line.me/v2/profile",{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok)throw Object.assign(new Error("Invalid LINE token"),{status:401});
  return r.json();
}
const h=s=>({apikey:s,Authorization:`Bearer ${s}`,"Content-Type":"application/json"});
async function userByLine(url,s,lineId){
  const headers=h(s);
  const r=await fetch(`${url}/rest/v1/users?line_user_id=eq.${encodeURIComponent(lineId)}&is_active=eq.true&select=id`,{headers});
  const rows=r.ok?await r.json():[];
  if(!rows[0])throw Object.assign(new Error("System user not found"),{status:403});
  return {user:rows[0],headers};
}
async function allowed(url,headers,userId,studentId){
  const r=await fetch(`${url}/rest/v1/coach_students?coach_id=eq.${encodeURIComponent(userId)}&student_id=eq.${encodeURIComponent(studentId)}&ended_at=is.null&select=id`,{headers});
  return r.ok&&(await r.json()).length>0;
}
module.exports=async function(req,res){
  try{
    const url=process.env.SUPABASE_URL,s=process.env.SUPABASE_SECRET_KEY;
    const auth=req.headers.authorization||"",token=auth.startsWith("Bearer ")?auth.slice(7):null;
    if(!url||!s)return res.status(500).json({error:"Server environment is not configured"});
    if(!token)return res.status(401).json({error:"Missing LINE access token"});
    const p=await profile(token),{user,headers}=await userByLine(url,s,p.userId);

    if(req.method==="GET"){
      const studentId=String(req.query.student_id||"");
      if(!studentId)return res.status(400).json({error:"student_id required"});
      if(!(await allowed(url,headers,user.id,studentId)))return res.status(403).json({error:"Student not assigned"});
      const r=await fetch(`${url}/rest/v1/packages?student_id=eq.${encodeURIComponent(studentId)}&status=eq.active&select=id,package_name,purchased_sessions,remaining_sessions,price,purchased_at,expires_at,status&order=purchased_at.desc&limit=1`,{headers});
      if(!r.ok)throw new Error(await r.text());
      const rows=await r.json();
      return res.status(200).json({package:rows[0]||null});
    }

    if(req.method==="POST"){
      const b=req.body||{},sessions=Number(b.purchasedSessions);
      if(!b.studentId||!Number.isInteger(sessions)||sessions<=0)return res.status(400).json({error:"Invalid input"});
      if(!(await allowed(url,headers,user.id,b.studentId)))return res.status(403).json({error:"Student not assigned"});
      const r=await fetch(`${url}/rest/v1/packages`,{method:"POST",headers:{...headers,Prefer:"return=representation"},body:JSON.stringify({
        student_id:b.studentId,coach_id:user.id,package_name:String(b.packageName||"").trim()||null,
        purchased_sessions:sessions,remaining_sessions:sessions,price:Number(b.price||0),
        expires_at:b.expiresAt||null,status:"active"
      })});
      if(!r.ok)throw new Error(await r.text());
      return res.status(201).json({package:(await r.json())[0]});
    }
    return res.status(405).json({error:"Method not allowed"});
  }catch(e){console.error(e);return res.status(e.status||500).json({error:e.status?e.message:"Internal server error"});}
};
