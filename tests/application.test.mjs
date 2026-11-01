import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Pool}=require('pg');
const {ApplicationService}=require('../src/api/services/application-service');
const {readiness,GROUPS}=require('../src/api/services/application-policy');
const input=require('../src/api/services/application-input');
const {validateBytes,createDocumentStore}=require('../src/storage/application-document-store');
const {LocalDocumentStore}=require('../src/storage/local-document-store');
const {S3DocumentStore}=require('../src/storage/s3-document-store');
const {getPermissionScope,ACTIONS}=require('../src/api/services/authorization-service');
const digest=b=>createHash('sha256').update(b).digest('hex');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const metadata=(kind,bytes=pdf)=>({kind,filename:kind==='photo'?'student.png':'document.pdf',content_type:kind==='photo'?'image/png':'application/pdf',byte_size:bytes.length,checksum:digest(bytes)});
const payload=curriculum=>({curriculum,gpax:'3.20',contact_address:'Synthetic address',contact_phone:'0000000000',
  institutional_email:'test@example.invalid',major_group:'CS',guardian_name:'Synthetic guardian',guardian_relationship:'Parent',
  guardian_address:'Synthetic address',guardian_phone:'0000000000',interested_positions:['Developer'],skills:['JavaScript'],
  selected_courses:{alternative:'CS213'},course_attempts:GROUPS[curriculum].map(g=>({code:g[0],attempt:1,points:'3.00'})),
  additional_studies:curriculum==='61'?{CS384:'STUDIED',CS266:'ENROLLED'}:{CS180:'STUDIED',CS262:'ENROLLED'},
  acknowledgements:{conduct:true,terms:true,preplacement:true}});
const policy=curriculum=>({id:randomUUID(),curriculum,version:1,source_year:2568,source:'synthetic test only',verified:true,synthetic:true,
  data:{credits:Object.fromEntries(GROUPS[curriculum].flat().map(code=>[code,'3'])),repeat_rule:'LATEST',alternative_rule:'STUDENT_SELECTED'}});
const check=(p,pol=policy(p.curriculum),extra={})=>readiness({app:{status:'DRAFT',payload:p},official:{academic_verified:true,curriculum:p.curriculum,entry_year:2566},
  policy:pol,documents:['resume','transcript','conduct','photo'].map(kind=>({kind})),window:{is_open:true},roundOpen:true,allowSynthetic:true,...extra});

test('curriculum-specific weighted grades, exact boundary and no invented production eligibility',()=>{
  for(const c of ['61','66'])assert.equal(check(payload(c)).can_submit,true);
  assert.equal(GROUPS['61'].length,6);assert.equal(GROUPS['66'].length,7);
  const p=payload('61'),pol=policy('61');p.course_attempts.forEach(x=>x.points='2.50');
  assert.equal(check(p,pol).can_submit,true);
  p.course_attempts[0].points='2.4999';assert.equal(check(p,pol).can_submit,false);
  p.course_attempts[0].points='4';pol.data.credits.CS101='1';p.course_attempts[1].points='1';pol.data.credits.CS102='9';
  assert.ok(check(p,pol).blockers.some(x=>x.code==='GROUP_GPA_BELOW_MINIMUM'));
  assert.equal(check(payload('61'),pol,{allowSynthetic:false}).eligibility,'UNKNOWN');
  delete pol.data.credits.CS101;assert.equal(check(payload('61'),pol).can_submit,false);
  pol.verified=false;assert.ok(check(p,pol).blockers.some(x=>x.code==='POLICY_PENDING'));
  assert.equal(check(payload('66'),policy('66'),{official:{academic_verified:true,curriculum:'66',entry_year:2568}}).can_submit,false);
  const repeat=payload('61');repeat.course_attempts.push({code:'CS101',attempt:2,points:'0'});
  assert.notEqual(check(repeat).group_gpa,'3.0000');
  assert.equal(check(payload('61'),policy('61'),{window:null}).can_submit,false);
});

test('strict input whitelist, attachment signatures, checksum and production-local guard',()=>{
  assert.throws(()=>input.payload({full_name:'forged'}));
  assert.throws(()=>input.payload({course_attempts:[{code:'CS101',credits:3,points:'4',attempt:1}]}));
  assert.throws(()=>input.payload({gpax:'4.01'}));
  assert.throws(()=>input.upload({...metadata('resume'),operation_id:randomUUID(),expected_version:1,filename:'../x.pdf'}));
  assert.equal(validateBytes(pdf,metadata('resume')),'application/pdf');
  assert.equal(validateBytes(png,metadata('photo',png)),'image/png');
  assert.throws(()=>validateBytes(Buffer.from('<script>not a PDF</script>'),metadata('resume')));
  assert.throws(()=>validateBytes(pdf,{...metadata('resume'),checksum:'0'.repeat(64)}));
  assert.throws(()=>validateBytes(pdf,{...metadata('resume'),content_type:'image/jpeg',filename:'x.jpg'}));
  assert.throws(()=>createDocumentStore({NODE_ENV:'production',CO_ED_APPLICATION_STORAGE:'local'}));
  assert.throws(()=>createDocumentStore({NODE_ENV:'test',CO_ED_APPLICATION_STORAGE:'local',AWS_LAMBDA_FUNCTION_NAME:'test'}));
  assert.throws(()=>createDocumentStore({}));
  assert.equal(getPermissionScope('STUDENT',ACTIONS.APPLICATION_WRITE),'AUTHENTICATED');
  assert.equal(getPermissionScope('COORDINATOR',ACTIONS.APPLICATION_READ),'AUTHENTICATED');
  for(const role of ['COORDINATOR','COMMITTEE','STAFF','ADVISOR','ADMIN','PUBLIC'])assert.equal(getPermissionScope(role,ACTIONS.APPLICATION_WRITE),'DENY');
});

test('S3 adapter restricts upload policy and final keys; download never exposes upload credentials',async()=>{
  let post,get,put;const key=`staging/${randomUUID()}`;
  const store=new S3DocumentStore({bucket:'coed-private-test',region:'ap-southeast-1',
    client:{send:async command=>{put=command.input;return {};}},
    presignPost:async(_c,p)=>{post=p;return {url:'https://example.invalid',fields:{key:p.Key}};},
    presignGet:async(_c,p,o)=>{get={input:p.input,...o};return 'https://example.invalid/private';}});
  await store.uploadTarget({key,size:pdf.length,contentType:'application/pdf',checksum:digest(pdf)});
  assert.equal(post.Expires,300);assert.deepEqual(post.Conditions[0],['content-length-range',pdf.length,pdf.length]);
  assert.equal(post.Fields['x-amz-checksum-sha256'],createHash('sha256').update(pdf).digest('base64'));
  await store.writeFinal(`final/${randomUUID()}`,pdf);assert.equal(put.IfNoneMatch,'*');assert.equal(put.ServerSideEncryption,'AES256');
  await store.downloadTarget({key:put.Key});assert.equal(get.expiresIn,60);assert.equal(get.input.ResponseCacheControl,'no-store');
  await assert.rejects(store.writeFinal(key,pdf));
});

test('Phase 1 PostgreSQL + real private bytes: isolated application lifecycle and failures',
 {skip:!process.env.CO_ED_APPLICATION_TEST_DATABASE_URL && !process.env.CI},async t=>{
  const url=new URL(process.env.CO_ED_APPLICATION_TEST_DATABASE_URL);
  assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.match(url.pathname,/^\/coed_(?:v4_application|v3)_test$/);
  assert.equal(process.env.NODE_ENV,'test');
  const admin=new Pool({connectionString:url.href}),schema='app_'+randomUUID().replaceAll('-','');
  const role='app_role_'+randomUUID().replaceAll('-','');
  const directory=await mkdtemp(join(tmpdir(),'coed-application-test-'));let pool,runtime;
  try{
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const c=await admin.connect();
    try{await c.query(`SET search_path TO "${schema}",public`);
      for(const name of (await readdir(new URL('../src/db/migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).sort())
        await c.query(await readFile(new URL('../src/db/migrations/'+name,import.meta.url),'utf8'));
    }finally{await c.query('RESET search_path');c.release();}
    pool=new Pool({connectionString:url.href,options:`-c search_path=${schema},public`,max:10});
    const q=(s,p=[])=>pool.query(s,p);
    const student=randomUUID(),sid=randomUUID(),other=randomUUID(),otherSid=randomUUID(),coordinator=randomUUID(),outside=randomUUID(),cycle=randomUUID(),cycle2=randomUUID();
    const members=[randomUUID(),randomUUID(),randomUUID()];
    for(const [id,r] of [[student,'STUDENT'],[other,'STUDENT'],[coordinator,'COORDINATOR'],[outside,'COORDINATOR'],...members.map(id=>[id,'COMMITTEE'])])
      await q('INSERT INTO users(id,role) VALUES($1,$2)',[id,r]);
    for(const [id,user,number] of [[sid,student,'TEST141001'],[otherSid,other,'TEST141002']])
      await q(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,department,program,major,academic_year,enrollment_status,source,visibility,data_status)
        VALUES($1,$2,$3,$3,'Synthetic Student','test@example.invalid','CS','CS','CS',2569,'ACTIVE','synthetic test','private','mock')`,[id,user,number]);
    for(const id of [cycle,cycle2])await q("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Test only',2569,1,'OPEN','synthetic test','public','mock')",[id]);
    await q(`INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three)
      VALUES($1,$2,'CS','CS',$3,$4,$5,$6)`,[randomUUID(),cycle,coordinator,...members]);
    const actor={isAuthenticated:true,userId:student,studentId:sid,role:'STUDENT',accountStatus:'ACTIVE'};
    const coord={isAuthenticated:true,userId:coordinator,role:'COORDINATOR',accountStatus:'ACTIVE'};
    const store=new LocalDocumentStore({root:directory});const service=new ApplicationService({pool,documentStore:store,allowSyntheticPolicy:true});
    let app,pol;
    const command=()=>({operation_id:randomUUID(),expected_version:app.version});
    const save=(p=payload('66'),extra={})=>service.save(actor,app.id,{...command(),payload:p,expected_policy_id:pol?.id || null,...extra});
    const attach=async(kind,bytes=kind==='photo'?png:pdf)=>{
      const ticket=await service.beginUpload(actor,app.id,{...command(),...metadata(kind,bytes)});
      await service.localContent(actor,app.id,ticket.ticket_id,bytes);
      app=await service.completeUpload(actor,app.id,ticket.ticket_id,command());return ticket;
    };
    await t.test('Draft is incomplete-safe, idempotent and separated by owner/cycle',async()=>{
      const op={operation_id:randomUUID(),cycle_id:cycle};app=await service.create(actor,op);
      assert.equal((await service.create(actor,op)).id,app.id);
      assert.equal((await service.readiness(actor,app.id)).can_submit,false);
      const app2=await service.create(actor,{operation_id:randomUUID(),cycle_id:cycle2});assert.notEqual(app2.id,app.id);
      await assert.rejects(service.create(actor,{operation_id:randomUUID(),cycle_id:cycle}),e=>e.statusCode===409);
      await assert.rejects(service.get({...actor,userId:other,studentId:otherSid},app.id),e=>e.statusCode===404);
      await assert.rejects(service.get(coord,app.id),e=>e.statusCode===404);
      app=await save({contact_address:'Unsaved elsewhere'});
      assert.equal((await service.get(actor,app2.id)).payload.contact_address,undefined);
      await assert.rejects(service.save(actor,app.id,{...command(),payload:{full_name:'tamper'},expected_policy_id:null}));
    });
    await t.test('real uploads work before criteria verification, replacement is atomic and stale writes fail',async()=>{
      app=await save();await attach('resume');const old=app.documents[0];
      const broken=await service.beginUpload(actor,app.id,{...command(),...metadata('resume')});
      await service.localContent(actor,app.id,broken.ticket_id,Buffer.alloc(pdf.length));
      await assert.rejects(service.completeUpload(actor,app.id,broken.ticket_id,command()),e=>e.statusCode===400);
      assert.equal((await service.get(actor,app.id)).documents[0].id,old.id);
      assert.deepEqual((await service.localContent(actor,app.id,old.id)).bytes,pdf);
      const result=await service.download(actor,app.id,old.id);assert.equal(result.download.auth_required,true);
      assert.notEqual(result.document.object_key,broken.upload.url);
      await assert.rejects(service.submit(actor,app.id,{...command(),expected_policy_id:null}),e=>e.code==='APPLICATION_NOT_READY');
      await attach('resume');assert.notEqual(app.documents[0].id,old.id);
      await assert.rejects(service.download(actor,app.id,old.id),e=>e.statusCode===403);
      await assert.rejects(save(payload('66'),{expected_version:1}),e=>e.statusCode===409);
      assert.equal((await service.get(actor,app.id)).payload.contact_address,'Synthetic address');
    });
    await t.test('configured metadata, file completeness and weighted readiness gate the first submission',async()=>{
      for(const id of [sid])await q(`INSERT INTO phase1_academic_profiles(student_id,curriculum,entry_year,institution,source,verified_by)
        VALUES($1,'66',2566,'TU_CS','synthetic test only',$2)`,[id,coordinator]);
      await q("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[cycle]);
      pol=policy('66');await q(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data)
        VALUES($1,$2,'66',1,2568,'synthetic test only',true,true,$3)`,[pol.id,cycle,JSON.stringify(pol.data)]);
      for(const kind of ['transcript','conduct','photo'])await attach(kind);
      assert.equal((await service.readiness(actor,app.id)).can_submit,true);
      assert.equal((await new ApplicationService({pool,documentStore:store}).readiness(actor,app.id)).can_submit,false);
      const before=app.version;
      const outcomes=await Promise.allSettled([save(),save()]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(outcomes.find(x=>x.status==='rejected').reason.statusCode,409);
      app=await service.get(actor,app.id);assert.equal(app.version,before+1);
    });
    await t.test('first submission snapshots once, locks fields/files and is visible only to scoped Coordinator',async()=>{
      const pending=await service.beginUpload(actor,app.id,{...command(),...metadata('resume')});
      await service.localContent(actor,app.id,pending.ticket_id,pdf);
      const op={...command(),expected_policy_id:pol.id};app=await service.submit(actor,app.id,op);
      assert.equal(app.status,'SUBMITTED');assert.equal(app.submission.snapshot.documents.length,4);
      assert.equal((await service.submit(actor,app.id,op)).idempotent_replay,true);
      assert.equal((await service.get(coord,app.id)).submission.checksum,app.submission.checksum);
      await assert.rejects(service.get({...coord,userId:outside},app.id),e=>e.statusCode===404);
      await assert.rejects(save(),e=>e.statusCode===422);
      await assert.rejects(service.completeUpload(actor,app.id,pending.ticket_id,command()),e=>e.statusCode===422);
      await assert.rejects(q("UPDATE phase1_applications SET payload='{}',version=version+1 WHERE id=$1",[app.id]),e=>e.code==='55000');
      await assert.rejects(q('DELETE FROM phase1_attachments WHERE application_id=$1',[app.id]),e=>e.code==='55000');
      await assert.rejects(q('UPDATE phase1_submissions SET snapshot=\'{}\' WHERE application_id=$1',[app.id]),e=>e.code==='55000');
      await q("UPDATE users SET account_status='DISABLED' WHERE id=$1",[student]);
      await assert.rejects(service.submit(actor,app.id,op),e=>e.statusCode===403);
      await q("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[student]);
    });
    await t.test('production-equivalent least privileges can save and upload, but cannot forge verified metadata',async()=>{
      await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
      // Execute the checked-in policy against this test schema/role, not public data.
      await q('CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum char(64))');
      const grants=(await readFile(new URL('../src/db/operations/v3-runtime-grants.sql',import.meta.url),'utf8'))
        .replace(/^\\set[^\n]*\n/m,'').replaceAll('public.',`"${schema}".`).replaceAll('SCHEMA public',`SCHEMA "${schema}"`).replaceAll('coed_app',role);
      await q(grants);
      runtime=new Pool({connectionString:url.href,options:`-c search_path=${schema},public -c role=${role}`});
      const svc=new ApplicationService({pool:runtime,documentStore:store});
      let draft=(await svc.list(actor)).find(x=>x.cycle_id===cycle2);
      draft=await svc.save(actor,draft.id,{operation_id:randomUUID(),expected_version:draft.version,expected_policy_id:null,payload:{contact_address:'ACL test'}});
      assert.equal(draft.payload.contact_address,'ACL test');
      const ticket=await svc.beginUpload(actor,draft.id,{operation_id:randomUUID(),expected_version:draft.version,...metadata('resume')});
      await svc.localContent(actor,draft.id,ticket.ticket_id,pdf);
      const attached=await svc.completeUpload(actor,draft.id,ticket.ticket_id,{operation_id:randomUUID(),expected_version:draft.version});
      assert.equal(attached.documents.length,1);
      for(const sql of ["UPDATE phase1_policies SET verified=true WHERE false","UPDATE phase1_academic_profiles SET curriculum='61' WHERE false",
        'DELETE FROM phase1_documents WHERE false','DELETE FROM phase1_operations WHERE false'])await assert.rejects(runtime.query(sql),e=>e.code==='42501');
    });
  }finally{
    await runtime?.end();await pool?.end();
    // Only the randomly named schema and temporary directory created by this test.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);await admin.end();
    await rm(directory,{recursive:true,force:true});
  }
});
