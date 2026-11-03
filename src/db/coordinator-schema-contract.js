const {ServiceUnavailableError}=require('../api/errors');
const required={
  coordinator_reviews:{application_id:['uuid',false],submission_id:['uuid',false],cohort_id:['uuid',false],state:['text',false],version:['integer',false],reason:['text',true],actor_id:['uuid',false],updated_at:['timestamp with time zone',false],source_provenance:['jsonb',true]},
  coordinator_operations:{operation_id:['uuid',false],actor_id:['uuid',false],action:['text',false],resource_id:['uuid',false],request_hash:['character',false],result:['jsonb',false],created_at:['timestamp with time zone',false]},
  phase1_cycle_windows:{cycle_id:['uuid',false],opens_at:['timestamp with time zone',false],closes_at:['timestamp with time zone',false],version:['integer',false],review_opens_at:['timestamp with time zone',true],review_closes_at:['timestamp with time zone',true],confirmation_opens_at:['timestamp with time zone',true],confirmation_closes_at:['timestamp with time zone',true],announced_at:['timestamp with time zone',true],announced_by:['uuid',true],updated_by:['uuid',true],updated_at:['timestamp with time zone',false]}
};
const columns=Object.entries(required).flatMap(([table,cols])=>Object.entries(cols).map(([name,[type,nullable]])=>[table,name,type,nullable?'YES':'NO']));
const values=columns.map((_,i)=>'('+Array.from({length:4},(_,j)=>'$'+(i*4+j+1)+'::text').join(',')+')').join(',');

// Metadata-only, deliberately uncached: a partially rolled out or damaged schema
// must not turn missing tables into empty/mock results. Never runs DDL.
async function assertCoordinatorSchema(db) {
  const error=()=>new ServiceUnavailableError('ระบบยังไม่พร้อมสำหรับงานประสานงาน กรุณาให้ผู้ดูแลอัปเกรด Backend และฐานข้อมูลคู่กัน','COORDINATOR_SCHEMA_UPGRADE_REQUIRED');
  try {
    const result=await db.query(`WITH required(table_name,column_name,data_type,is_nullable) AS (VALUES ${values}) SELECT
      to_regprocedure(format('%I.coordinator_schema_revision()',current_schema())) IS NOT NULL
      AND to_regclass(format('%I.coordinator_reviews',current_schema())) IS NOT NULL
      AND to_regclass(format('%I.coordinator_operations',current_schema())) IS NOT NULL
      AND (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass(format('%I.coordinator_reviews',current_schema())) AND convalidated)=9
      AND (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass(format('%I.coordinator_operations',current_schema())) AND convalidated)=3
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(format('%I.phase1_cycle_windows',current_schema())) AND conname='coordinator_window_order' AND convalidated)
      AND NOT EXISTS(SELECT 1 FROM required r LEFT JOIN information_schema.columns c ON c.table_schema=current_schema()
        AND c.table_name=r.table_name AND c.column_name=r.column_name
        WHERE c.column_name IS NULL OR c.data_type<>r.data_type OR c.is_nullable<>r.is_nullable)
      AND (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
        AND ((tgrelid=to_regclass('coordinator_reviews') AND tgname='coordinator_review_guard')
        OR (tgrelid=to_regclass('phase1_cycle_windows') AND tgname='coordinator_window_guard')
        OR (tgrelid=to_regclass('phase1_reviews') AND tgname='coordinator_review_archive')))=3 AS coordinator_schema_ready`,columns.flat());
    if(result.rows[0]?.coordinator_schema_ready!==true)throw error();
    if((await db.query('SELECT coordinator_schema_revision() AS revision')).rows[0]?.revision!==16)throw error();
  } catch(e) {
    if(['42P01','42703','42883','42501'].includes(e.code))throw error();
    throw e;
  }
}
module.exports={assertCoordinatorSchema};
