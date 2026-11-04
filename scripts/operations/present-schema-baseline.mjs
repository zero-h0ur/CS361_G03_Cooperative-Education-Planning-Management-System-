// Local/operator library. No network, credentials or implicit database connection.
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import catalogReader from './tu-preflight/catalog.js';
export const PROFILE='observed-coed-20261104';
export const ARTIFACT_SHA256='16025b7020688601bbf9d3099ab53c0e575cacb6f3e4e58b5e94ae831345d3c1';
const PAYLOAD_SHA256='3e5f1754746fd2b90522e38ffc40b7096f30a99a760593e3bc5dbcb6214baf6d';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function identifier(value){
 if(typeof value!=='string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(value))throw Error('UNSAFE_SCHEMA_IDENTIFIER');
 return '"'+value+'"';
}
export function readObservedBaseline(){
 const file=JSON.parse(readFileSync(new URL('./baselines/coed-present-20261104.json',import.meta.url),'utf8'));
 if(file.encoding!=='deflate-raw+base64' || file.observedArtifactSha256!==ARTIFACT_SHA256 || file.payloadSha256!==PAYLOAD_SHA256)
  throw Error('OBSERVED_BASELINE_INTEGRITY');
 const bytes=inflateRawSync(Buffer.from(file.payload,'base64'),{maxOutputLength:1000000});
 if(sha256(bytes)!==PAYLOAD_SHA256)throw Error('OBSERVED_BASELINE_INTEGRITY');
 const value=JSON.parse(bytes);catalogReader.assertSafeCatalog(value.catalog);return value;
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value && typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function normalizedCatalog(catalog,schema='public'){
 identifier(schema);
 const replace=value=>typeof value==='string'?(value===schema?'__schema__':value.replaceAll('"'+schema+'".','__schema__.').replaceAll(schema+'.','__schema__.'))
  :Array.isArray(value)?value.map(replace):value && typeof value==='object'
   ?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='definition_md5').map(([key,item])=>[key,replace(item)])):value;
 const value=replace(catalog);
 // A separately reviewed SELECT-only issuer role may be provisioned after this
 // upgrade. Its privileges are validated by its own role contract, not hidden
 // here as if they were part of the previously observed runtime profile.
 for(const key of ['table_acl','column_acl','routine_acl'])value[key]=value[key].filter(r=>r.grantee!=='coed_tu_login');
 value.effective_columns=value.effective_columns.filter(r=>r.role==='coed_app');
 // pg_depend was collected with OID ordering; OIDs are not a portable contract.
 value.dependencies.sort((a,b)=>{const left=JSON.stringify(canonical(a)),right=JSON.stringify(canonical(b));return left<right?-1:left>right?1:0;});
 return canonical(value);
}
export const catalogHash=(catalog,schema='public')=>sha256(JSON.stringify(normalizedCatalog(catalog,schema)));
export async function captureCatalog(client){
 return catalogReader.readCatalog(async(sql,values)=>
  (await client.query(sql.replaceAll("'public'",'current_schema()'),values)).rows);
}
