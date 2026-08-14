const {context,rows,fail}=require("./_lib");

module.exports=async function(req,res){
 try{
  if(req.method==="POST"){
   if(req.body?.action==="set_role"){
    const c=await context(req,["manager","admin"]),userId=String(req.body?.userId||""),role=String(req.body?.role||""),enabled=req.body?.enabled;
    if(!userId||!["coach","manager"].includes(role)||typeof enabled!=="boolean")return res.status(400).json({error:"人員、權限與狀態必填"});
    if(userId===c.user.id&&role==="manager"&&!enabled)return res.status(400).json({error:"不能移除自己的主管權限"});
    const user=(await rows(c.url,c.headers,`users?id=eq.${userId}&is_active=eq.true&select=id,display_name`))[0];if(!user)return res.status(404).json({error:"找不到使用者"});
    if(enabled)await rows(c.url,c.headers,"user_roles?on_conflict=user_id,role",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=minimal"},body:JSON.stringify({user_id:userId,role})});
    else await rows(c.url,c.headers,`user_roles?user_id=eq.${userId}&role=eq.${role}`,{method:"DELETE"});
    await rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:enabled?"grant":"revoke",p_entity_type:"user_role",p_entity_id:`${userId}:${role}`,p_source:"mini_app",p_after:{user_id:userId,role,enabled}})});
    return res.json({ok:true,user,role,enabled});
   }
   const c=await context(req), role=String(req.body?.role||"coach");
   if(role!=="coach")return res.status(400).json({error:"Only coach requests are available"});
   if(c.roles.includes("coach"))return res.status(409).json({error:"Coach role already granted"});
   const existing=await rows(c.url,c.headers,`role_requests?user_id=eq.${c.user.id}&requested_role=eq.coach&status=eq.pending&select=id,status,requested_at`);
   if(existing[0])return res.status(200).json({request:existing[0],created:false});
   const created=await rows(c.url,c.headers,"role_requests",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:c.user.id,requested_role:"coach",status:"pending"})});
   await rows(c.url,c.headers,"rpc/write_audit_log",{method:"POST",body:JSON.stringify({p_actor:c.user.id,p_action:"request",p_entity_type:"role_request",p_entity_id:created[0].id,p_source:"mini_app",p_after:created[0]})});
   return res.status(201).json({request:created[0],created:true});
  }
  if(req.method==="GET"){
   const c=await context(req,["manager","admin"]);
   if(req.query?.scope==="users"){
    const [users,roleRows]=await Promise.all([rows(c.url,c.headers,"users?is_active=eq.true&select=id,display_name,created_at&order=display_name.asc"),rows(c.url,c.headers,"user_roles?select=user_id,role")]);
    const byUser=new Map();for(const x of roleRows){if(!byUser.has(x.user_id))byUser.set(x.user_id,[]);byUser.get(x.user_id).push(x.role)}
    return res.json({users:users.map(x=>({...x,roles:byUser.get(x.id)||[]}))});
   }
   const requests=await rows(c.url,c.headers,"role_requests?status=eq.pending&select=id,user_id,requested_role,requested_at,status&order=requested_at.asc");
   const ids=[...new Set(requests.map(x=>x.user_id))]; let users=[];
   if(ids.length)users=await rows(c.url,c.headers,`users?id=in.(${encodeURIComponent(ids.map(x=>`"${x}"`).join(","))})&select=id,display_name,created_at`);
   const map=Object.fromEntries(users.map(x=>[x.id,x]));
   return res.json({requests:requests.map(x=>({...x,display_name:map[x.user_id]?.display_name||"LINE 使用者",user_created_at:map[x.user_id]?.created_at}))});
  }
  return res.status(405).json({error:"Method not allowed"});
 }catch(e){return fail(res,e)}
};
