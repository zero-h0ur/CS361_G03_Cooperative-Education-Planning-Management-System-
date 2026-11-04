import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,X509Certificate} from 'node:crypto';
import {build} from 'esbuild';
import {createZip,listZipEntries} from './operations/zip-archive.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function publicCa(bytes){
  const text=bytes.toString('utf8'),certs=text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if(!certs?.length || text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,'').trim())throw Error('Only public CA certificates are allowed.');
  for(const cert of certs)if(!new X509Certificate(cert).ca)throw Error('Only public CA certificates are allowed.');
  return bytes;
}
export async function packageTuAuth({output,caBytes}){
  publicCa(caBytes);await mkdir(output,{recursive:true});
  const staging=await mkdtemp(join(output,'tu-staging-')),artifacts={};
  for(const item of [
    {name:'coed-tu-broker.zip',entry:'src/tu-auth-broker.js',targetFunction:'coed-tu-auth',runtime:'nodejs24.x'},
    {name:'coed-tu-session-issuer.zip',entry:'src/tu-session-issuer.js',targetFunction:'coed-tu-session-issuer',runtime:'nodejs22.x'}
  ]){
    const dir=join(staging,item.targetFunction);await mkdir(dir);
    const result=await build({absWorkingDir:root,entryPoints:[item.entry],outfile:join(dir,item.entry),bundle:true,
      platform:'node',target:'node22',format:'cjs',external:['pg-native'],sourcemap:false,legalComments:'none',metafile:true,logLevel:'warning'});
    const inputs=Object.keys(result.metafile.inputs).filter(name=>name.startsWith('src/')).sort();
    const forbidden=item.targetFunction==='coed-tu-auth'
      ? /src\/(?:db\/|auth\/(?:tu-keys|tu-signing-secret|tu-session-service|identity-resolver|tu-auth-service|tu-identity-relink)\.js)/
      : /src\/(?:auth\/(?:tu-provider-verifier|tu-broker-service|tu-auth-service|tu-identity-relink)\.js|api\/(?:routes|services)\/)/;
    if(inputs.some(path=>forbidden.test(path)))throw Error('TU artifact crosses its reviewed dependency boundary.');
    const source=await readFile(join(dir,item.entry));
    if(/-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\r\n]/.test(source.toString()))throw Error('Embedded signing material rejected.');
    const entries=[item.entry];
    if(item.targetFunction==='coed-tu-session-issuer'){await writeFile(join(dir,'global-bundle.pem'),caBytes,{flag:'wx'});entries.push('global-bundle.pem');}
    const artifact=join(output,item.name);createZip(dir,artifact,entries);
    const bytes=await readFile(artifact);
    artifacts[item.name]={targetFunction:item.targetFunction,handler:item.entry.replace(/\.js$/,'.handler'),runtime:item.runtime,
      sha256:hash(bytes),bytes:bytes.length,entries:listZipEntries(artifact),sourceInputs:inputs};
  }
  return artifacts;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.env.COED_RDS_CA_FILE)throw Error('COED_RDS_CA_FILE is required.');
  const caBytes=publicCa(await readFile(process.env.COED_RDS_CA_FILE));
  const output=await mkdtemp(join(tmpdir(),'coed-tu-local-candidate-'));
  const artifacts=await packageTuAuth({output,caBytes});
  const manifest={status:'LOCAL_CANDIDATE_NOT_DEPLOYED',deploymentApproved:false,artifacts};
  await writeFile(join(output,'tu-auth-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({output,...manifest}));
}
