-- Forward-only observed019 correction. Fixed issuer, fixed routines, no row edits.
DO $gate$ BEGIN
 IF current_user<>'postgres'
  OR current_setting('coed.registration_issuer_upgrade',true) IS DISTINCT FROM 'observed019-to020'
  OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='019_tu_student_registration.sql'
   AND checksum='321f90ece54cca0d98f137b50813ca0dea4ba58f36b6166f0088475eae655f85')
  OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='020_tu_registration_issuer_alignment.sql')
 THEN RAISE EXCEPTION 'REGISTRATION_ISSUER_UPGRADE_GATE_REQUIRED'; END IF;
END $gate$;

-- RDS postgres is not a superuser. Membership exists only inside this owner
-- transaction and is revoked before commit; runtime capabilities are unchanged.
GRANT coed_tu_registration_owner TO postgres;
DO $alignment$
DECLARE target regprocedure; definition text; old_literal constant text := '''urn:coed:tu-auth''';
BEGIN
 FOREACH target IN ARRAY ARRAY[
  'public.complete_tu_registration(text,uuid,uuid,jsonb,text,integer,timestamptz)'::regprocedure,
  'public.guard_tu_registration_profile()'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(p.oid) INTO definition FROM pg_proc p
   WHERE p.oid=target AND p.proowner='coed_tu_registration_owner'::regrole AND p.prosecdef;
  IF definition IS NULL OR (length(definition)-length(replace(definition,old_literal,'')))<>length(old_literal)
   OR position('''urn:coed:tu-auth:130165494095''' IN definition)>0
  THEN RAISE EXCEPTION 'REGISTRATION_ISSUER_ROUTINE_DRIFT'; END IF;
  -- CREATE OR REPLACE retains OID, owner, grants and dependent trigger identity.
  EXECUTE replace(definition,old_literal,'''urn:coed:tu-auth:130165494095''');
 END LOOP;
END $alignment$;
REVOKE coed_tu_registration_owner FROM postgres;
