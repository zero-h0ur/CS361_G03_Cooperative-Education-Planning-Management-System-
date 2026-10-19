"""Opt-in SQL tests in a NEW no-network, no-published-port, tmpfs-only container."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
PROVISION = (ROOT / 'scripts/operations/provision-smoke83-fixtures.sql').read_text()
CHECKPOINT_SPEC = importlib.util.spec_from_file_location('checkpoint83_sql', ROOT / 'scripts/operations/checkpoint-smoke83-db.py')
CHECKPOINT = importlib.util.module_from_spec(CHECKPOINT_SPEC)
CHECKPOINT_SPEC.loader.exec_module(CHECKPOINT)
FAKE_SUB = '00000000-0000-4000-8000-000000000083'
BASE = '''
CREATE TABLE schema_migrations(version text primary key, checksum text not null);
INSERT INTO schema_migrations VALUES('002_v3_identity_student_plan_assignment_audit.sql',
'abf94231966248045543d736e3ab745359693c93f082317990489902e1e7484c');
INSERT INTO users(id,role) VALUES
('90000000-0000-4000-8000-000000000001','SYSTEM'),
('90000000-0000-4000-8000-000000000002','STUDENT'),
('90000000-0000-4000-8000-000000000003','STAFF');
INSERT INTO companies(id,name,source,visibility,data_status) VALUES
('90000000-0000-4000-8000-000000000004','Local synthetic company','local-test','public','mock');
INSERT INTO positions(id,company_id,title,source,visibility,data_status) VALUES
('90000000-0000-4000-8000-000000000005','90000000-0000-4000-8000-000000000004','Local synthetic job','local-test','public','mock');
INSERT INTO rounds(id,name,academic_year,semester,status,end_date,source,visibility,data_status) VALUES
('90000000-0000-4000-8000-000000000006','Local existing round',2569,1,'OPEN',CURRENT_TIMESTAMP+interval '30 days','local-test','public','mock');
INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,
department,program,major,academic_year,enrollment_status,source,visibility,data_status) VALUES
('90000000-0000-4000-8000-000000000007','90000000-0000-4000-8000-000000000002','local-only',
'TESTPR730001','Local synthetic original','local@student.example.com','CPE','ISNE','CPE',2569,'ACTIVE','local-test','private','mock');
INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,notes,source,visibility,data_status) VALUES
('90000000-0000-4000-8000-000000000008','90000000-0000-4000-8000-000000000007',
'90000000-0000-4000-8000-000000000006','90000000-0000-4000-8000-000000000004',
'90000000-0000-4000-8000-000000000005','Original must remain unchanged','local-test','private','mock');
INSERT INTO staff_scopes(id,staff_id,department,program,academic_year,status) VALUES
('90000000-0000-4000-8000-000000000009','90000000-0000-4000-8000-000000000003','CPE','ISNE',2569,'ACTIVE');
'''


@unittest.skipUnless(os.environ.get('CO_ED_TEST_DOCKER_PROVISION') == '1', 'Opt in to isolated Docker SQL tests')
class ProvisionPostgresTest(unittest.TestCase):
    container = None

    @classmethod
    def command(cls, args, **kwargs):
        return subprocess.run(args, text=True, capture_output=True, timeout=45, **kwargs)

    @classmethod
    def setUpClass(cls):
        run = cls.command(['docker', 'run', '--rm', '-d', '--network', 'none',
                           '--name', 'coed-smoke83-sql-' + uuid.uuid4().hex[:10],
                           '--label', 'coed.smoke83.test-only=true',
                           '--tmpfs', '/var/lib/postgresql/data:rw',
                           '-e', 'POSTGRES_PASSWORD=LOCAL-SYNTHETIC-ONLY-83',
                           '-e', 'POSTGRES_DB=coed', 'postgres:16-alpine'])
        if run.returncode != 0:
            raise RuntimeError('Could not create isolated local PostgreSQL test container')
        cls.container = run.stdout.strip()
        try:
            for _ in range(30):
                # The image's temporary init server accepts Unix-socket clients
                # before initialization is finished. TCP readiness inside this
                # no-network container waits for the final PostgreSQL server.
                ready = cls.command(['docker', 'exec', cls.container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'coed'])
                if ready.returncode == 0:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError('Local isolated PostgreSQL did not become ready')
        except BaseException:
            cls.command(['docker', 'stop', cls.container]); cls.container = None
            raise

    @classmethod
    def tearDownClass(cls):
        if cls.container:
            cls.command(['docker', 'stop', cls.container])  # --rm removes only our tmpfs test container.

    def sql(self, text, require_success=True):
        result = self.command(['docker', 'exec', '-i', self.container, 'psql', '-U', 'postgres',
                               '-d', 'coed', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=text)
        if require_success:
            self.assertEqual(result.returncode, 0, 'Isolated SQL failed: ' + result.stderr)
        return result

    def setUp(self):
        # This exact container was created by this class, has no network or host
        # ports, and holds only disposable synthetic test data. Never use host DBs.
        inspect = self.command(['docker', 'inspect', self.container])
        config = json.loads(inspect.stdout)[0]
        self.assertEqual(config['Config']['Labels'].get('coed.smoke83.test-only'), 'true')
        self.assertEqual(config['HostConfig']['NetworkMode'], 'none')
        self.assertFalse(config['HostConfig']['PortBindings'])
        reset = self.command(['docker', 'exec', self.container, 'dropdb', '-U', 'postgres', '--if-exists', 'coed'])
        self.assertEqual(reset.returncode, 0, 'Disposable local DB reset failed: ' + reset.stderr)
        self.assertEqual(self.command(['docker', 'exec', self.container, 'createdb', '-U', 'postgres', 'coed']).returncode, 0)
        migrations = '\n'.join((ROOT / 'src/db/migrations' / name).read_text() for name in
                                ['001_initial_schema.sql', '002_v3_identity_student_plan_assignment_audit.sql'])
        self.sql(migrations + BASE)

    def provision(self, subject=FAKE_SUB, require_success=True):
        result = self.sql(PROVISION.replace('__ADVISOR_SUB__', subject), require_success)
        if result.returncode:
            return result
        return json.loads([line for line in result.stdout.splitlines() if line.startswith('{')][-1])

    def fingerprint(self):
        return self.sql("SELECT md5(jsonb_build_object(" + ','.join(
            "'%s',(SELECT jsonb_agg(to_jsonb(t) ORDER BY %s) FROM %s t)" % (table, key, table)
            for table, key in [('users','id'),('students','id'),('plans','id'),('rounds','id'),
                              ('external_identity_links','id'),('staff_scopes','id'),
                              ('advisor_assignments','id'),('audit_events','event_id')]
        ) + ")::text);").stdout.strip()

    def test_create_scoped_fixtures_and_preserve_original_demo(self):
        result = self.provision()
        self.assertEqual(result['AssignedStudents'], 3)
        self.assertEqual(result['PrivateFixtureStudents'], 4)
        self.assertTrue(result['ExistingRowsUnchanged'])
        self.assertFalse(result['DemoPlansTouched'])
        self.assertEqual([item['State'] for item in result['FixturePlanStates']],
                         ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'DRAFT'])
        self.assertEqual(self.sql("SELECT notes FROM plans WHERE source='local-test';").stdout.strip(), 'Original must remain unchanged')
        self.assertEqual(self.sql("SELECT count(*) FROM advisor_assignments WHERE status='ACTIVE' AND effective_to <= created_at+interval '7 days';").stdout.strip(), '3')

    def test_readonly_checkpoint_runs_real_sql_without_changing_rows(self):
        self.provision()
        before = self.fingerprint()
        first = json.loads(self.sql(CHECKPOINT.SQL).stdout)
        CHECKPOINT.validate_snapshot(first, initial=True)
        second = json.loads(self.sql(CHECKPOINT.SQL).stdout)
        self.assertEqual(first, second)
        self.assertEqual(self.fingerprint(), before)
        self.assertTrue(first['guards']['readOnly'])
        self.assertEqual(len(first['tables']), 11)

    def test_readonly_checkpoint_detects_demo_content_change_without_version_bump(self):
        self.provision()
        before = json.loads(self.sql(CHECKPOINT.SQL).stdout)
        self.sql("UPDATE plans SET notes='LOCAL UNIT CONTENT CHANGE' WHERE id='90000000-0000-4000-8000-000000000008';")
        after = json.loads(self.sql(CHECKPOINT.SQL).stdout)
        self.assertNotEqual(before['tables']['plans']['fingerprint'], after['tables']['plans']['fingerprint'])
        self.assertEqual(before['tables']['plans']['rows'], after['tables']['plans']['rows'])
        self.assertEqual(before['fixturePlans'], after['fixturePlans'])

    def test_rerun_does_not_duplicate_extend_or_change_any_row(self):
        self.provision(); before = self.fingerprint(); self.provision()
        self.assertEqual(self.fingerprint(), before)

    def test_different_subject_is_refused_without_partial_writes(self):
        self.provision(); before = self.fingerprint()
        result = self.provision('00000000-0000-4000-8000-000000000084', False)
        self.assertNotEqual(result.returncode, 0); self.assertIn('P8306', result.stderr)
        self.assertEqual(self.fingerprint(), before)

    def test_reserved_user_collision_cannot_upgrade_a_role(self):
        self.sql("INSERT INTO users(id,role) VALUES('83000000-0000-4000-8000-000000000001','STUDENT');")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8305', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_late_plan_collision_rolls_back_users_identity_round_and_students(self):
        self.sql("""INSERT INTO plans(id,student_id,cycle_id,status,source,visibility,data_status)
        VALUES('83000000-0000-4000-8000-000000000033','90000000-0000-4000-8000-000000000007',
        '90000000-0000-4000-8000-000000000006','CANCELLED','unexpected-collision','private','mock');""")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8309', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_disabled_fixture_user_is_not_reactivated(self):
        self.provision(); self.sql("UPDATE users SET account_status='DISABLED' WHERE id='83000000-0000-4000-8000-000000000001';")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8305', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_expired_assignment_is_not_renewed(self):
        self.provision(); self.sql("UPDATE advisor_assignments SET effective_from=CURRENT_TIMESTAMP-interval '2 days',effective_to=CURRENT_TIMESTAMP-interval '1 day' WHERE id='83000000-0000-4000-8000-000000000014';")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8310', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_extra_assignment_cannot_expose_demo(self):
        self.provision(); self.sql("""INSERT INTO advisor_assignments(id,advisor_id,student_id,academic_year,semester,effective_from,effective_to,assigned_by)
        VALUES('83000000-0000-4000-8000-000000000099','83000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000007',2569,1,CURRENT_TIMESTAMP-interval '1 minute',
        CURRENT_TIMESTAMP+interval '1 day','90000000-0000-4000-8000-000000000001');""")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8310', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_existing_fixture_state_and_version_are_never_reset(self):
        self.provision(); self.sql("UPDATE plans SET status='SUBMITTED',version=2 WHERE id='83000000-0000-4000-8000-000000000013';")
        before = self.fingerprint(); result = self.provision()
        self.assertEqual(result['FixturePlanStates'][0]['Version'], 2)
        self.assertEqual(result['FixturePlanStates'][0]['State'], 'SUBMITTED')
        self.assertEqual(self.fingerprint(), before)

    def test_changed_scope_partition_stops_before_new_writes(self):
        self.sql("UPDATE staff_scopes SET status='INACTIVE';")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8304', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_unexpected_trigger_side_effect_on_demo_is_caught_and_rolled_back(self):
        self.sql("""CREATE FUNCTION local_smoke83_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id='83000000-0000-4000-8000-000000000001'::uuid THEN
            UPDATE plans SET notes='UNEXPECTED TEST-ONLY SIDE EFFECT' WHERE source='local-test';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER local_test_only AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION local_smoke83_side_effect();""")
        before = self.fingerprint(); result = self.provision(require_success=False)
        self.assertIn('P8311', result.stderr); self.assertEqual(self.fingerprint(), before)

    def test_wrong_operator_is_refused_before_data_writes(self):
        self.sql('CREATE ROLE local_smoke83_wrong_operator; GRANT USAGE ON SCHEMA public TO local_smoke83_wrong_operator;')
        before = self.fingerprint()
        result = self.sql('SET ROLE local_smoke83_wrong_operator;\n' + PROVISION.replace('__ADVISOR_SUB__', FAKE_SUB), False)
        self.assertIn('P8301', result.stderr); self.assertEqual(self.fingerprint(), before)


if __name__ == '__main__':
    unittest.main()
