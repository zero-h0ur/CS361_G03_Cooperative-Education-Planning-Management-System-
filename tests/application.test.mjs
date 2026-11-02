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
const {ApplicationRepository}=require('../src/db/repositories/application-repository');
const {readiness,GROUPS}=require('../src/api/services/application-policy');
const input=require('../src/api/services/application-input');
const {ACKNOWLEDGEMENTS}=require('../src/shared/application-form');
const {validateBytes,createDocumentStore}=require('../src/storage/application-document-store');
const {LocalDocumentStore}=require('../src/storage/local-document-store');
const {S3DocumentStore}=require('../src/storage/s3-document-store');
const {createApiServer,attachRequestContext,UnauthorizedError}=require('../src/api/app');
const {getPermissionScope,ACTIONS}=require('../src/api/services/authorization-service');
const digest=b=>createHash('sha256').update(b).digest('hex');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const metadata=(kind,bytes=pdf)=>({kind,filename:kind==='photo'?'student.png':'document.pdf',content_type:kind==='photo'?'image/png':'application/pdf',byte_size:bytes.length,checksum:digest(bytes)});
const payload=curriculum=>({curriculum,gpax:'3.20',declared_group_gpa:'3.00',gpax_reporting_term:'Synthetic term 3/2568',
  name_prefix:'Mx',thai_full_name:'นักศึกษาสมมติ สำหรับทดสอบ',english_full_name:'Synthetic Test Student',contact_email:'contact@example.invalid',contact_address:'Synthetic address',contact_phone:'0000000000',
  institutional_email:'test@example.invalid',major_group:'CIS',guardian_name:'Synthetic guardian',guardian_relationship:'Parent',
  guardian_address:'Synthetic address',guardian_phone:'0000000000',interested_position_codes:['SOFTWARE'],skills_detail:'JavaScript\nTesting and teamwork',
  selected_courses:{alternative:'CS213'},course_attempts:GROUPS[curriculum].map(g=>({code:g[0],attempt:1,points:'3.00'})),
  additional_studies:curriculum==='61'?{CS384:'STUDIED',CS266:'ENROLLED'}:{CS180:'STUDIED',CS262:'ENROLLED'},
  acknowledgements:Object.fromEntries(ACKNOWLEDGEMENTS.map(key=>[key,true]))});
const policy=curriculum=>({id:randomUUID(),curriculum,version:1,source_year:2568,source:'synthetic test only',verified:true,synthetic:true,
  data:{credits:Object.fromEntries(GROUPS[curriculum].flat().map(code=>[code,'3'])),repeat_rule:'LATEST',alternative_rule:'STUDENT_SELECTED'}});
const check=(p,pol=policy(p.curriculum),extra={})=>readiness({app:{status:'DRAFT',payload:p},official:{academic_verified:true,curriculum:p.curriculum,entry_year:2566},
  policy:pol,documents:['resume','transcript','conduct','photo'].map(kind=>({kind})),window:{is_open:true},roundOpen:true,allowSynthetic:true,...extra});

test('curriculum-specific weighted grades, exact boundary and no invented production eligibility',()=>{
  for(const c of ['61','66'])assert.equal(check(payload(c)).can_submit,true);
  const boundary=payload('66');boundary.gpax='2.7500';assert.equal(check(boundary).can_submit,true);
  boundary.gpax='2.7499';assert.equal(check(boundary).can_submit,false);
  const alternative=payload('61');alternative.course_attempts.push({code:'CS216',attempt:1,points:'0'});
  assert.equal(check(alternative).group_gpa,'3.0000');alternative.selected_courses.alternative='CS216';assert.equal(check(alternative).group_gpa,'2.5000');
  const unknown=policy('66');unknown.data.repeat_rule=null;assert.equal(check(payload('66'),unknown).eligibility,'UNKNOWN');
  const unsupported=policy('66');unsupported.source_year=2569;assert.equal(check(payload('66'),unsupported).can_submit,false);
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
  const exact=Buffer.alloc(10485760,32);pdf.copy(exact);Buffer.from('%%EOF').copy(exact,exact.length-5);
  assert.equal(validateBytes(exact,metadata('resume',exact)),'application/pdf');
  assert.throws(()=>input.upload({...metadata('resume'),byte_size:10485761,operation_id:randomUUID(),expected_version:1}));
  assert.throws(()=>input.upload({...metadata('photo',png),byte_size:5242881,operation_id:randomUUID(),expected_version:1}));
  const jpeg=Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]);
  assert.equal(validateBytes(jpeg,{...metadata('photo',jpeg),filename:'student.jpg',content_type:'image/jpeg'}),'image/jpeg');
  assert.deepEqual(input.payload({selected_courses:{alternative:''}}),{selected_courses:{alternative:''}});
  assert.throws(()=>createDocumentStore({NODE_ENV:'production',CO_ED_APPLICATION_STORAGE:'local'}));
  assert.throws(()=>createDocumentStore({NODE_ENV:'test',CO_ED_APPLICATION_STORAGE:'local',AWS_LAMBDA_FUNCTION_NAME:'test'}));
  assert.throws(()=>createDocumentStore({}));
  assert.equal(getPermissionScope('STUDENT',ACTIONS.APPLICATION_WRITE),'AUTHENTICATED');
  assert.equal(getPermissionScope('COORDINATOR',ACTIONS.APPLICATION_READ),'AUTHENTICATED');
  for(const role of ['COORDINATOR','COMMITTEE','STAFF','ADVISOR','ADMIN','PUBLIC'])assert.equal(getPermissionScope(role,ACTIONS.APPLICATION_WRITE),'DENY');
});

test('reference-form contract preserves partial Drafts, long skills and rejects forged or unbounded fields',()=>{
  assert.deepEqual(input.payload({}),{});
  const p=payload('61');p.skills_detail='ทักษะการทดสอบซอฟต์แวร์ '.repeat(150).trim();p.interested_position_codes=['BACKEND','OTHER'];p.interested_position_other='Security analyst';
  assert.deepEqual(input.payload(p),p);
  for(const bad of [{skills_detail:'x'.repeat(5001)},{name_prefix:'x'.repeat(101)},{english_full_name:'x'.repeat(201)},
    {contact_email:'x'.repeat(255)},{interested_position_codes:['ADMIN']},{interested_position_codes:'BACKEND'},
    {acknowledgements:{approve:true}},{declared_group_gpa:'4.01'},{gpax_reporting_term:'bad\nterm'},{form_version:2}])assert.throws(()=>input.payload(bad));
  assert.equal(input.payload({skills_detail:'<script>not markup</script>'}).skills_detail,'<script>not markup</script>');
});

test('seven declarations are independently required, not inferred from the old three or computed grades',()=>{
  const original=payload('66');for(const key of ACKNOWLEDGEMENTS){const p=structuredClone(original);delete p.acknowledgements[key];
    assert.ok(check(p).blockers.some(b=>b.field==='acknowledgements.'+key));}
  const old=structuredClone(original);old.acknowledgements={terms:true,conduct:true,preplacement:true};
  assert.equal(check(old).blockers.filter(b=>b.code==='ACK_REQUIRED').length,4);
  assert.deepEqual(Object.keys(old.acknowledgements),['terms','conduct','preplacement']);
});

test('new declared fields gate new submissions without replacing verified university data or eligibility calculations',()=>{
  for(const field of ['name_prefix','thai_full_name','english_full_name','contact_email','gpax_reporting_term','declared_group_gpa']){
    const p=payload('66');delete p[field];assert.ok(check(p).blockers.some(b=>b.field===field),field);
  }
  const p=payload('66');p.contact_email='incomplete';p.major_group='Legacy CS';p.interested_position_codes=['OTHER'];
  assert.ok(check(p).blockers.some(b=>b.field==='contact_email'));
  assert.ok(check(p).blockers.some(b=>b.field==='major_group'));
  assert.ok(check(p).blockers.some(b=>b.field==='interested_position_other'));
  p.interested_position_other='Security analyst';p.contact_email='valid@example.invalid';p.major_group='ACS';
  p.declared_group_gpa='4';const pending=policy('66');pending.verified=false;assert.equal(check(p,pending).can_submit,false);
  const failing=payload('61');failing.course_attempts.forEach(r=>r.points='1');failing.declared_group_gpa='4';
  assert.ok(check(failing).blockers.some(b=>b.code==='GROUP_GPA_BELOW_MINIMUM'));
  const legacy=payload('66');delete legacy.skills_detail;legacy.skills=['Legacy skill'];assert.equal(check(legacy).can_submit,true);
  legacy.skills_detail='';assert.ok(check(legacy).blockers.some(b=>b.field==='skills_detail'));
});

test('old submitted snapshots keep their form version, payload and declarations without retroactive additions',async()=>{
  const original={contact_address:'Old synthetic address',acknowledgements:{terms:true,conduct:true,preplacement:true}};
  const snapshot={official:{full_name:'Pinned synthetic name'},payload:original,policy:policy('61'),documents:[],cycle:{name:'Old cycle'}};
  const db={query:async sql=>({rows:sql.includes('phase1_submissions')?[{snapshot}]:[{name:'New cycle name',status:'CLOSED'}]})};
  const service=new ApplicationService({repository:{}});
  const result=await service.detail(db,{}, {id:randomUUID(),cycle_id:randomUUID(),status:'SUBMITTED',version:2,payload:{contact_address:'Changed source'}});
  assert.equal(result.form_version,1);assert.deepEqual(result.payload,original);assert.equal(result.official.full_name,'Pinned synthetic name');assert.equal(result.cycle_name,'Old cycle');
  assert.equal(result.payload.acknowledgements.program,undefined);assert.equal(result.payload.contact_email,undefined);
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
      const repository=new ApplicationRepository({pool}),profile=repository.profile.bind(repository);
      repository.profile=async(...args)=>({...await profile(...args),english_full_name:'Verified Fictional Name'});
      const trustedService=new ApplicationService({repository});
      await assert.rejects(trustedService.save(actor,app.id,{...command(),payload:{english_full_name:'Forged name'},expected_policy_id:null}),e=>e.statusCode===400);
      assert.equal((await service.get(actor,app.id)).payload.english_full_name,undefined);
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
    await t.test('completion DB failure cannot detach the old file; retry commits once without losing Draft fields',async()=>{
      const before=await service.get(actor,app.id),old=before.documents.find(d=>d.kind==='resume');
      const ticket=await service.beginUpload(actor,app.id,{...command(),...metadata('resume')});
      await service.localContent(actor,app.id,ticket.ticket_id,pdf);const op=command();
      const failingPool={query:(...args)=>pool.query(...args),connect:async()=>{
        const c=await pool.connect();return {release:()=>c.release(),query:(sql,...args)=>{
          if(sql.includes('INSERT INTO phase1_events'))throw new Error('Injected transaction failure');return c.query(sql,...args);
        }};
      }};
      await assert.rejects(new ApplicationService({pool:failingPool,documentStore:store}).completeUpload(actor,app.id,ticket.ticket_id,op));
      assert.equal((await service.get(actor,app.id)).documents.find(d=>d.kind==='resume').id,old.id);
      assert.equal((await service.get(actor,app.id)).version,before.version);
      assert.equal((await q('SELECT count(*)::int AS n FROM phase1_operations WHERE operation_id=$1',[op.operation_id])).rows[0].n,0);
      app=await service.completeUpload(actor,app.id,ticket.ticket_id,op);
      assert.equal((await service.completeUpload(actor,app.id,ticket.ticket_id,op)).idempotent_replay,true);
      assert.deepEqual(app.payload,before.payload);
      const otherApp=(await service.list(actor)).find(x=>x.cycle_id===cycle2);
      await assert.rejects(service.download(actor,otherApp.id,app.documents[0].id),e=>e.statusCode===403);
      await assert.rejects(service.completeUpload(actor,otherApp.id,ticket.ticket_id,{operation_id:randomUUID(),expected_version:otherApp.version}),e=>e.statusCode===409);
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
    await t.test('closed deadlines reject writes and show retained Drafts as read-only; policy changes fail visibly',async()=>{
      const before=app.version;
      await q("UPDATE phase1_cycle_windows SET closes_at=now()-interval '1 second',opens_at=now()-interval '1 day' WHERE cycle_id=$1",[cycle]);
      assert.equal((await service.get(actor,app.id)).availability.can_edit,false);
      await assert.rejects(save(),e=>e.statusCode===422);
      assert.equal((await service.get(actor,app.id)).version,before);
      await q("UPDATE phase1_cycle_windows SET closes_at=now()+interval '1 day' WHERE cycle_id=$1",[cycle]);
      const next={...pol,id:randomUUID(),version:2};
      await q(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data)
        VALUES($1,$2,'66',2,2568,'synthetic policy v2',true,true,$3)`,[next.id,cycle,JSON.stringify(next.data)]);
      await assert.rejects(save(),e=>e.code==='POLICY_CHANGED');
      assert.equal((await service.get(actor,app.id)).version,before);pol=next;app=await service.get(actor,app.id);
    });
    await t.test('injected submission failure rolls back state, snapshot, receipt and event together',async()=>{
      const op={...command(),expected_policy_id:pol.id};
      const failingPool={query:(...args)=>pool.query(...args),connect:async()=>{
        const c=await pool.connect();return {release:()=>c.release(),query:(sql,...args)=>{
          if(sql.includes('INSERT INTO phase1_events'))throw new Error('Injected submission failure');return c.query(sql,...args);
        }};
      }};
      await assert.rejects(new ApplicationService({pool:failingPool,documentStore:store,allowSyntheticPolicy:true}).submit(actor,app.id,op));
      assert.equal((await service.get(actor,app.id)).status,'DRAFT');
      assert.equal((await q('SELECT count(*)::int AS n FROM phase1_submissions WHERE application_id=$1',[app.id])).rows[0].n,0);
      assert.equal((await q('SELECT count(*)::int AS n FROM phase1_events WHERE operation_id=$1',[op.operation_id])).rows[0].n,0);
    });
    await t.test('expired/unfinished uploads do not attach; finalization racing submission cannot change its document snapshot',async()=>{
      const original=app,newCycle=randomUUID(),racePolicy={...pol,id:randomUUID()};
      await q("INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status) VALUES($1,'Race test only',2569,1,'OPEN','synthetic test','public','mock')",[newCycle]);
      await q("INSERT INTO phase1_cycle_windows(cycle_id,opens_at,closes_at) VALUES($1,now()-interval '1 day',now()+interval '1 day')",[newCycle]);
      await q(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data)
        VALUES($1,$2,'66',1,2568,'synthetic race test',true,true,$3)`,[racePolicy.id,newCycle,JSON.stringify(pol.data)]);
      app=await service.create(actor,{operation_id:randomUUID(),cycle_id:newCycle});
      app=await service.save(actor,app.id,{...command(),payload:payload('66'),expected_policy_id:racePolicy.id});
      const empty=await service.beginUpload(actor,app.id,{...command(),...metadata('resume')});
      await assert.rejects(service.completeUpload(actor,app.id,empty.ticket_id,command()));
      assert.equal((await service.get(actor,app.id)).documents.length,0);
      await q("UPDATE phase1_uploads SET expires_at=now()-interval '1 second' WHERE id=$1",[empty.ticket_id]);
      await assert.rejects(service.localContent(actor,app.id,empty.ticket_id,pdf),e=>e.code==='UPLOAD_EXPIRED');
      for(const kind of ['resume','transcript','conduct','photo'])await attach(kind);
      const ticket=await service.beginUpload(actor,app.id,{...command(),...metadata('resume')});await service.localContent(actor,app.id,ticket.ticket_id,pdf);
      const oldVersion=app.version,oldDocuments=copyDocuments(app.documents);
      const outcomes=await Promise.allSettled([
        service.completeUpload(actor,app.id,ticket.ticket_id,command()),
        service.submit(actor,app.id,{...command(),expected_policy_id:racePolicy.id})
      ]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(outcomes.find(x=>x.status==='rejected').reason.statusCode,409);
      app=await service.get(actor,app.id);assert.equal(app.version,oldVersion+1);
      if(app.status==='SUBMITTED')assert.deepEqual(copyDocuments(app.submission.snapshot.documents),oldDocuments);
      else app=await service.submit(actor,app.id,{...command(),expected_policy_id:racePolicy.id});
      assert.deepEqual(copyDocuments(app.submission.snapshot.documents),copyDocuments(app.documents));
      assert.equal((await q('SELECT count(*)::int AS n FROM phase1_submissions WHERE application_id=$1',[app.id])).rows[0].n,1);
      app=original;
    });
    await t.test('first submission snapshots once, locks fields/files and is visible only to scoped Coordinator',async()=>{
      const pending=await service.beginUpload(actor,app.id,{...command(),...metadata('resume')});
      await service.localContent(actor,app.id,pending.ticket_id,pdf);
      const op={...command(),expected_policy_id:pol.id};app=await service.submit(actor,app.id,op);
      assert.equal(app.status,'SUBMITTED');assert.equal(app.submission.snapshot.documents.length,4);
      assert.equal(app.form_version,2);assert.equal(app.submission.snapshot.form_version,2);
      assert.equal(app.submission.snapshot.payload.contact_email,'contact@example.invalid');
      assert.equal(app.submission.snapshot.payload.english_full_name,'Synthetic Test Student');
      assert.equal(app.submission.snapshot.payload.declared_group_gpa,'3.00');
      assert.deepEqual(app.submission.snapshot.payload.acknowledgements,Object.fromEntries(ACKNOWLEDGEMENTS.map(key=>[key,true])));
      assert.equal(app.submission.snapshot.policy.effective_criteria.gpax_min,'2.75');
      assert.equal(app.submission.snapshot.policy.effective_criteria.required_groups.length,7);
      assert.equal(app.submission.snapshot.policy.effective_criteria.entry_year_max,2567);
      assert.ok(app.submission.snapshot.cycle.closes_at);
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
      assert.equal((await service.get(coord,app.id)).submission.checksum,app.submission.checksum);
      await q("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[student]);
      const snapshot=app.submission.checksum;
      await q(`INSERT INTO phase1_policies(id,cycle_id,curriculum,version,source_year,source,verified,synthetic,data)
        VALUES($1,$2,'66',3,2568,'synthetic future policy',false,true,'{}')`,[randomUUID(),cycle]);
      const retained=await service.get(actor,app.id);assert.equal(retained.policy.id,pol.id);assert.equal(retained.submission.checksum,snapshot);
      const {ThreeRoleService}=require('../src/api/services/three-role-service');
      const contactVersion=(await q('SELECT version FROM students WHERE id=$1',[sid])).rows[0].version;
      const profile=await new ThreeRoleService({pool}).saveContact(actor,{contact_email:'new-profile@example.invalid',version:contactVersion,operation_id:randomUUID()});
      assert.equal(profile.contact_email,'new-profile@example.invalid');
      const unchanged=await service.get(actor,app.id);
      assert.equal(unchanged.submission.checksum,snapshot);
      assert.equal(unchanged.submission.snapshot.payload.contact_email,'contact@example.invalid');
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
    await t.test('authenticated HTTP upload/download round-trips actual private bytes and denies anonymous access',async()=>{
      let draft=(await service.list(actor)).find(x=>x.cycle_id===cycle2);
      const server=createApiServer({applicationService:service,authOptions:{pool,authMiddleware:async(req)=>{
        if(req.headers.authorization!=='Bearer synthetic-http-test')throw new UnauthorizedError();attachRequestContext(req,actor);
      }}});
      await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
      const headers={Authorization:'Bearer synthetic-http-test','Content-Type':'application/json'};
      try{
        const anonymous=await fetch(`${base}/api/v4/applications/${draft.id}`);assert.equal(anonymous.status,401);
        const saveResponse=await fetch(`${base}/api/v4/applications/${draft.id}`,{method:'PATCH',headers,
          body:JSON.stringify({operation_id:randomUUID(),expected_version:draft.version,expected_policy_id:null,payload:payload('66')})});
        assert.equal(saveResponse.status,200);draft=(await saveResponse.json()).data;
        const readResponse=await fetch(`${base}/api/v4/applications/${draft.id}`,{headers});assert.equal(readResponse.status,200);
        assert.equal(readResponse.headers.get('Cache-Control'),'no-store');const read=(await readResponse.json()).data;
        assert.deepEqual(read.payload,payload('66'));assert.equal(read.form_version,2);
        const forged=await fetch(`${base}/api/v4/applications/${draft.id}`,{method:'PATCH',headers,
          body:JSON.stringify({operation_id:randomUUID(),expected_version:draft.version,expected_policy_id:null,payload:{official:{full_name:'forged'}}})});
        assert.equal(forged.status,400);
        const ticketResponse=await fetch(`${base}/api/v4/applications/${draft.id}/uploads`,{method:'POST',headers,
          body:JSON.stringify({operation_id:randomUUID(),expected_version:draft.version,...metadata('resume')})});
        assert.equal(ticketResponse.status,200);const {data:ticket}=await ticketResponse.json();
        const upload=await fetch(base+ticket.upload.url,{method:'PUT',headers:{Authorization:headers.Authorization},body:pdf});assert.equal(upload.status,200);
        const complete=await fetch(`${base}/api/v4/applications/${draft.id}/uploads/${ticket.ticket_id}/complete`,{method:'POST',headers,
          body:JSON.stringify({operation_id:randomUUID(),expected_version:draft.version})});assert.equal(complete.status,200);
        const {data:updated}=await complete.json(),document=updated.documents.find(d=>d.kind==='resume');
        const targetResponse=await fetch(`${base}/api/v4/applications/${draft.id}/documents/${document.id}/download`,{method:'POST',headers,body:'{}'});
        assert.equal(targetResponse.status,200);const {data:target}=await targetResponse.json();
        assert.equal((await fetch(base+target.download.url)).status,401);
        const file=await fetch(base+target.download.url,{headers:{Authorization:headers.Authorization}});
        assert.equal(file.status,200);assert.equal(file.headers.get('Cache-Control'),'no-store');assert.equal(file.headers.get('X-Content-Type-Options'),'nosniff');
        assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf);
      }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
    });
  }finally{
    await runtime?.end();await pool?.end();
    // Only the randomly named schema and temporary directory created by this test.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`DROP ROLE IF EXISTS "${role}"`);await admin.end();
    await rm(directory,{recursive:true,force:true});
  }
});
function copyDocuments(documents){return documents.map(d=>({id:d.id,kind:d.kind,checksum:d.checksum})).sort((a,b)=>a.kind.localeCompare(b.kind));}
