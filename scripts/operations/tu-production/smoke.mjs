// Run interactively by the account owner. Neither input, token nor returned
// identity/profile is printed or saved. Only exact-origin, read-only requests.
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ORIGIN='https://yhfevhqtoa.execute-api.ap-southeast-2.amazonaws.com';
export async function smoke({studentId,password,fetchImpl=fetch}){
 const request=async(path,options={})=>{
  const response=await fetchImpl(ORIGIN+path,{...options,redirect:'error',signal:AbortSignal.timeout(28000)});
  let value;try{value=await response.json();}catch{value={};}
  if(!response.ok){const e=Error('SMOKE_REQUEST_FAILED');e.status=response.status;
   const code=value.error?.code;e.safeCode=/^[A-Z][A-Z0-9_]{1,80}$/.test(code || '')?code:'SMOKE_REQUEST_FAILED';throw e;}
  return value.data;
 };
 const login=await request('/api/v3/auth/tu-login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({studentId,password})});
 if(!login?.accessToken || login.user?.role!=='STUDENT' || !login.user?.id || !login.user?.studentId)throw Error('SMOKE_IDENTITY_MISMATCH');
 const headers={Authorization:'Bearer '+login.accessToken};
 const session=await request('/api/tu-proxy/api/v3/me',{headers});
 const profile=await request('/api/tu-proxy/api/v3/students/me',{headers});
 if(session?.role!=='STUDENT' || session.user?.id!==login.user.id || session.studentId!==login.user.studentId ||
   profile?.id!==login.user.studentId || profile.student_number!==studentId)throw Error('SMOKE_IDENTITY_MISMATCH');
 return {status:'OWNER_SMOKE_PASSED',login:true,me:true,ownProfile:true,noWriteRequests:true};
}
async function hiddenQuestion(label){
 if(!process.stdin.isTTY)throw Error('INTERACTIVE_TTY_REQUIRED');
 const muted=new Writable({write(_chunk,_encoding,done){done();}}),rl=createInterface({input:process.stdin,output:muted,terminal:true});
 process.stdout.write(label);try{return await rl.question('');}finally{rl.close();process.stdout.write('\n');}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)throw Error('NO_CREDENTIAL_ARGUMENTS_ALLOWED');
  const studentId=(await hiddenQuestion('รหัสนักศึกษา (ซ่อนข้อความ): ')).trim();
  const password=await hiddenQuestion('รหัสผ่าน TU (ซ่อนข้อความ): ');
  if(!/^\d{10}$/.test(studentId) || !password)throw Error('INVALID_INPUT');
  console.log(JSON.stringify(await smoke({studentId,password})));
 }catch(e){
  console.log(JSON.stringify({status:'OWNER_SMOKE_FAILED',code:e.safeCode ||
   (['SMOKE_IDENTITY_MISMATCH','INTERACTIVE_TTY_REQUIRED','INVALID_INPUT','NO_CREDENTIAL_ARGUMENTS_ALLOWED'].includes(e.message)?e.message:'SMOKE_REQUEST_FAILED'),
   ...(Number.isInteger(e.status)?{httpStatus:e.status}:{})}));process.exitCode=1;
 }
}
