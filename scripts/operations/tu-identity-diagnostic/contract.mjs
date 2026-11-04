import {createHmac,timingSafeEqual} from 'node:crypto';
export const T=Object.freeze({account:'130165494095',region:'ap-southeast-2',
 name:'coed-tu-identity-check-20261105',role:'coed-tu-identity-check-role-20261105',
 tag:'tu-identity-readonly-20261105',sid:'CoedTuIdentityReadonly20261105',contract:'coed-tu-identity-readonly-v1',
 host:'database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com',database:'coed',user:'coed_tu_login',
 issuer:'urn:coed:tu-auth:130165494095',subnet:'subnet-0fb8a4985d4e48f03',sg:'sg-01157dbde4cba48ab',
 secret:'arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed/v4/postgres/tu-login-xIzaox'});
export const FUNCTION_ARN=`arn:aws:lambda:${T.region}:${T.account}:function:${T.name}`;
export const exact=(o,keys)=>!!o && typeof o==='object' && !Array.isArray(o) &&
 Object.keys(o).length===keys.length && keys.every(k=>Object.hasOwn(o,k));
export function denied(code){const e=Error(code);e.safeCode=code;return e;}
export function bindTarget(subject,salt){
 if(!/^\d{10}$/.test(subject || '') || !/^[a-f0-9]{64}$/.test(salt || ''))throw denied('DIAG_TARGET_INVALID');
 return createHmac('sha256',Buffer.from(salt,'hex')).update(subject).digest('hex');
}
export function validate(event,context,env,now){
 if(!exact(event,['contract','runId','studentId']) || event.contract!==T.contract ||
  !/^[a-f0-9]{32}$/.test(env.DIAG_RUN_ID || '') || event.runId!==env.DIAG_RUN_ID ||
  env.DIAG_ENABLED!=='true' || env.NODE_ENV!=='production' || env.AWS_REGION!==T.region ||
  env.DIAG_LOGIN_SECRET_ARN!==T.secret || !/^[1-9][0-9]*$/.test(context.functionVersion || '') ||
  context.invokedFunctionArn!==FUNCTION_ARN+':'+context.functionVersion ||
  ['DATABASE_URL','DB_PASSWORD','TU_API_APP_KEY','TU_API_SECRET_ARN','TU_AUTH_PRIVATE_KEY','TU_SIGNING_SECRET_ARN'].some(k=>env[k]))
   throw denied('DIAG_REQUEST_DENIED');
 const expires=Date.parse(env.DIAG_EXPIRES_AT);
 if(!Number.isFinite(expires) || expires<=now || expires>now+1800000)throw denied('DIAG_EXPIRED');
 if(!/^[a-f0-9]{64}$/.test(env.DIAG_TARGET_DIGEST || '') ||
  !timingSafeEqual(Buffer.from(bindTarget(event.studentId,env.DIAG_SALT),'hex'),Buffer.from(env.DIAG_TARGET_DIGEST,'hex')))
   throw denied('DIAG_TARGET_DENIED');
 return event.studentId;
}
export const COUNTS=['tu_links','matching_students','candidate_users','active_links','canonical_students'];
export const BOOLS=['tu_link_active','canonical_user_exists','student_role','account_active',
 'profile_complete','subject_owner_matches','profile_version_valid','active_cognito_link','active_tu_link','active_other_link'];
export const REASONS=['UNLINKED_IDENTITY','DUPLICATE_IDENTITY','IDENTITY_OWNER_MISSING','REVOKED_IDENTITY',
 'DUPLICATE_ACTIVE_IDENTITIES','ACCOUNT_DISABLED','WRONG_ROLE','INCOMPLETE_PROVISIONING','INCOMPLETE_PROFILE',
 'STUDENT_OWNER_MISMATCH','PROFILE_VERSION_INVALID','IDENTITY_CHECKS_PASSED'];
export function safeFlags(row){
 if(!exact(row,[...COUNTS,...BOOLS]) || !COUNTS.every(k=>Number.isInteger(row[k]) && row[k]>=0 && row[k]<=2) ||
  !BOOLS.every(k=>typeof row[k]==='boolean'))throw denied('DIAG_RESULT_INVALID');
 return Object.fromEntries([...COUNTS,...BOOLS].map(k=>[k,row[k]]));
}
export function reason(flags){
 const f=safeFlags(flags);
 if(f.tu_links===0)return 'UNLINKED_IDENTITY';
 if(f.tu_links!==1)return 'DUPLICATE_IDENTITY';
 if(!f.canonical_user_exists)return 'IDENTITY_OWNER_MISSING';
 if(!f.tu_link_active)return 'REVOKED_IDENTITY';
 if(f.active_links!==1)return 'DUPLICATE_ACTIVE_IDENTITIES';
 if(!f.account_active)return 'ACCOUNT_DISABLED';
 if(!f.student_role)return 'WRONG_ROLE';
 if(f.canonical_students!==1)return 'INCOMPLETE_PROVISIONING';
 if(!f.profile_complete)return 'INCOMPLETE_PROFILE';
 if(!f.subject_owner_matches || f.matching_students!==1 || f.candidate_users!==1)return 'STUDENT_OWNER_MISMATCH';
 if(!f.profile_version_valid)return 'PROFILE_VERSION_INVALID';
 return 'IDENTITY_CHECKS_PASSED';
}
export function safeResult(value){
 if(exact(value,['contract','ok','reason','flags']) && value.contract===T.contract && value.ok===true &&
  REASONS.includes(value.reason) && reason(value.flags)===value.reason)return {...value,flags:safeFlags(value.flags)};
 if(exact(value,['contract','ok','code']) && value.contract===T.contract && value.ok===false &&
  ['DIAG_REQUEST_DENIED','DIAG_TARGET_INVALID','DIAG_TARGET_DENIED','DIAG_EXPIRED','DIAG_LIMIT',
   'DIAG_SECRET_UNAVAILABLE','DIAG_SECRET_INVALID','DIAG_CONNECTION_INVALID','DIAG_RESULT_INVALID','DIAG_QUERY_FAILED'].includes(value.code))return value;
 throw denied('DIAG_RESULT_INVALID');
}
