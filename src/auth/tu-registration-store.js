const pg=require('pg');
const {readFileSync}=require('node:fs');
const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
async function connectRegistration(){
 const arn=process.env.TU_REGISTRATION_DB_SECRET_ARN;
 if(process.env.NODE_ENV!=='production' || !/^arn:aws:secretsmanager:ap-southeast-2:130165494095:secret:coed\/v4\/postgres\/tu-registration-[A-Za-z0-9]{6}$/.test(arn || ''))throw Error();
 const sm=new SecretsManagerClient({region:'ap-southeast-2',maxAttempts:1,
  requestHandler:{connectionTimeout:1000,requestTimeout:2000,throwOnRequestTimeout:true}});
 let s;try{s=JSON.parse((await sm.send(new GetSecretValueCommand({SecretId:arn,VersionStage:'AWSCURRENT'}),{abortSignal:AbortSignal.timeout(2500)})).SecretString);}
 finally{sm.destroy();}
 if(s.engine!=='postgres' || s.host!=='database-coed-postgres.cdimw2m6wyll.ap-southeast-2.rds.amazonaws.com' ||
  s.dbname!=='coed' || s.port!==5432 || s.username!=='coed_tu_registration' || !/^[A-Za-z0-9_-]{64}$/.test(s.password || ''))throw Error();
 const db=new pg.Client({host:s.host,port:5432,database:s.dbname,user:s.username,password:s.password,
  ssl:{rejectUnauthorized:true,ca:readFileSync('global-bundle.pem','utf8')},connectionTimeoutMillis:1200,query_timeout:2500,
  options:'-c statement_timeout=2000 -c lock_timeout=500 -c search_path=pg_catalog'});
 db.on('error',()=>{});try{await db.connect();return db;}catch(e){await db.end().catch(()=>{});throw e;}
}
module.exports={connectRegistration};
