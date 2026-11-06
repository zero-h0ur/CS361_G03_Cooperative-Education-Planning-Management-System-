import test from 'node:test';
import assert from 'node:assert/strict';
import maintenance from '../src/maintenance.js';
import access from '../src/shared/application-access.js';
const id='11111111-1111-4111-8111-111111111111';
const event=(path,method='GET',rawQueryString='',queryStringParameters)=>({rawPath:path,rawQueryString,queryStringParameters,requestContext:{http:{method}}});
const response=(...args)=>maintenance.maintenanceResponse(...args);

test('browse admits only genuine owner/session and public directory GET surfaces',()=>{
  for(const path of ['/api/v3/me','/api/v3/students/me','/api/tu-proxy/api/v3/me','/api/tu-proxy/api/v3/students/me',
    '/api/tu-proxy/api/v4/application-options','/api/tu-proxy/api/v4/applications',
    '/api/tu-proxy/api/v4/applications/'+id,'/api/directory/companies','/api/directory/companies/'+id])
    assert.equal(response(event(path),'browse'),null,path);
  for(const query of ['page=1&pageSize=12','q=example&location=Bangkok','q=a%26b',''])
    assert.equal(response(event('/api/directory/companies','GET',query),'browse'),null);
});

test('browse never opens business writes, signed downloads, readiness, selection or administrative surfaces',()=>{
  for(const method of ['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'])
    for(const path of ['/api/tu-proxy/api/v4/applications','/api/tu-proxy/api/v4/applications/'+id,
      '/api/directory/companies','/api/v3/students/me'])assert.equal(response(event(path,method),'browse').statusCode,503);
  for(const path of ['/api/v4/applications','/api/tu-proxy/api/v4/applications/'+id+'/readiness',
    '/api/tu-proxy/api/v4/applications/'+id+'/documents/'+id+'/content',
    '/api/tu-proxy/api/v4/applications/'+id+'/documents/'+id+'/download',
    '/api/tu-proxy/api/v4/applications/'+id+'/submit','/api/tu-proxy/api/v4/applications/not-a-uuid',
    '/api/tu-proxy/api/v4/applications/'+id+'/', '/api/tu-proxy/api/v4/applications/%2e%2e',
    '/api/v3/directory/companies','/api/v4/cycles/'+id+'/selection-decision',
    '/api/v3/admin/operations','/api/directory/companies/'+id+'/positions'])
    assert.equal(response(event(path),'browse').statusCode,503,path);
});

test('private query spoofing and nonpublic/duplicate directory filters fail closed',()=>{
  for(const path of ['/api/tu-proxy/api/v4/applications','/api/tu-proxy/api/v4/application-options',
    '/api/tu-proxy/api/v4/applications/'+id,'/api/directory/companies/'+id]){
    assert.equal(response(event(path,'GET','student_id='+id),'browse').statusCode,503);
    assert.equal(response(event(path,'GET','',{student_id:id}),'browse').statusCode,503);
  }
  for(const query of ['role=Developer','duration=6','recruitingOnly=true','q=a&q=b','student_id='+id])
    assert.equal(response(event('/api/directory/companies','GET',query),'browse').statusCode,503);
});

test('verify semantics stay unchanged, unknown maintenance modes fail closed and off preserves routing',()=>{
  assert.equal(response(event('/api/tu-proxy/api/v3/me'),'verify'),null);
  for(const path of ['/api/directory/companies','/api/tu-proxy/api/v4/application-options'])
    for(const mode of ['verify','full','unexpected'])assert.equal(response(event(path),mode).statusCode,503);
  assert.equal(response(event('/arbitrary','POST'),'off'),null);
  const blocked=response(event('/arbitrary'),'browse');assert.equal(JSON.parse(blocked.body).error.code,'COED_MAINTENANCE');
  assert.equal(blocked.headers['Cache-Control'],'no-store');assert.equal(blocked.headers['Retry-After'],'120');
});

test('capabilities cannot advertise write or download access during any restricted mode',()=>{
  for(const mode of ['browse','verify','full','unexpected']){
    const value=access.applicationAccess(mode);assert.equal(value.read_only,true);
    for(const key of ['can_create','can_edit','can_upload','can_submit','can_download'])assert.equal(value[key],false);
  }
  for(const mode of [undefined,'','off'])assert.equal(access.applicationAccess(mode).can_create,true);
});
