const dbHeaders = secret => ({apikey:secret,Authorization:`Bearer ${secret}`,"Content-Type":"application/json"});

function config(){
  const url=process.env.SUPABASE_URL, secret=process.env.SUPABASE_SECRET_KEY;
  if(!url||!secret) throw Object.assign(new Error("Server environment is not configured"),{status:500});
  return {url,secret,headers:dbHeaders(secret)};
}
async function lineProfile(req){
  const auth=req.headers.authorization||"", token=auth.startsWith("Bearer ")?auth.slice(7):null;
  if(!token) throw Object.assign(new Error("Missing LINE access token"),{status:401});
  const r=await fetch("https://api.line.me/v2/profile",{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw Object.assign(new Error("Invalid or expired LINE access token"),{status:401});
  return r.json();
}
async function rows(url,headers,path,options={}){
  const r=await fetch(`${url}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});
  if(!r.ok) throw new Error(`${path}: ${await r.text()}`);
  if(r.status===204)return [];
  return r.json();
}
async function context(req,allowed=[]){
  const {url,headers}=config(), profile=await lineProfile(req);
  const found=await rows(url,headers,`users?line_user_id=eq.${encodeURIComponent(profile.userId)}&is_active=eq.true&select=id,display_name,default_location_id`);
  if(!found[0]) throw Object.assign(new Error("System account not found"),{status:403});
  const roleRows=await rows(url,headers,`user_roles?user_id=eq.${found[0].id}&select=role`);
  const roles=roleRows.map(x=>x.role);
  if(allowed.length&&!allowed.some(x=>roles.includes(x))) throw Object.assign(new Error("Insufficient role"),{status:403});
  return {url,headers,user:found[0],roles};
}
function fail(res,error){ console.error(error); return res.status(error.status||500).json({error:error.status?error.message:"Internal server error"}); }
function taipeiDay(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei"}).format(new Date());}
module.exports={config,lineProfile,rows,context,fail,taipeiDay};
