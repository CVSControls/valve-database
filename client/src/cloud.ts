import {createClient} from '@supabase/supabase-js';
export const supabase=createClient('https://wypktkhfeiaebllftxll.supabase.co','sb_publishable_4OJAxRbN6KkcyRNWFAoD4w_qhwl2tkE');
export const bucket='valve-databases';
let profile:any=null;
export function currentProfile(){return profile}
export async function refreshProfile(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){profile=null;return null}
 const {data,error}=await supabase.from('profiles').select('*').eq('id',session.user.id).single();
 if(error){profile=null;throw new Error('Your account is not configured. Ask an administrator to complete Supabase setup.')}
 if(!data.is_active){profile=null;throw new Error('This account is disabled.')}
 if(data.role==='uploader'){profile=null;throw new Error('Use a viewer or administrator account for this website.')}
 profile={...data,username:data.email};return profile;
}
export async function cloudAuth(path:string,body:any={}){
 if(path==='/auth/setup-status')return{required:false};
 if(path==='/auth/login'){
  const {error}=await supabase.auth.signInWithPassword({email:String(body.username).trim(),password:body.password});if(error)throw error;
  try{return{user:await refreshProfile(),csrfToken:''}}catch(error){await supabase.auth.signOut();throw error}
 }
 if(path==='/auth/logout'){const{error}=await supabase.auth.signOut();if(error)throw error;profile=null;return null}
 return{user:await refreshProfile(),csrfToken:''};
}
export async function cloudUsers(path:string,method:string,body:any){
 if(method==='GET'){const{data,error}=await supabase.from('profiles').select('*').order('created_at');if(error)throw error;return data.map(row=>({...row,username:row.email}))}
 const{data,error}=await supabase.functions.invoke('manage-users',{body:{path,method,...body}});
 if(error){const detail=await error.context?.json?.().catch(()=>null);throw new Error(detail?.error||error.message)}
 if(data?.error)throw new Error(data.error);return data;
}
export async function sources(){
 const{data,error}=await supabase.from('database_sources').select('*');if(error)throw error;
 return data.map(row=>({...row,sha:row.sha256,file_size_bytes:row.size_bytes,validation_status:'valid',validationReport:row.validation_report}));
}
export async function uploadDatabase(type:string,bytes:Uint8Array,name:string,report:any){
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const storagePath=`${type}/${sha}.db`;
 const{error:uploadError}=await supabase.storage.from(bucket).upload(storagePath,new Blob([new Uint8Array(bytes).buffer],{type:'application/octet-stream'}),{upsert:false});
 if(uploadError&&!/already exists|duplicate/i.test(uploadError.message))throw uploadError;
 const {error}=await supabase.rpc('activate_database',{p_type:type,p_path:storagePath,p_sha:sha,p_name:name,p_size:bytes.byteLength,p_report:report});if(error)throw error;
 return sha;
}
supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')profile=null});
