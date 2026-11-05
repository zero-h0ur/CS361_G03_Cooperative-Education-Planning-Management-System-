// Local comparison of metadata artifacts; no AWS client or database connection.
import {readFileSync} from 'node:fs';
import {readReviewedMigrations} from '../reviewed-migrations.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function compareMetadata(actual,reference){
  if(actual?.ok!==true || actual.contract!=='coed-tu-preflight-v1' || actual.data?.guards?.read_only!==true)
    throw Error('Only guarded reader output may be compared');
  const local=readReviewedMigrations(),data=actual.data;
  const history={exact:[],sameBytesDifferentRecordedName:[],unreviewedExternal:[],localNamesAbsent:[]};
  for(const row of data.migrations){
    const named=local.find(r=>r.name===row.version),same=local.find(r=>r.checksum===row.checksum);
    if(named?.checksum===row.checksum)history.exact.push(row.version);
    else if(same)history.sameBytesDifferentRecordedName.push({recorded:row.version,local:same.name,checksum:row.checksum});
    else history.unreviewedExternal.push(row);
  }
  history.localNamesAbsent=local.filter(r=>!data.migrations.some(m=>m.version===r.name)).map(r=>r.name);
  const result={history,missingTables:data.missingTables,loginRolePresent:data.roles.some(r=>r.role==='coed_tu_login'),
    executableSecurityDefiners:data.routines.filter(r=>r.security_definer && r.runtime_can_execute),
    identity:data.identity.status,columnDifferences:[],extraProductionColumns:[],extraProductionTriggers:[],differentRoutineFingerprints:[],tableGrantDifferences:[]};
  if(reference){
    for(const expected of reference.columns){
      // The isolated direct-SQL test constructs runner bookkeeping itself;
      // its schema_migrations shape is not an application migration contract.
      if(expected.table_name==='schema_migrations')continue;
      if(data.missingTables.includes(expected.table_name))continue;
      const current=data.columns.find(c=>c.table_name===expected.table_name && c.name===expected.name);
      if(!current || current.type!==expected.type || current.not_null!==expected.not_null)
        result.columnDifferences.push({table:expected.table_name,column:expected.name,expected:expected.type,actual:current?.type || 'MISSING',nullabilityDiff:current?.not_null!==expected.not_null});
    }
    result.extraProductionTriggers=data.triggers.filter(t=>!reference.triggers.some(x=>x.table_name===t.table_name && x.name===t.name));
    result.extraProductionColumns=data.columns.filter(c=>c.table_name!=='schema_migrations' && reference.tables.some(t=>t.name===c.table_name) &&
      !reference.columns.some(x=>x.table_name===c.table_name && x.name===c.name));
    for(const p of data.privileges){
      const expected=reference.privileges.find(x=>x.role===p.role && x.table_name===p.table_name);if(!expected)continue;
      for(const key of ['select_table','insert_table','update_table','delete_table','truncate_table'])
        if(p[key]!==expected[key])result.tableGrantDifferences.push({role:p.role,table:p.table_name,privilege:key,actual:p[key],local:expected[key]});
    }
    result.differentRoutineFingerprints=data.routines.flatMap(r=>{
      const expected=reference.routines.find(x=>x.name===r.name && x.arguments===r.arguments);
      return expected && expected.definition_md5!==r.definition_md5?[{name:r.name,actual:r.definition_md5,local:expected.definition_md5}]:[];
    });
  }
  return result;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const actual=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const reference=process.argv[3]?JSON.parse(readFileSync(process.argv[3],'utf8')):undefined;
  console.log(JSON.stringify(compareMetadata(actual,reference),null,2));
}
