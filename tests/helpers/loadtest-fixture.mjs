import { readFileSync } from 'node:fs';
import { fixtureId } from '../../scripts/loadtest/database.mjs';

// Synthetic integration fixtures ONLY. Purinat owns the team's real generator.
export function loadtestFixture(count = 400) {
  const manifest = JSON.parse(readFileSync(new URL('../../scripts/loadtest/manifest.example.json', import.meta.url), 'utf8'));
  const dataset = { contract: 'coed-loadtest-companies-v1', run_id: manifest.run_id, synthetic_only: true,
    companies: Array.from({ length: count }, (_, i) => ({ id: fixtureId(manifest.run_id, `company:${i}`),
      name: `LOADTEST-Company ${String(i + 1).padStart(4, '0')}`,
      location: ['Bangkok', 'Pathum Thani', 'Nonthaburi', 'Remote'][i % 4] })) };
  return { manifest, dataset };
}
