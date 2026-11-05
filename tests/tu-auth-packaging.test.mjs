import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {rootCertificates} from 'node:tls';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {packageTuAuth,publicCa} from '../scripts/package-tu-auth.mjs';
import {listZipEntries,readZipEntry} from '../scripts/operations/zip-archive.mjs';
test('dedicated artifacts bind handlers to distinct targets and load without checkout, credentials or DB',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'coed-tu-package-test-'));
  try{
    const artifacts=await packageTuAuth({output:dir,caBytes:Buffer.from(rootCertificates[0]+'\n')});
    assert.equal(artifacts['coed-tu-broker.zip'].targetFunction,'coed-tu-auth');
    assert.equal(artifacts['coed-tu-session-issuer.zip'].targetFunction,'coed-tu-session-issuer');
    for(const [name,a] of Object.entries(artifacts)){
      const file=join(dir,name);assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),a.sha256);
      assert.deepEqual(listZipEntries(file).sort(),a.entries.slice().sort());
      const extracted=join(dir,a.targetFunction);await mkdir(extracted);
      for(const entry of a.entries){await mkdir(dirname(join(extracted,entry)),{recursive:true});await writeFile(join(extracted,entry),readZipEntry(file,entry));}
      const entry=a.entries.find(x=>x.endsWith('.js'));
      const code=a.targetFunction==='coed-tu-auth'
        ? `const {handler}=require('./${entry}');handler({rawPath:'/api/v3/auth/tu-status',requestContext:{http:{method:'GET'}}}).then(r=>console.log(JSON.stringify({status:r.statusCode,configured:JSON.parse(r.body).data.configured})));`
        : `const {handler}=require('./${entry}');handler({verified:true}).then(r=>console.log(JSON.stringify({ok:r.ok,status:r.error.status})));`;
      const lines=execFileSync(process.execPath,['-e',code],{cwd:extracted,encoding:'utf8',env:{PATH:process.env.PATH}}).trim().split(/\r?\n/);
      assert.deepEqual(JSON.parse(lines.at(-1)),a.targetFunction==='coed-tu-auth'?{status:200,configured:false}:{ok:false,status:403});
      assert.ok(!a.entries.some(e=>/migrations|\.env|node_modules|fixture|\.map$/.test(e)));
      assert.ok(!a.sourceInputs.includes('src/auth/tu-auth-service.js'));
    }
    assert.deepEqual(artifacts['coed-tu-broker.zip'].entries,['src/tu-auth-broker.js']);
    assert.deepEqual(artifacts['coed-tu-session-issuer.zip'].entries.sort(),['global-bundle.pem','src/tu-session-issuer.js']);
    assert.ok(!artifacts['coed-tu-broker.zip'].sourceInputs.some(p=>p.startsWith('src/db/') || p.endsWith('/tu-keys.js')));
    assert.ok(!artifacts['coed-tu-session-issuer.zip'].sourceInputs.some(p=>p.endsWith('/tu-provider-verifier.js')));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('dedicated package accepts only public CA material, never a private key trailer',()=>{
  assert.throws(()=>publicCa(Buffer.from(rootCertificates[0]+'\n-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n')),/Only public CA/);
});
