const {context,rows,fail}=require("./_lib");
module.exports=async function(req,res){
 try{
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
  const c=await context(req,["manager","admin"]), id=String(req.body?.requestId||""), approve=req.body?.approve;
  if(!id||typeof approve!=="boolean")return res.status(400).json({error:"requestId and approve are required"});
  const result=await rows(c.url,c.headers,"rpc/review_role_request",{method:"POST",body:JSON.stringify({p_request_id:id,p_reviewer:c.user.id,p_approve:approve,p_note:String(req.body?.note||"").slice(0,500)||null})});
  return res.json({request:Array.isArray(result)?result[0]:result});
 }catch(e){return fail(res,e)}
};
