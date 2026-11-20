// Readiness for the separately reviewed 024 capability, not a migration runner.
async function ready(db) {
  return (await db.query(`SELECT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()
    AND c.relname='coordinator_round_schedules' AND k.conname='coordinator_schedule_confirmation_pair' AND k.convalidated)
    AND (SELECT count(*)=2 FROM pg_attribute WHERE attrelid=to_regclass(current_schema() || '.coordinator_round_schedules')
      AND attname IN ('confirmation_opens_at','confirmation_closes_at') AND NOT attnotnull AND NOT attisdropped) AS ready`)).rows[0]?.ready===true;
}
module.exports={ready};
