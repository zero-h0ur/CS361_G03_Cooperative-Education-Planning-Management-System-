const {randomUUID}=require('node:crypto');
const {ThreeRoleService}=require('../src/api/services/three-role-service');
const {ThreeRoleRepository}=require('../src/db/repositories/three-role-repository');
const {toStudentSelfProfile}=require('../src/api/services/student-profile-service');

describe('profile contact email: independent, authorized, versioned and audited',()=>{
  const actor={isAuthenticated:true,role:'STUDENT',userId:randomUUID(),studentId:randomUUID()};
  let row,repository,service,client,receipts;
  beforeEach(()=>{
    row={id:actor.studentId,user_id:actor.userId,version:1,student_number:'SYNTHETIC',full_name:'Synthetic Student',
      institutional_email:'university@example.invalid',contact_address:'Original address',contact_phone:'0810000000',contact_email:null,private_note:'secret'};
    receipts=new Map();
    client={query:jest.fn(async()=>({rows:[]})),release:jest.fn()};
    repository={getClient:async()=>client,actor:async()=>({role:'STUDENT',account_status:'ACTIVE'}),
      one:jest.fn(async()=>({...row})),receipt:async(_c,id)=>receipts.get(id),
      contact:jest.fn(async(_c,_actor,address,phone,email)=>{
        row={...row,contact_address:address,contact_phone:phone,contact_email:email,version:row.version+1};return {...row};
      }),record:jest.fn(async(_c,a,action,resource,body,hash,result)=>receipts.set(body.operation_id,
        {actor_id:a.userId,action,resource_id:resource,request_hash:hash,result}))};
    service=new ThreeRoleService({threeRoleRepository:repository});
  });
  const command=(data={},version=1)=>({...data,version,operation_id:randomUUID()});
  test('email-only update retains phone/address and immutable university identity',async()=>{
    const result=await service.saveContact(actor,command({contact_email:'  contact@example.invalid  '}));
    expect(result).toMatchObject({contact_email:'contact@example.invalid',contact_phone:'0810000000',contact_address:'Original address',institutional_email:'university@example.invalid',version:2});
    expect(result).not.toHaveProperty('private_note');expect(result).not.toHaveProperty('user_id');
    expect(repository.record).toHaveBeenCalledTimes(1);
  });
  test('omitted email is preserved; explicit null or empty clears it',async()=>{
    row.contact_email='existing@example.invalid';
    expect((await service.saveContact(actor,command({contact_phone:'0820000000'}))).contact_email).toBe(row.contact_email);
    expect((await service.saveContact(actor,command({contact_email:''},2))).contact_email).toBeNull();
    expect((await service.saveContact(actor,command({contact_email:null},3))).contact_email).toBeNull();
  });
  test.each(['invalid','two@@example.invalid','x@example.invalid\r\nBcc:evil@example.invalid','a '.repeat(130),42,{},'x@ example.invalid'])('rejects invalid email %p before a write',async email=>{
    await expect(service.saveContact(actor,command({contact_email:email}))).rejects.toMatchObject({statusCode:400});
    expect(repository.contact).not.toHaveBeenCalled();
  });
  test('replay is stable and stale/changed operation IDs fail without another update',async()=>{
    const body=command({contact_email:'contact@example.invalid'});
    await service.saveContact(actor,body);
    expect((await service.saveContact(actor,body)).idempotent_replay).toBe(true);
    await expect(service.saveContact(actor,{...body,contact_email:'other@example.invalid'})).rejects.toMatchObject({code:'IDEMPOTENCY_KEY_REUSED'});
    await expect(service.saveContact(actor,command({contact_email:'other@example.invalid'}))).rejects.toMatchObject({code:'STALE_RECORD_CONFLICT'});
    expect(repository.contact).toHaveBeenCalledTimes(1);
  });
  test('role, ownership, deactivated account, official fields and command metadata remain protected',async()=>{
    await expect(service.saveContact({...actor,role:'STAFF'},command({contact_email:null}))).rejects.toMatchObject({statusCode:403});
    await expect(service.saveContact(actor,command({institutional_email:'spoof@example.invalid'}))).rejects.toMatchObject({statusCode:400});
    await expect(service.saveContact(actor,{contact_email:null,version:1})).rejects.toMatchObject({statusCode:400});
    row.user_id=randomUUID();
    await expect(service.saveContact(actor,command({contact_email:null}))).rejects.toMatchObject({statusCode:403});
    repository.actor=async()=>({role:'STUDENT',account_status:'INACTIVE'});
    await expect(service.saveContact(actor,command({contact_email:null}))).rejects.toMatchObject({statusCode:403});
    expect(repository.contact).not.toHaveBeenCalled();
  });
  test('repository only writes the owned profile, never application snapshots',async()=>{
    const r=new ThreeRoleRepository();r.one=jest.fn(async()=>row);
    await r.contact(client,actor,'address','0810000000','contact@example.invalid');
    const [,sql,values]=r.one.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND user_id=\$2/);expect(sql).not.toMatch(/applications|submissions/);
    expect(values).toEqual([actor.studentId,actor.userId,'address','0810000000','contact@example.invalid']);
    expect(toStudentSelfProfile(row)).toHaveProperty('contact_email',null);
  });
});
