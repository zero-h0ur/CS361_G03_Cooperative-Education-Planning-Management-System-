// Local/CI tests only. This runner has no AWS client or production Apply path.
import {spawnSync} from 'node:child_process';
const value=process.env.PRESENT_SCHEMA_TEST_DATABASE_URL;
if(!value || process.env.NODE_ENV!=='test' || process.env.PRESENT_SCHEMA_DISPOSABLE!=='true')
 throw Error('Explicit disposable schema test configuration required');
const target=new URL(value);
if(target.hostname!=='127.0.0.1' || target.port!=='55440' || target.pathname!=='/coed_present_test' || value===process.env.DATABASE_URL)
 throw Error('Disposable localhost55440/coed_present_test required');
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',
 'tests/present-schema-upgrade.test.mjs','tests/present-schema-upgrade-db.test.mjs','tests/tu-student-coordinator-delivery.test.mjs'],{
 cwd:new URL('../../',import.meta.url),stdio:'inherit',windowsHide:true,
 env:{...process.env,TU_DELIVERY_TEST_BASELINE:'observed-current',TU_DELIVERY_TEST_DATABASE_URL:value}
});
process.exitCode=result.status===null?1:result.status;
