const {context,rows,fail}=require("./_lib");
module.exports=async function(req,res){
 try{
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const c=await context(req,["manager","admin"]), id=String(req.body?.requestId||""), approve=req.body?.approve===true;
  if(!/^[0-9a-f-]{36}$/i.test(id))return res.status(400).json({error:"Invalid request"});
  const result=await rows(c.url,c.headers,"rpc/review_leave_request",{method:"POST",body:JSON.stringify({p_request_id:id,p_reviewer:c.user.id,p_approve:approve,p_note:String(req.body?.note||"").slice(0,500)||null})});
  res.json({request:result});
 }catch(e){return fail(res,e)}
};
