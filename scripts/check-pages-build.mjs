import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
async function check(directory){
 for(const item of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,item.name);
  if(item.isDirectory()){await check(file);continue}
  if(/\.(db|sqlite|sqlite3)$/i.test(item.name)||/^(settings|app-config)\.json$/i.test(item.name))
   throw new Error('Private data/configuration in Pages artifact: '+file);
  const bytes=await readFile(file);
  if(bytes.subarray(0,16).toString()==='SQLite format 3\0')throw new Error('SQLite content in Pages artifact: '+file);
  if(/\.(js|json|html|txt)$/i.test(item.name)&&(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/.test(bytes.toString())||/sb_secret_[A-Za-z0-9_-]{10,}/.test(bytes.toString())))
   throw new Error('Password hash or secret key in Pages artifact: '+file);
 }
}
await check('client/dist');console.log('PASS: Pages artifact has no SQLite files, old settings, login hashes, or secret keys.');
