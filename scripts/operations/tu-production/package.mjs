import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {createZip,listZipEntries} from '../zip-archive.mjs';
import {packageTuAuth,publicCa} from '../../package-tu-auth.mjs';
import {readUpgradeFiles} from '../present-schema-upgrade.mjs';
import {ROOT,A,hash,cleanSource,fixed} from './common.mjs';
export const OWNER_FILES=['scripts/operations/present-schema-upgrade.mjs','scripts/operations/present-schema-baseline.mjs',
 'scripts/operations/tu-preflight/catalog.js','scripts/operations/baselines/coed-present-20261104.json','scripts/operations/tu-login-role.sql',
 'src/db/upgrades/018_observed_tu_delivery.sql','src/db/operations/018-observed-runtime-grants.sql'];
export async function packageProduction(ca){
 publicCa(ca);readUpgradeFiles();
 const source=cleanSource(),parent=join(ROOT,'tmp/tu-production');mkdirSync(parent,{recursive:true});
 const dir=mkdtempSync(join(parent,'production-')),stage=join(dir,'owner');mkdirSync(stage);
 const entry='scripts/operations/tu-owner/handler.mjs',file=join(stage,entry);mkdirSync(dirname(file),{recursive:true});
 const result=await build({absWorkingDir:ROOT,entryPoints:[entry],outfile:file,bundle:true,platform:'node',target:'node22',
  format:'esm',external:['pg-native','../present-schema-upgrade.mjs','../present-schema-baseline.mjs'],metafile:true,
  banner:{js:"import {createRequire as coedCreateRequire} from 'node:module'; const require=coedCreateRequire(import.meta.url);"},
  sourcemap:false,legalComments:'none',logLevel:'warning'});
 const inputs=Object.keys(result.metafile.inputs).filter(x=>!x.startsWith('node_modules/')).sort();
 fixed(JSON.stringify(inputs)===JSON.stringify([entry]),'OWNER_DEPENDENCY_BOUNDARY');
 for(const name of OWNER_FILES){const target=join(stage,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(ROOT,name),target);}
 writeFileSync(join(stage,'global-bundle.pem'),ca,{flag:'wx'});
 const ownerZip=join(dir,'owner.zip');createZip(stage,ownerZip,[entry,'global-bundle.pem',...OWNER_FILES]);
 const apiStage=join(dir,'api');mkdirSync(apiStage);
 await build({absWorkingDir:ROOT,entryPoints:['src/lambda.js'],outdir:apiStage,outbase:'.',bundle:true,
  platform:'node',target:'node22',format:'cjs',external:['pg-native'],sourcemap:false,legalComments:'none',logLevel:'warning'});
 writeFileSync(join(apiStage,'global-bundle.pem'),ca,{flag:'wx'});
 const apiZip=join(dir,'api.zip');createZip(apiStage,apiZip,['src/lambda.js','global-bundle.pem']);
 const maintenanceStage=join(dir,'maintenance');mkdirSync(join(maintenanceStage,'src'),{recursive:true});
 writeFileSync(join(maintenanceStage,'src/lambda.js'),"exports.handler=async()=>({statusCode:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':'120'},body:JSON.stringify({error:{code:'COED_MAINTENANCE',message:'ระบบกำลังปรับปรุงชั่วคราว กรุณาลองใหม่ภายหลัง'}})});\n",{flag:'wx'});
 const maintenanceZip=join(dir,'maintenance.zip');createZip(maintenanceStage,maintenanceZip,['src/lambda.js']);
 const tu=await packageTuAuth({output:dir,caBytes:ca});
 const artifact=path=>({file:path,sha256:hash(readFileSync(path)),entries:listZipEntries(path)});
 const state={format:'coed-tu-production-v1',account:A,runId:randomBytes(16).toString('hex'),source,
  createdAt:new Date().toISOString(),status:'LOCAL_ONLY',owned:{},ownerInvocations:0,
  artifacts:{owner:artifact(ownerZip),api:artifact(apiZip),maintenance:artifact(maintenanceZip),
   broker:artifact(join(dir,'coed-tu-broker.zip')),issuer:artifact(join(dir,'coed-tu-session-issuer.zip'))},
  roleSqlSha256:hash(readFileSync(join(ROOT,'scripts/operations/tu-login-role.sql'))),tuArtifacts:tu};
 fixed(JSON.stringify(cleanSource())===JSON.stringify(source),'SOURCE_CHANGED_WHILE_PACKAGING');
 const path=join(dir,'state.json');writeFileSync(path,JSON.stringify(state,null,2)+'\n',{flag:'wx'});
 return {path,state};
}
