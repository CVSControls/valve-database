import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json'}});
const roles=new Set(['user','admin','uploader']);
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
  const bearer=request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if(!bearer)return reply({error:'Authentication required'},401);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!key)return reply({error:'Server account management is not configured'},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:{user},error:authError}=await admin.auth.getUser(bearer);
  if(authError||!user)return reply({error:'Invalid or expired login'},401);
  const{data:caller,error:profileError}=await admin.from('profiles').select('role,is_active,email').eq('id',user.id).single();
  if(profileError||!caller?.is_active||caller.role!=='admin')return reply({error:'Administrator access required'},403);
  if(Number(request.headers.get('content-length')||0)>8192)return reply({error:'Request too large'},413);
  const raw=await request.text();if(raw.length>8192)return reply({error:'Request too large'},413);
  const body=JSON.parse(raw),path=String(body.path||''),method=String(body.method||'');
  const password=()=>{if(typeof body.password!=='string'||body.password.length<6||body.password.length>256)throw new Error('Password must be 6–256 characters');return body.password};
  const audit=async(action:string,id:string)=>{
   const{error}=await admin.from('audit_events').insert({actor_id:user.id,username:caller.email,action,entity_type:'user',details:{id}});
   if(error)throw new Error('Account was changed, but its audit event could not be saved.');
  };
  if(path==='/admin/users'&&method==='POST'){
   const email=String(body.username||'').trim().toLowerCase();
   if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!roles.has(body.role))return reply({error:'Enter a valid email and role'},400);
   const{data,error}=await admin.auth.admin.createUser({email,password:password(),email_confirm:true});
   if(error)return reply({error:error.message},400);
   const id=data.user!.id;
   const{error:saveError}=await admin.from('profiles').update({role:body.role,is_active:true}).eq('id',id);
   if(saveError){await admin.auth.admin.deleteUser(id);return reply({error:'Could not configure the new account'},500)}
   await audit('user.create',id);return reply({id});
  }
  const match=path.match(/^\/admin\/users\/([a-f0-9-]{36})(\/reset-password)?$/i);
  if(!match)return reply({error:'Unknown account operation'},404);
  const id=match[1];
  if(!match[2]&&method==='DELETE'&&id===user.id)
   return reply({error:'You cannot delete your own account.'},400);
  const{data:target,error:targetError}=await admin.from('profiles').select('role,is_active').eq('id',id).single();
  if(targetError||!target)return reply({error:'Account not found'},404);
  if(!match[2]&&method==='DELETE'){
   if(target.role==='admin'&&target.is_active)
    return reply({error:'Active administrators cannot be deleted here. Use the Supabase dashboard.'},400);
   // Auth deletion also removes the profile through its foreign-key cascade.
   const{error}=await admin.auth.admin.deleteUser(id);
   if(error)return reply({error:error.message},400);
   await audit('user.delete',id);return reply({ok:true});
  }
  if(match[2]&&method==='POST'){
   const{error}=await admin.auth.admin.updateUserById(id,{password:password()});if(error)return reply({error:error.message},400);
   await audit('user.password_reset',id);return reply({ok:true});
  }
  if(!match[2]&&method==='PUT'){
   if(!roles.has(body.role)||typeof body.is_active!=='boolean')return reply({error:'Invalid role or status'},400);
   if(target.role==='admin'&&target.is_active&&(!body.is_active||body.role!=='admin'))
    return reply({error:'Active administrators cannot be disabled or demoted here. Use the Supabase dashboard.'},400);
   const{error}=await admin.from('profiles').update({role:body.role,is_active:body.is_active}).eq('id',id);
   if(error)return reply({error:'Could not update the account'},500);
   await audit('user.update',id);return reply({ok:true});
  }
  return reply({error:'Unknown account operation'},404);
 }catch(error){return reply({error:error instanceof Error?error.message:'Account operation failed'},400)}
});
