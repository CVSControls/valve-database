import initSqlJs, {type Database, type SqlJsStatic} from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import {supabase,bucket,currentProfile,refreshProfile,cloudAuth,cloudUsers,sources,uploadDatabase} from './cloud';
import {initialSettings} from './initial-settings';
import {defaultFields,defaultReferenceDisplays,defaultSections} from './default-settings';

type User={id:string;username:string;role:'admin'|'user'|'uploader';is_active:boolean;created_at:string};
type Settings={version:number;users:User[];displaySections:any[];displayFields:any[];referenceDisplays:Record<'actuators'|'brackets',any[]>;configuratorSettings?:ConfiguratorSettings;databaseSources:any[];auditLogs:any[];updatedAt:string|null};
type ConfiguratorSettings={mountingTolerance:number;packingGridTolerance:number;angleTolerance:number;squareTolerance:number};
type Source='hardware_configurator'|'manufacturing_log';
let SQL:SqlJsStatic,settings:Settings,hardware:Database|null=null,manufacturing:Database|null=null,ready:Promise<void>|null=null;
const now=()=>new Date().toISOString().slice(0,19).replace('T',' ');
let revision=0,lastRefresh=0,sessionEpoch=0;
const loadedHashes:Partial<Record<Source,string>>={};
let refreshing:Promise<void>|null=null;
const defaultConfiguratorSettings:ConfiguratorSettings={mountingTolerance:.03,packingGridTolerance:.08,angleTolerance:.51,squareTolerance:.01};
const hardwareTables:Record<string,string[]>={
 valves:['valve_id','valve_brand','valve_size','valve_class','valve_model_number','valve_port','stem_type','description'],
 valve_keyed_stems:['valve_id','stem_diameter','stem_height','key_qty','key_width','key_cross','valve_bhc','valve_hole_dia','valve_hole_qty','valve_start_angle'],
 valve_flat_stems:['valve_id','stem_height','flat_width','flat_depth','valve_bhc','valve_hole_dia','valve_hole_qty','valve_start_angle','packing_flange','packing_flange_width','packing_flange_length','packing_flange_angle','dia_reduction','dia_reduction_value','stem_thread','stem_thread_dia','stem_thread_depth','u_bolt','u_bolt_valve_width','u_bolt_valve_length','valve_pattern_type','valve_grid_x_distance','valve_grid_y_distance'],
 actuator_sets:['actuator_id','actuator_name','theme_name','bolt_size','square_size','square_height','sq_rad','d_stem','actuator_hole_dia','actuator_bhc','actuator_hole_qty','actuator_start_angle','bracket_height'],
 bracket_patterns:['bracket_id','bracket_code','part_number','actuator_1_bhc','actuator_1_hole_dia','actuator_1_hole_qty','actuator_1_start_angle','actuator_2_bhc','actuator_2_hole_dia','actuator_2_hole_qty','actuator_2_start_angle','actuator_3_bhc','actuator_3_hole_dia','actuator_3_hole_qty','actuator_3_start_angle','valve_bhc','valve_hole_dia','valve_hole_qty','valve_start_angle','valve_2_bhc','valve_2_hole_dia','valve_2_hole_qty','valve_2_start_angle','valve_3_bhc','valve_3_hole_dia','valve_3_hole_qty','valve_3_start_angle','bracket_width','bracket_length','bracket_height','actuator_bracket_center_hole','valve_bracket_center_hole','packing_flange','packing_flange_width','packing_flange_length','packing_flange_angle','d_actuator_bracket_center_hole_offset','d_actuator_bhc_offset','hole_grid_length','hole_grid_width'],
 universal_adapters:['id','universal_adapter_name','part_number','square_size','square_height','sq_rad','one_p_adapter_length','actuator_name','adapter_od_fixed'],
 iso_data:['id','iso_f','bhc','hole_dia','hole_qty','hole_angle','metric_bolt','imperial_bolt','square_size']
};
const manufacturingColumns=['id','timestamp','job_number','quantity','configuration_name','fusion_document_name','valve_id','valve_brand','valve_size','valve_class','valve_port','valve_model','actuator_name','Packing Flange','SCHA','U-Bolt','diameter reduction','stem thread','Body_Height','Hub_Height','Hub_ID','Hub_OD','actuator_bhc','actuator_bracket_center_hole','actuator_hole_dia','bracket_code','bracket_height','dia_reduction','flat_depth','flat_width','key_cross','key_width','packing_flange_angle','packing_flange_length','packing_flange_width','slot_depth','slot_width','square_height','square_size','stem_diameter','stem_height','valve_bhc','valve_bracket_center_hole','valve_hole_dia','valve_hole_qty','Adapter_OD','actuator_hole_qty','bracket_length','bracket_width','Bolt Pattern'];

async function initialize(){SQL=await initSqlJs({locateFile:()=>wasmUrl});}
export async function refreshCloud(){
 if(refreshing)return refreshing;
 const epoch=sessionEpoch;
 refreshing=(async()=>{
 await ensure();
 const user=await refreshProfile();if(!user)throw error('Authentication required',401);
 if(settings&&Date.now()-lastRefresh<180000)return;
 const {data,error:failure}=await supabase.from('app_settings').select('*').eq('id',1).single();if(failure)throw failure;
 const previousHashes=JSON.stringify(loadedHashes),previousRevision=revision;
 let value=data.value||{};revision=data.revision;
 if(Object.keys(value).length===0){
  value=structuredClone(initialSettings);
  if(user.role==='admin'){
   const{data:next,error:seedError}=await supabase.rpc('save_settings',{p_value:value,p_revision:revision});
   if(seedError)throw seedError;revision=next;
  }
 }
 const databaseSources=await sources();if(epoch!==sessionEpoch)throw error('Session changed. Please retry.',401);
 settings={version:1,users:[],auditLogs:[],updatedAt:data.updated_at,...value,databaseSources};
 settings.displaySections=settings.displaySections?.length?settings.displaySections:structuredClone(defaultSections);
 settings.displayFields=settings.displayFields?.length?settings.displayFields:structuredClone(defaultFields);
 mergeMissingDisplayFields();
 settings.referenceDisplays={actuators:settings.referenceDisplays?.actuators?.length?settings.referenceDisplays.actuators:structuredClone(defaultReferenceDisplays.actuators),brackets:settings.referenceDisplays?.brackets?.length?settings.referenceDisplays.brackets:structuredClone(defaultReferenceDisplays.brackets)};
 settings.configuratorSettings={...defaultConfiguratorSettings,...settings.configuratorSettings};
 await Promise.all([loadDatabase('hardware_configurator',epoch),loadDatabase('manufacturing_log',epoch)]);
 if(epoch!==sessionEpoch)throw error('Session changed. Please retry.',401);
 lastRefresh=Date.now();
 if(previousHashes!=='{}'&&(previousHashes!==JSON.stringify(loadedHashes)||previousRevision!==revision))window.dispatchEvent(new Event('vdb-data-updated'));
 })();try{await refreshing}finally{refreshing=null}
}
function clearSession(){sessionEpoch++;hardware?.close();manufacturing?.close();hardware=manufacturing=null;delete loadedHashes.hardware_configurator;delete loadedHashes.manufacturing_log;lastRefresh=0;}
supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clearSession()});
function mergeMissingDisplayFields(){const keys=new Set(settings.displayFields.map(x=>x.field_key)),ids=new Set(settings.displayFields.map(x=>x.id));let nextId=Math.max(0,...ids)+1;for(const field of defaultFields)if(!keys.has(field.field_key)){const id=ids.has(field.id)?nextId++:field.id;ids.add(id);settings.displayFields.push({...structuredClone(field),id})}}
const ensure=()=>ready||=(initialize());
function currentUser(){return currentProfile() as User|null}
function requireUser(admin=false){const u=currentUser();if(!u)throw error('Authentication required',401);if(admin&&u.role!=='admin')throw error('Administrator access required',403);return u}
function error(message:string,status=400){return Object.assign(new Error(message),{status})}
function rows(db:Database,sql:string,params:any[]=[]):any[]{const statement=db.prepare(sql);try{statement.bind(params);const out=[];while(statement.step())out.push(statement.getAsObject());return out}finally{statement.free()}}
function value(db:Database,sql:string,params:any[]=[]){return rows(db,sql,params)[0]}
async function loadDatabase(type:Source,epoch:number){
 const source=settings.databaseSources.find(x=>x.source_type===type);
 if(!source){if(type==='hardware_configurator'){hardware?.close();hardware=null}else{manufacturing?.close();manufacturing=null}delete loadedHashes[type];return}
 if(loadedHashes[type]===source.sha)return;
 const{data,error:failure}=await supabase.storage.from(bucket).download(source.storage_path);if(failure)throw failure;
 const bytes=new Uint8Array(await data.arrayBuffer());
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==source.sha)throw error('Database checksum does not match. Please retry.');
 if(epoch!==sessionEpoch)throw error('Session changed. Please retry.',401);
 validate(type,bytes);sessionSource(type,bytes);loadedHashes[type]=hash;
}
function dbFor(type:Source){const db=type==='hardware_configurator'?hardware:manufacturing;if(!db)throw error(`${type.replaceAll('_',' ')} database is not active`,503);return db}
function validate(type:Source,bytes:Uint8Array){let db:Database;try{db=new SQL.Database(bytes)}catch{throw error('The selected file is not a valid SQLite database')};try{const integrity=String(value(db,'PRAGMA integrity_check')?.integrity_check||'failed');if(integrity!=='ok')throw error(`SQLite integrity check failed: ${integrity}`);const required=type==='hardware_configurator'?hardwareTables:{manufacturing_log:manufacturingColumns};const tables=new Set(rows(db,"SELECT name FROM sqlite_master WHERE type='table'").map(x=>x.name));const issues:any[]=[];const rowCounts:Record<string,number>={};for(const[table,columns]of Object.entries(required)){if(!tables.has(table)){issues.push({level:'error',message:`Missing required table: ${table}`});continue}const actual=new Set(rows(db,`PRAGMA table_info("${table}")`).map(x=>x.name));for(const column of columns)if(!actual.has(column))issues.push({level:'error',message:`${table} is missing required column: ${column}`});rowCounts[table]=Number(value(db,`SELECT COUNT(*) n FROM "${table}"`).n)}if(issues.length)throw error(issues.map(x=>x.message).join('; '));return{valid:true,sourceType:type,integrityCheck:integrity,rowCounts,issues,details:{browserValidation:true}}}finally{db.close()}}
function sessionSource(type:Source,bytes:Uint8Array){if(type==='hardware_configurator'){hardware?.close();hardware=new SQL.Database(bytes)}else{manufacturing?.close();manufacturing=new SQL.Database(bytes)}}
async function persistSettings(_message:string){
 const p_value={displaySections:settings.displaySections,displayFields:settings.displayFields,referenceDisplays:settings.referenceDisplays,configuratorSettings:settings.configuratorSettings};
 const{data,error:failure}=await supabase.rpc('save_settings',{p_value,p_revision:revision});
 if(failure){lastRefresh=0;throw failure}revision=data;lastRefresh=Date.now();
}
// Authoritative audit events are created by the protected database functions.
function audit(_action:string,_entity?:string,_details?:any){}
function queryParams(url:string){return new URL(url,'https://local.invalid').searchParams}

export async function localApi<T>(url:string,options:RequestInit={}):Promise<T>{await ensure();const method=options.method||'GET',path=url.split('?')[0],body=options.body instanceof FormData?options.body:options.body?JSON.parse(String(options.body)):{};
 if(path.startsWith('/auth/'))return await cloudAuth(path,body) as T;
 await refreshCloud();
 if(path==='/display-config'){requireUser();return{sections:settings.displaySections.filter(x=>x.is_visible).sort(sortOrder),fields:settings.displayFields.filter(x=>x.is_visible).sort(sortOrder)} as T}
 if(path==='/valves/brands'){requireUser();if(!hardware)return [] as T;return rows(dbFor('hardware_configurator'),"SELECT DISTINCT valve_brand value FROM valves WHERE valve_brand IS NOT NULL AND TRIM(valve_brand)<>'' ORDER BY valve_brand COLLATE NOCASE").map(x=>x.value) as T}
 const params=queryParams(url);
 if(path==='/valves/sizes'){requireUser();return rows(dbFor('hardware_configurator'),"SELECT DISTINCT valve_size value FROM valves WHERE valve_brand=? AND TRIM(COALESCE(valve_size,''))<>'' ORDER BY CASE WHEN TRIM(valve_size) GLOB '[0-9]*' THEN CAST(valve_size AS REAL) END,valve_size COLLATE NOCASE",[params.get('brand')]).map(x=>x.value) as T}
 if(path==='/valves/classes'){requireUser();return rows(dbFor('hardware_configurator'),"SELECT DISTINCT valve_class value FROM valves WHERE valve_brand=? AND valve_size=? AND TRIM(COALESCE(valve_class,''))<>'' ORDER BY CASE WHEN TRIM(valve_class) GLOB '[0-9]*' THEN CAST(valve_class AS INTEGER) END,valve_class COLLATE NOCASE",[params.get('brand'),params.get('size')]).map(x=>x.value) as T}
 if(path==='/valves/models'){requireUser();return rows(dbFor('hardware_configurator'),"SELECT valve_id valveId,valve_model_number model FROM valves WHERE valve_brand=? AND valve_size=? AND valve_class=? AND TRIM(COALESCE(valve_model_number,''))<>'' ORDER BY valve_model_number COLLATE NOCASE",[params.get('brand'),params.get('size'),params.get('class')]) as T}
 if(path==='/configurator/actuators'){requireUser();if(!hardware)return [] as T;return rows(dbFor('hardware_configurator'),'SELECT actuator_id actuatorId,actuator_name name,square_size squareSize,actuator_bhc bhc FROM actuator_sets ORDER BY actuator_id') as T}
 if(path==='/configurator/settings'&&method==='GET'){requireUser(true);return settings.configuratorSettings as T}
 if(path==='/configurator/settings'&&method==='PUT'){requireUser(true);const bounded=(name:string,min:number,max:number)=>{const number=Number(body[name]);if(!Number.isFinite(number)||number<min||number>max)throw error(`${name} must be between ${min} and ${max}`);return number};settings.configuratorSettings={mountingTolerance:bounded('mountingTolerance',0,.25),packingGridTolerance:bounded('packingGridTolerance',0,.5),angleTolerance:bounded('angleTolerance',0,5),squareTolerance:bounded('squareTolerance',0,.1)};audit('configurator.tolerances.update','configurator_settings',settings.configuratorSettings);await persistSettings('Update configurator tolerances');return settings.configuratorSettings as T}
 if(path==='/configurator/results'){requireUser();return configuratorResults(Number(params.get('valveId')),Number(params.get('actuatorId'))) as T}
 if(path==='/manufacturing/explorer'){requireUser();const database=dbFor('manufacturing_log'),records=rows(database,'SELECT * FROM manufacturing_log ORDER BY datetime(timestamp) DESC,id DESC'),brands=rows(database,"SELECT DISTINCT valve_brand value FROM manufacturing_log WHERE TRIM(COALESCE(valve_brand,''))<>'' ORDER BY valve_brand COLLATE NOCASE").map(row=>String(row.value)),usedActuators=rows(database,"SELECT DISTINCT actuator_name value FROM manufacturing_log WHERE TRIM(COALESCE(actuator_name,''))<>''").map(row=>String(row.value)),databaseOrder=rows(dbFor('hardware_configurator'),"SELECT actuator_name value FROM actuator_sets WHERE TRIM(COALESCE(actuator_name,''))<>'' ORDER BY actuator_id").map(row=>String(row.value)),actuators=[...databaseOrder.filter(value=>usedActuators.includes(value)),...usedActuators.filter(value=>!databaseOrder.includes(value))];return{records,filters:{brands,actuators}} as T}
 const valveMatch=path.match(/^\/valves\/(\d+)$/);if(valveMatch){requireUser();return valveDetail(Number(valveMatch[1])) as T}
 const summaryMatch=path.match(/^\/valves\/(\d+)\/manufacturing-summary$/);if(summaryMatch){requireUser();const h=history(Number(summaryMatch[1])),last=h[0],lastBracket=h.find(row=>String(row.bracket_code??'').trim())?.bracket_code??null;return{lastManufacturedTimestamp:last?.timestamp??null,lastJobNumber:last?.job_number??null,lastQuantity:last?.quantity??null,lastConfigurationName:last?.configuration_name??null,lastFusionDocument:last?.fusion_document_name??null,lastActuator:last?.actuator_name??null,lastBracket,totalManufacturingRuns:h.length} as T}
 const historyMatch=path.match(/^\/valves\/(\d+)\/manufacturing-history$/);if(historyMatch){requireUser();return history(Number(historyMatch[1])) as T}
 if(path==='/reference-display'){requireUser();const type=queryParams(url).get('type') as 'actuators'|'brackets';if(!['actuators','brackets'].includes(type))throw error('Unknown reference display');return settings.referenceDisplays[type].filter(x=>x.is_visible).sort(sortOrder) as T}
 if(path==='/admin/actuator-sets'){requireUser();return rows(dbFor('hardware_configurator'),'SELECT * FROM actuator_sets ORDER BY actuator_id') as T}
 if(path==='/admin/bracket-patterns'){requireUser();return rows(dbFor('hardware_configurator'),'SELECT * FROM bracket_patterns ORDER BY bracket_id') as T}
 requireUser(true);
 if(path==='/admin/database-sources')return settings.databaseSources as T;
 if(path==='/admin/database-sources/cross-validation')return crossValidation() as T;
 const uploadMatch=path.match(/^\/admin\/database-sources\/(hardware-configurator|manufacturing-log)\/upload$/);if(uploadMatch){const file=(body as FormData).get('database') as File;if(!file)throw error('Choose a database file');const type:Source=uploadMatch[1]==='hardware-configurator'?'hardware_configurator':'manufacturing_log';return await saveDatabase(type,new Uint8Array(await file.arrayBuffer()),file.name) as T}
 if(path==='/admin/display-sections')return settings.displaySections.sort(sortOrder) as T;
 if(path==='/admin/display-fields')return settings.displayFields.sort(sortOrder) as T;
 if(path==='/admin/reference-display')return settings.referenceDisplays as T;
 if(path==='/admin/display-config'&&method==='PUT'){
  const incomingSections=Array.isArray(body.sections)?body.sections:[],incomingFields=Array.isArray(body.fields)?body.fields:[],incomingReferences=body.referenceDisplays;
  if(incomingSections.length!==settings.displaySections.length||incomingFields.length!==settings.displayFields.length)throw error('Display configuration is incomplete; reload the page and try again');
  const sectionIds=new Set(settings.displaySections.map(x=>x.id)),fieldIds=new Set(settings.displayFields.map(x=>x.id)),sectionKeys=new Set(incomingSections.map((x:any)=>x.section_key));
  if(incomingSections.some((x:any)=>!sectionIds.has(x.id))||incomingFields.some((x:any)=>!fieldIds.has(x.id)||!sectionKeys.has(x.section_key)))throw error('Display configuration contains unknown sections or fields');
  settings.displaySections=incomingSections.map((x:any,index:number)=>({...settings.displaySections.find(current=>current.id===x.id),label:String(x.label).slice(0,100),sort_order:(index+1)*10,is_visible:x.is_visible?1:0}));
  settings.displayFields=incomingFields.map((x:any)=>normalizeDisplayField(settings.displayFields.find(current=>current.id===x.id),x));
  for(const type of ['actuators','brackets'] as const){
   const incoming=Array.isArray(incomingReferences?.[type])?incomingReferences[type]:[];
   const existing=settings.referenceDisplays[type],known=new Set(existing.map(x=>x.field_key));
   if(incoming.length!==existing.length||incoming.some((x:any)=>!known.has(x.field_key)))throw error(`${type} display configuration is incomplete; reload the page and try again`);
   settings.referenceDisplays[type]=incoming.map((x:any,index:number)=>normalizeDisplayField(existing.find(current=>current.field_key===x.field_key),{...x,sort_order:(index+1)*10}));
  }
  audit('display.configuration.update','display_configuration',{sections:settings.displaySections.length,fields:settings.displayFields.length});await persistSettings('Update complete display configuration');return{ok:true} as T
 }
 const sectionMatch=path.match(/^\/admin\/display-sections\/(\d+)$/);if(sectionMatch&&method==='PUT'){Object.assign(settings.displaySections.find(x=>x.id===Number(sectionMatch[1])),body);audit('display.section.update','display_section',body);await persistSettings('Update display section');return{ok:true} as T}
 const fieldMatch=path.match(/^\/admin\/display-fields\/(\d+)$/);if(fieldMatch&&method==='PUT'){Object.assign(settings.displayFields.find(x=>x.id===Number(fieldMatch[1])),body);audit('display.field.update','display_field',body);await persistSettings('Update display field');return{ok:true} as T}
 if(path.startsWith('/admin/users'))return await cloudUsers(path,method,body) as T;
 if(path==='/admin/audit-logs'){const{data,error:failure}=await supabase.from('audit_events').select('*').order('created_at',{ascending:false}).limit(200);if(failure)throw failure;return data as T}
 if(path==='/admin/actuator-sets')return rows(dbFor('hardware_configurator'),'SELECT * FROM actuator_sets ORDER BY actuator_id') as T;
 if(path==='/admin/bracket-patterns')return rows(dbFor('hardware_configurator'),'SELECT * FROM bracket_patterns ORDER BY bracket_id') as T;
 if(path==='/admin/universal-adapters')return rows(dbFor('hardware_configurator'),'SELECT * FROM universal_adapters ORDER BY id') as T;
 if(path==='/admin/dashboard'){const [users,events]=await Promise.all([cloudUsers('/admin/users','GET',{}),supabase.from('audit_events').select('*').order('created_at',{ascending:false}).limit(8)]);if(events.error)throw events.error;settings.users=users;settings.auditLogs=events.data;return dashboard() as T;}
 throw error(`Unknown API route: ${method} ${path}`,404)
}
function sortOrder(a:any,b:any){return a.sort_order-b.sort_order||a.id-b.id}
function normalizeDisplayField(current:any,incoming:any){return{...current,label:String(incoming.label).slice(0,100),...(incoming.section_key?{section_key:incoming.section_key}:{}),sort_order:Number(incoming.sort_order),is_visible:incoming.is_visible?1:0,is_highlighted:incoming.is_highlighted?1:0,unit:incoming.unit?String(incoming.unit).slice(0,30):null,decimal_places:incoming.decimal_places===null?null:Math.max(0,Math.min(10,Number(incoming.decimal_places))),help_text:incoming.help_text?String(incoming.help_text).slice(0,500):null}}
function valveDetail(id:number){const database=dbFor('hardware_configurator'),hasBracketTrim=rows(database,"PRAGMA table_info('valve_flat_stems')").some(column=>column.name==='bracket_trim');return value(database,`SELECT v.valve_id,v.valve_brand,v.valve_size,v.valve_class,v.valve_model_number,v.valve_port,v.stem_type,v.description,k.stem_diameter keyed_stem_diameter,k.stem_height keyed_stem_height,k.key_qty,k.key_width,k.key_cross,k.valve_bhc keyed_valve_bhc,k.valve_hole_dia keyed_valve_hole_dia,k.valve_hole_qty keyed_valve_hole_qty,k.valve_start_angle keyed_valve_start_angle,f.stem_height flat_stem_height,f.flat_width,f.flat_depth,${hasBracketTrim?'f.bracket_trim':'NULL bracket_trim'},f.valve_bhc flat_valve_bhc,f.valve_hole_dia flat_valve_hole_dia,f.valve_hole_qty flat_valve_hole_qty,f.valve_start_angle flat_valve_start_angle,f.packing_flange,f.packing_flange_width,f.packing_flange_length,f.packing_flange_angle,f.dia_reduction,f.dia_reduction_value,f.stem_thread,f.stem_thread_dia,f.stem_thread_depth,f.u_bolt,f.u_bolt_valve_width,f.u_bolt_valve_length,f.valve_pattern_type,f.valve_grid_x_distance,f.valve_grid_y_distance,CASE WHEN v.stem_type='KEYED' AND k.valve_id IS NULL THEN 1 WHEN v.stem_type='FLATS' AND f.valve_id IS NULL THEN 1 ELSE 0 END stem_detail_missing FROM valves v LEFT JOIN valve_keyed_stems k ON k.valve_id=v.valve_id AND v.stem_type='KEYED' LEFT JOIN valve_flat_stems f ON f.valve_id=v.valve_id AND v.stem_type='FLATS' WHERE v.valve_id=?`,[id])||null}
function history(id:number){if(!manufacturing)return [];return rows(dbFor('manufacturing_log'),"SELECT * FROM manufacturing_log WHERE valve_id GLOB '[0-9]*' AND valve_id NOT GLOB '*[^0-9]*' AND CAST(valve_id AS INTEGER)=? ORDER BY datetime(timestamp) DESC,id DESC",[id])}
const near=(a:any,b:any,tolerance=.03)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&Math.abs(Number(a)-Number(b))<=tolerance;
const sameAngle=(a:any,b:any,tolerance:number)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&(near(a,b,tolerance)||near((Number(a)+90)%90,(Number(b)+90)%90,tolerance));
function roundValue(value:any){return value===null||value===undefined?null:Number(Number(value).toFixed(4))}
function mountPatternMatches(item:any,pattern:any,prefix:string,tolerance:ConfiguratorSettings){return near(item.bhc,pattern[`${prefix}_bhc`],tolerance.mountingTolerance)&&near(item.holeDia,pattern[`${prefix}_hole_dia`],tolerance.mountingTolerance)&&Number(item.holeQty)===Number(pattern[`${prefix}_hole_qty`])&&sameAngle(item.angle,pattern[`${prefix}_start_angle`],tolerance.angleTolerance)}
function isoMountMatch(mount:any,isoRows:any[],tolerance:ConfiguratorSettings){return isoRows.filter(row=>near(mount.bhc,row.bhc,tolerance.mountingTolerance)&&near(mount.holeDia,row.hole_dia,tolerance.mountingTolerance)&&Number(mount.holeQty)===Number(row.hole_qty)&&sameAngle(mount.angle,row.hole_angle,tolerance.angleTolerance)).sort((a,b)=>(Math.abs(Number(mount.bhc)-Number(a.bhc))+Math.abs(Number(mount.holeDia)-Number(a.hole_dia)))-(Math.abs(Number(mount.bhc)-Number(b.bhc))+Math.abs(Number(mount.holeDia)-Number(b.hole_dia))))[0]||null}
function packingMatches(valve:any,bracket:any,tolerance:ConfiguratorSettings){const required=/^yes$/i.test(String(valve.packing_flange||'')),provided=/^yes$/i.test(String(bracket.packing_flange||''));if(!required)return!provided;if(!provided)return false;const clearance=(requiredSize:any,bracketSize:any)=>requiredSize!==null&&requiredSize!==undefined&&bracketSize!==null&&bracketSize!==undefined&&Number.isFinite(Number(requiredSize))&&Number.isFinite(Number(bracketSize))&&Number(bracketSize)>=Number(requiredSize),direct=clearance(valve.packing_flange_width,bracket.packing_flange_width)&&clearance(valve.packing_flange_length,bracket.packing_flange_length),rotated=clearance(valve.packing_flange_width,bracket.packing_flange_length)&&clearance(valve.packing_flange_length,bracket.packing_flange_width);return(direct||rotated)&&sameAngle(valve.packing_flange_angle,bracket.packing_flange_angle,tolerance.angleTolerance)}
function configuratorResults(valveId:number,actuatorId:number){
 const hardwareDb=dbFor('hardware_configurator'),tolerance=settings.configuratorSettings??defaultConfiguratorSettings,valve=valveDetail(valveId),actuator=value(hardwareDb,'SELECT * FROM actuator_sets WHERE actuator_id=?',[actuatorId]);if(!valve||!actuator)throw error('Select a valid valve and actuator');
 const actuatorMount={bhc:actuator.actuator_bhc,holeDia:actuator.actuator_hole_dia,holeQty:actuator.actuator_hole_qty,angle:actuator.actuator_start_angle};
 const valveMount={bhc:valve.stem_type==='KEYED'?valve.keyed_valve_bhc:valve.flat_valve_bhc,holeDia:valve.stem_type==='KEYED'?valve.keyed_valve_hole_dia:valve.flat_valve_hole_dia,holeQty:valve.stem_type==='KEYED'?valve.keyed_valve_hole_qty:valve.flat_valve_hole_qty,angle:valve.stem_type==='KEYED'?valve.keyed_valve_start_angle:valve.flat_valve_start_angle};
 const isDActuator=/D$/i.test(String(actuator.actuator_name).trim()),isFlatStem=String(valve.stem_type).trim().toUpperCase()==='FLATS',isoRows=rows(hardwareDb,"SELECT * FROM iso_data ORDER BY CAST(REPLACE(iso_f,'F','') AS INTEGER)"),iso={actuator:isDActuator?null:isoMountMatch(actuatorMount,isoRows,tolerance),valve:isoMountMatch(valveMount,isoRows,tolerance)};
 let prior:any[]=[];try{prior=history(valveId).filter(row=>String(row.actuator_name||'').trim().toLowerCase()===String(actuator.actuator_name).trim().toLowerCase())}catch{}
 const historicalCodes=new Set(prior.map(row=>String(row.bracket_code||'').trim().toLowerCase()).filter(code=>code&&code!=='0'));
 const actuatorName=String(actuator.actuator_name).trim().toLowerCase(),adapterCandidates=rows(hardwareDb,'SELECT * FROM universal_adapters ORDER BY id').filter(adapter=>String(adapter.actuator_name||'').split(/[^a-z0-9.-]+/i).some(name=>name.toLowerCase()===actuatorName)&&near(adapter.square_size,actuator.square_size,tolerance.squareTolerance));
 const brackets=rows(hardwareDb,'SELECT * FROM bracket_patterns ORDER BY bracket_code COLLATE NOCASE').map(bracket=>{
  const bracketCode=String(bracket.bracket_code||'').trim().toLowerCase(),isUniversalBracket=bracketCode.includes('uh')||bracketCode.includes('universal');if(isFlatStem&&isUniversalBracket)return null;
  if(isDActuator){const corresponding=String(bracket.bracket_code||'').trim().toLowerCase()===actuatorName&&String(bracket.part_number||'').trim()!=='';return corresponding?{...bracket,geometryMatch:true,previouslyUsed:historicalCodes.has(String(bracket.bracket_code||'').trim().toLowerCase()),actuatorPattern:'Actuator-specific bracket',valvePattern:null}:null}
  const actuatorPattern=[1,2,3].find(index=>mountPatternMatches(actuatorMount,bracket,`actuator_${index}`,tolerance));
  const bhcValvePattern=[1,2,3].find(index=>mountPatternMatches(valveMount,bracket,index===1?'valve':`valve_${index}`,tolerance));
  const geometryMatch=!!actuatorPattern&&!!bhcValvePattern&&packingMatches(valve,bracket,tolerance),previouslyUsed=historicalCodes.has(String(bracket.bracket_code||'').trim().toLowerCase());
  if(!geometryMatch)return null;return{...bracket,geometryMatch,previouslyUsed,actuatorPattern:`Actuator pattern ${actuatorPattern}`,valvePattern:`Valve pattern ${bhcValvePattern}`};
 }).filter(Boolean);
 const universalBracketWorks=!isFlatStem&&brackets.some((bracket:any)=>{const code=String(bracket.bracket_code||'').toLowerCase();return bracket.geometryMatch&&(code.includes('uh')||code.includes('universal'))}),adapters=universalBracketWorks?adapterCandidates.map(adapter=>({...adapter,reason:`Recorded for actuator ${actuator.actuator_name} with ${roundValue(adapter.square_size)} square`})) :[];
 return{valve:{id:valve.valve_id,brand:valve.valve_brand,size:valve.valve_size,class:valve.valve_class,model:valve.valve_model_number,stemType:valve.stem_type,mount:{bhc:roundValue(valveMount.bhc),holeDia:roundValue(valveMount.holeDia),holeQty:valveMount.holeQty,angle:roundValue(valveMount.angle),patternType:valve.valve_pattern_type||'BHC'}},actuator:{id:actuator.actuator_id,name:actuator.actuator_name,isD:isDActuator,boltSize:actuator.bolt_size,squareSize:roundValue(actuator.square_size),mount:{bhc:roundValue(actuatorMount.bhc),holeDia:roundValue(actuatorMount.holeDia),holeQty:actuatorMount.holeQty,angle:roundValue(actuatorMount.angle)}},iso,brackets,adapters,universalBracketWorks,priorUses:prior.length,notes:['A bracket is shown only when the actuator matches an actuator mounting pattern and the valve matches a valve mounting pattern.','Dimensional matches use administrator-controlled tolerances.','Previously used is an informational badge and never overrides the mounting-pattern requirements.','Universal adapters are shown only when a compatible universal bracket is also available; verify final valve-stem machining before release.']};
}
async function saveDatabase(type:Source,bytes:Uint8Array,name:string){
 if(bytes.byteLength>50*1024*1024)throw error('Uploads are limited to 50 MB');
 const report=validate(type,bytes);await uploadDatabase(type,bytes,name,report);lastRefresh=0;await refreshCloud();return report;
}
function crossValidation(){if(!hardware||!manufacturing)return{status:'pending',message:'Both databases must be active'};const valves=rows(hardware,'SELECT valve_id,valve_brand,valve_size,valve_class,valve_model_number FROM valves'),logs=rows(manufacturing,'SELECT valve_id,valve_brand,valve_size,valve_class,valve_model FROM manufacturing_log'),map=new Map(valves.map(v=>[Number(v.valve_id),v]));let matched=0,mismatches=0;const used=new Set<number>();for(const log of logs){const id=/^\d+$/.test(String(log.valve_id))?Number(log.valve_id):NaN,v=map.get(id);if(v){matched++;used.add(id);if(log.valve_brand!==v.valve_brand||log.valve_size!==v.valve_size||log.valve_class!==v.valve_class||log.valve_model!==v.valve_model_number)mismatches++}}return{status:'complete',configuratorValves:valves.length,manufacturingRows:logs.length,matchedManufacturingRows:matched,unmatchedManufacturingRows:logs.length-matched,valvesWithHistory:used.size,valvesNeverManufactured:valves.length-used.size,historicalIdentityMismatches:mismatches}}
function dashboard(){const cv:any=crossValidation(),counts:any={activeUsers:settings.users.filter(x=>x.is_active).length,recentAudit:settings.auditLogs.slice(0,8),latestUpload:[...settings.databaseSources].sort((a,b)=>String(b.uploaded_at).localeCompare(String(a.uploaded_at)))[0]||null};if(hardware)Object.assign(counts,{valveCount:Number(value(hardware,'SELECT COUNT(*) n FROM valves').n),keyedStemCount:Number(value(hardware,'SELECT COUNT(*) n FROM valve_keyed_stems').n),flatStemCount:Number(value(hardware,'SELECT COUNT(*) n FROM valve_flat_stems').n),actuatorSetCount:Number(value(hardware,'SELECT COUNT(*) n FROM actuator_sets').n),bracketPatternCount:Number(value(hardware,'SELECT COUNT(*) n FROM bracket_patterns').n),universalAdapterCount:Number(value(hardware,'SELECT COUNT(*) n FROM universal_adapters').n)});return{...counts,...cv}}
