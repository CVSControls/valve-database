import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import initSqlJs from 'sql.js';
const root=process.cwd(),SQL=await initSqlJs(),source=await readFile('client/src/local-backend.ts','utf8');
const schema=runInNewContext('('+source.match(/const hardwareTables:[^=]+=(\{[\s\S]*?\n\});/)[1]+')');
const columns=runInNewContext(source.match(/const manufacturingColumns=(\[[^\n]+\]);/)[1]);
const hardware=new SQL.Database(),mfg=new SQL.Database();
for(const[table,fields]of Object.entries(schema))hardware.run('CREATE TABLE "'+table+'" ('+fields.map(c=>'"'+c+'" TEXT').join(',')+')');
hardware.run('ALTER TABLE valve_flat_stems ADD COLUMN bracket_trim TEXT');
mfg.run('CREATE TABLE manufacturing_log ('+columns.map(c=>'"'+c+'" TEXT').join(',')+')');
const insert=(db,table,row)=>db.run('INSERT INTO "'+table+'" ('+Object.keys(row).map(c=>'"'+c+'"').join(',')+') VALUES ('+Object.keys(row).map(()=>'?').join(',')+')',Object.values(row));
for(const[id,stem]of [[1,'KEYED'],[2,'FLATS']]){
 insert(hardware,'valves',{valve_id:id,valve_brand:'Test',valve_size:'3',valve_class:'300',valve_model_number:'Model '+id,stem_type:stem});
 insert(hardware,stem==='KEYED'?'valve_keyed_stems':'valve_flat_stems',{valve_id:id,valve_bhc:2,valve_hole_dia:.25,valve_hole_qty:4,valve_start_angle:45,...(stem==='FLATS'?{bracket_trim:'Trim .125'}:{})});
}
for(const[id,name]of [[1,'240'],[2,'240D']])insert(hardware,'actuator_sets',{actuator_id:id,actuator_name:name,actuator_bhc:2,actuator_hole_dia:.25,actuator_hole_qty:4,actuator_start_angle:45,square_size:.5,bolt_size:'M8'});
insert(hardware,'bracket_patterns',{bracket_id:1,bracket_code:'Universal UH',part_number:'P-1',actuator_1_bhc:2,actuator_1_hole_dia:.25,actuator_1_hole_qty:4,actuator_1_start_angle:45,valve_bhc:2,valve_hole_dia:.25,valve_hole_qty:4,valve_start_angle:45});
insert(hardware,'bracket_patterns',{bracket_id:2,bracket_code:'240D',part_number:'P-D'});
insert(hardware,'universal_adapters',{id:1,universal_adapter_name:'Adapter',actuator_name:'240',square_size:.5,part_number:'A-1'});
insert(hardware,'iso_data',{id:1,iso_f:'F05',bhc:2,hole_dia:.25,hole_qty:4,hole_angle:45,metric_bolt:'M6',imperial_bolt:'1/4-20'});
insert(mfg,'manufacturing_log',{id:1,valve_id:'1',timestamp:'2026-09-01',job_number:'J-1',valve_model:'Historical name',quantity:3,bracket_code:'Prior bracket'});
const state={profile:{id:'test-admin',email:'admin@example.test',role:'admin',is_active:true},session:true,settings:{id:1,value:{},revision:0},sources:[],files:new Map(),callbacks:[],downloads:0,activations:0,failSave:false,failActivate:false};
function seed(type,db){const bytes=db.export(),sha256=createHash('sha256').update(bytes).digest('hex'),storage_path=type+'/'+sha256+'.db';state.files.set(storage_path,bytes);state.sources.push({source_type:type,storage_path,sha256,size_bytes:bytes.length,validation_report:{valid:true}})}
seed('hardware_configurator',hardware);seed('manufacturing_log',mfg);
globalThis.__testSupabase={
 auth:{
  getSession:async()=>({data:{session:state.session?{user:{id:state.profile.id}}:null}}),
  signInWithPassword:async({password})=>{if(password!=='valid-password')return{error:new Error('Invalid login')};state.session=true;return{}},
  signOut:async()=>{state.session=false;state.callbacks.forEach(cb=>cb('SIGNED_OUT'));return{}},
  onAuthStateChange:cb=>{state.callbacks.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
 },
 from(table){return{select(){return this},eq(){return this},order(){return this},limit(){return this},
  single:async()=>({data:table==='profiles'?state.profile:state.settings}),
  then(resolve,reject){return Promise.resolve({data:table==='database_sources'?state.sources:table==='profiles'?[state.profile]:[]}).then(resolve,reject)}}},
 storage:{from:()=>({
  download:async key=>{state.downloads++;return state.files.has(key)?{data:new Blob([state.files.get(key)])}:{error:new Error('Missing private file')}},
  upload:async(key,blob)=>{if(state.files.has(key))return{error:new Error('already exists')};state.files.set(key,new Uint8Array(await blob.arrayBuffer()));return{}},
  remove:async keys=>{for(const key of keys){assert.ok(!state.sources.some(s=>s.storage_path===key));state.files.delete(key)}return{}},
 })},
 async rpc(name,args){
  if(name==='retired_database_paths')return{data:[...state.files.keys()].filter(key=>key.startsWith(args.p_type+'/')&&!state.sources.some(s=>s.storage_path===key)).map(storage_path=>({storage_path}))};
  if(name==='save_settings'){
   if(state.failSave||args.p_revision!==state.settings.revision)return{error:new Error('Settings changed. Reload before saving.')};
   state.settings.value=args.p_value;return{data:++state.settings.revision};
  }
  if(state.failActivate)return{error:new Error('Activation failed')};
  state.activations++;state.sources=state.sources.filter(s=>s.source_type!==args.p_type);
  state.sources.push({source_type:args.p_type,storage_path:args.p_path,sha256:args.p_sha,size_bytes:args.p_size,validation_report:args.p_report});return{};
 },
 functions:{invoke:async()=>({error:new Error('Function not configured')})},
};
globalThis.window=new EventTarget();
const directory=await mkdtemp(path.join(root,'.test-build-'));
await build({entryPoints:['client/src/local-backend.ts'],outfile:path.join(directory,'backend.mjs'),bundle:true,platform:'node',format:'esm',external:['sql.js'],plugins:[{
 name:'private-api-fixture',setup(api){
  api.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'supabase',namespace:'mock'}));
  api.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=()=>globalThis.__testSupabase;',loader:'js'}));
  api.onResolve({filter:/sql-wasm.wasm\?url$/},()=>({path:'wasm',namespace:'wasm'}));
  api.onLoad({filter:/.*/,namespace:'wasm'},()=>({contents:'export default '+JSON.stringify(path.join(root,'node_modules/sql.js/dist/sql-wasm.wasm'))+';',loader:'js'}));
 },
}]});
const{localApi}=await import(pathToFileURL(path.join(directory,'backend.mjs')));
const upload=bytes=>{const form=new FormData();form.set('database',new File([bytes],'selected.db'));return localApi('/admin/database-sources/hardware-configurator/upload',{method:'POST',body:form})};
after(async()=>{hardware.close();mfg.close();await rm(directory,{recursive:true,force:true});delete globalThis.__testSupabase});
test('private databases load only after a valid login',async()=>{
 state.session=false;assert.equal((await localApi('/auth/session')).user,null);
 await assert.rejects(localApi('/valves/brands'),/Authentication required/);assert.equal(state.downloads,0);
 await assert.rejects(localApi('/auth/login',{method:'POST',body:JSON.stringify({username:'admin@example.test',password:'wrong'})}),/Invalid login/);
 await localApi('/auth/login',{method:'POST',body:JSON.stringify({username:'admin@example.test',password:'valid-password'})});
 assert.deepEqual(await localApi('/valves/brands'),['Test']);assert.equal(state.downloads,2);
});
test('valve identity, bracket trim, and manufacturing history are preserved',async()=>{
 assert.equal((await localApi('/valves/2')).bracket_trim,'Trim .125');
 assert.equal((await localApi('/valves/1/manufacturing-history'))[0].valve_model,'Historical name');
 assert.equal((await localApi('/valves/1/manufacturing-summary')).lastBracket,'Prior bracket');
});
test('flat stem exclusions, keyed matching, and D-series brackets/bolts are preserved',async()=>{
 assert.ok(JSON.stringify(await localApi('/configurator/results?valveId=1&actuatorId=1')).includes('Universal UH'));
 const flat=JSON.stringify(await localApi('/configurator/results?valveId=2&actuatorId=1'));
 assert.ok(!flat.includes('Universal UH'));assert.ok(!flat.includes('"universal_adapter_name"'));
 const d=JSON.stringify(await localApi('/configurator/results?valveId=1&actuatorId=2'));
 assert.ok(d.includes('P-D'));assert.ok(d.includes('M8'));
});
test('viewer/disabled accounts cannot perform admin operations',async()=>{
 state.profile.role='user';await assert.rejects(localApi('/admin/users'),/Administrator access required/);
 await assert.rejects(upload(hardware.export()),/Administrator access required/);
 state.profile.is_active=false;await assert.rejects(localApi('/valves/brands'),/disabled/);
 state.profile.is_active=true;state.profile.role='admin';
});
test('settings use optimistic revisions and contain no credentials',async()=>{
 const value={mountingTolerance:.025,packingGridTolerance:.08,angleTolerance:.51,squareTolerance:.01};
 await localApi('/configurator/settings',{method:'PUT',body:JSON.stringify(value)});
 assert.equal(state.settings.revision,2);assert.equal(state.settings.value.configuratorSettings.mountingTolerance,.025);
 assert.ok(!Object.hasOwn(state.settings.value,'users'));
 state.failSave=true;await assert.rejects(localApi('/configurator/settings',{method:'PUT',body:JSON.stringify({...value,mountingTolerance:.02})}),/Settings changed/);
 state.failSave=false;assert.equal((await localApi('/configurator/settings')).mountingTolerance,.025);
});
test('failed validation/activation retains active data; successful upload/retry works',async()=>{
 await assert.rejects(upload(new TextEncoder().encode('not sqlite')),/valid SQLite|file is not a database/);
 assert.equal(state.activations,0);
 insert(hardware,'valves',{valve_id:3,valve_brand:'New brand',valve_size:'4',stem_type:'KEYED'});
 state.failActivate=true;await assert.rejects(upload(hardware.export()),/Activation failed/);
 assert.deepEqual(await localApi('/valves/brands'),['Test']);state.failActivate=false;
 await upload(hardware.export());assert.deepEqual(await localApi('/valves/brands'),['New brand','Test']);
 await upload(hardware.export());assert.equal(state.activations,2);
});
test('logout clears private databases; checksum mismatches fail closed',async()=>{
 state.files.set(state.sources.find(s=>s.source_type==='hardware_configurator').storage_path,new Uint8Array([1,2,3]));
 await localApi('/auth/logout',{method:'POST'});await assert.rejects(localApi('/valves/brands'),/Authentication required/);
 await localApi('/auth/login',{method:'POST',body:JSON.stringify({username:'admin@example.test',password:'valid-password'})});
 await assert.rejects(localApi('/valves/brands'),/checksum/);await localApi('/auth/logout',{method:'POST'});
});
