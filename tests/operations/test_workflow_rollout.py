import hashlib
import os
from pathlib import Path
import re
import subprocess
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get('CO_ED_TEST_DOCKER_PROVISION') == '1', 'Explicit disposable Docker integration required')
class WorkflowRolloutTests(unittest.TestCase):
    def test_exact_operator_psql_dry_run_apply_reapply_and_history_guard(self):
        container = subprocess.check_output(['docker', 'run', '--rm', '-d', '--tmpfs', '/var/lib/postgresql/data:rw',
                                             '--label', 'coed.workflow135.rollout-test=true', '-e', 'POSTGRES_DB=coed_v3_test',
                                             '-e', 'POSTGRES_PASSWORD=LOCAL_ONLY_ROLLOUT_135', 'postgres:16-alpine'], text=True).strip()
        self.assertRegex(container, r'^[0-9a-f]{64}$')
        def psql(sql, apply=False):
            return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'coed_v3_test', '-X',
                                   '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'apply=' + str(apply).lower(), '-f', '-'],
                                  input=sql, text=True, capture_output=True, timeout=40)
        try:
            for _ in range(60):
                if subprocess.run(['docker', 'exec', '-e', 'PGPASSWORD=LOCAL_ONLY_ROLLOUT_135', container,
                                   'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'coed_v3_test', '-At', '-c', 'SELECT 1'], capture_output=True).returncode == 0:
                    break
                time.sleep(0.2)
            setup = ['CREATE ROLE coed_app NOLOGIN;', 'CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,checksum TEXT,applied_at timestamptz DEFAULT CURRENT_TIMESTAMP);']
            for file in sorted((ROOT / 'src/db/migrations').glob('00[1-3]_*.sql')):
                sql = file.read_text()
                setup.extend([sql, "INSERT INTO schema_migrations(version,checksum) VALUES ('" + file.name + "','" + hashlib.sha256(sql.encode()).hexdigest() + "');"])
            setup.append("INSERT INTO users(id,role) VALUES('10000000-0000-4000-8000-000000000135','ADMIN');")
            initial = psql('\n'.join(setup)); self.assertEqual(initial.returncode, 0, initial.stderr)
            sql = subprocess.check_output(['node', '--input-type=module', '-e',
                "import {workflowMigrationSQL} from './scripts/operations/prepare-workflow-release.mjs'; process.stdout.write(workflowMigrationSQL());"], cwd=ROOT, text=True)
            dry = psql(sql); self.assertEqual(dry.returncode, 0, dry.stderr)
            self.assertEqual(psql('SELECT count(*) FROM schema_migrations;').stdout.strip(), '3')
            applied = psql(sql, True); self.assertEqual(applied.returncode, 0, applied.stderr)
            self.assertIn('"ExistingRowsPreserved" : true', applied.stdout)
            self.assertIn('"RuntimeRoleMutation" : false', applied.stdout)
            self.assertEqual(psql('SELECT count(*) FROM schema_migrations;').stdout.strip(), '8')
            repeat = psql(sql, True); self.assertEqual(repeat.returncode, 0, repeat.stderr)
            self.assertEqual(psql('SELECT role,version FROM users;').stdout.strip(), 'ADMIN|1')
            self.assertEqual(psql("INSERT INTO schema_migrations(version,checksum) VALUES('999_unknown.sql',repeat('a',64));").returncode, 0)
            denied = psql(sql, True)
            self.assertNotEqual(denied.returncode, 0)
            self.assertIn('Migration history mismatch', denied.stderr)
        finally:
            label = subprocess.check_output(['docker', 'inspect', '--format', '{{ index .Config.Labels "coed.workflow135.rollout-test" }}', container], text=True).strip()
            if label == 'true' and re.fullmatch('[0-9a-f]{64}', container):
                subprocess.run(['docker', 'stop', '--time', '3', container], capture_output=True, timeout=15)


if __name__ == '__main__': unittest.main()
