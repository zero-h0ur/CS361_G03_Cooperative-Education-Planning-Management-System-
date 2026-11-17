import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_COMPANY_COUNT = 400;
export const MIN_COMPANY_COUNT = 300;
export const MAX_COMPANY_COUNT = 500;
export const DEFAULT_POSITIONS_PER_COMPANY = 2;
export const DEFAULT_SOURCE = 'loadtest-synthetic-2569';
export const DEFAULT_CATALOG_KEY = 'loadtest-synthetic-2569';
export const DEFAULT_UPDATED_AT = '2026-11-18T00:00:00Z';

// Mirrors the 103-company distribution in data/companies.json (weighted sum = 103).
export const LOCATION_WEIGHTS = Object.freeze([
  { location: 'กรุงเทพฯ', weight: 77, addressPrefix: '99/1 ถนนสีลม เขตบางรัก กรุงเทพมหานคร 10500' },
  { location: 'นนทบุรี', weight: 8, addressPrefix: '88/2 ถนนแจ้งวัฒนะ อำเภอปากเกร็ด จังหวัดนนทบุรี 11120' },
  { location: 'ปทุมธานี', weight: 7, addressPrefix: '111 หมู่ 9 ถนนพหลโยธิน อำเภอคลองหลวง จังหวัดปทุมธานี 12120' },
  { location: null, weight: 4, addressPrefix: '112 ถนนพหลโยธิน ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120' },
  { location: 'สมุทรปราการ', weight: 2, addressPrefix: '45/7 ถนนเทพารักษ์ อำเภอบางพลี จังหวัดสมุทรปราการ 10540' },
  { location: 'ระยอง', weight: 1, addressPrefix: '234 นิคมอุตสาหกรรมมาบตาพุด อำเภอเมืองระยอง จังหวัดระยอง 21150' },
  { location: 'ภูเก็ต', weight: 1, addressPrefix: '56/3 ถนนเทพกระษัตรี อำเภอเมืองภูเก็ต จังหวัดภูเก็ต 83000' },
  { location: 'สมุทรสาคร', weight: 1, addressPrefix: '78/4 ถนนพระราม 2 อำเภอเมืองสมุทรสาคร จังหวัดสมุทรสาคร 74000' },
  { location: 'พระนครศรีอยุธยา', weight: 1, addressPrefix: '101 นิคมอุตสาหกรรมบางปะอิน อำเภอบางปะอิน จังหวัดพระนครศรีอยุธยา 13160' },
  { location: 'เชียงใหม่', weight: 1, addressPrefix: '188 ถนนนิมมานเหมินท์ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200' }
]);

const DOMAIN_TOPICS = Object.freeze([
  { keyword: 'Cloud', label: 'คลาวด์แพลตฟอร์ม' },
  { keyword: 'Data', label: 'ข้อมูลและวิเคราะห์ธุรกิจ' },
  { keyword: 'AI', label: 'ปัญญาประดิษฐ์และแมชชีนเลิร์นนิง' },
  { keyword: 'Software', label: 'วิศวกรรมซอฟต์แวร์' },
  { keyword: 'FinTech', label: 'เทคโนโลยีการเงินดิจิทัล' },
  { keyword: 'Cyber', label: 'ความมั่นคงปลอดภัยไซเบอร์' },
  { keyword: 'Web', label: 'เว็บแอปพลิเคชัน' },
  { keyword: 'Mobile', label: 'แอปพลิเคชันมือถือ' },
  { keyword: 'DevOps', label: 'โครงสร้างพื้นฐานและออโตเมชัน' },
  { keyword: 'Network', label: 'ระบบเครือข่ายองค์กร' }
]);

const POSITION_TEMPLATES = Object.freeze([
  { title: 'Software Engineer Intern', quota: '2 คน', duration: '4 เดือน' },
  { title: 'Data & Cloud Intern', quota: '2 คน', duration: '6 เดือน' },
  { title: 'Backend Developer Intern', quota: '1 คน', duration: '4 เดือน' },
  { title: 'Frontend Developer Intern', quota: '2 คน', duration: '4 เดือน' },
  { title: 'QA & DevOps Intern', quota: '1 คน', duration: '6 เดือน' }
]);

/** Validates synthetic company generation bounds. */
export function validateGeneratorOptions({
  count = DEFAULT_COMPANY_COUNT,
  positionsPerCompany = DEFAULT_POSITIONS_PER_COMPANY
} = {}) {
  if (!Number.isInteger(count) || count < MIN_COMPANY_COUNT || count > MAX_COMPANY_COUNT) {
    throw new RangeError(`Company count must be an integer between ${MIN_COMPANY_COUNT} and ${MAX_COMPANY_COUNT}.`);
  }
  if (!Number.isInteger(positionsPerCompany) || positionsPerCompany < 0 || positionsPerCompany > 5) {
    throw new RangeError('positionsPerCompany must be an integer between 0 and 5.');
  }
}

/** Deterministic RFC-4122 v4-compatible UUID for synthetic loadtest companies. */
export function companyIdForIndex(index) {
  if (!Number.isInteger(index) || index < 1 || index > 999999) {
    throw new RangeError('Company index must be a positive integer.');
  }
  return `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/** Deterministic RFC-4122 v4-compatible UUID for synthetic loadtest positions. */
export function positionIdForIndex(companyIndex, slot) {
  if (!Number.isInteger(companyIndex) || companyIndex < 1 || !Number.isInteger(slot) || slot < 1) {
    throw new RangeError('Company index and position slot must be positive integers.');
  }
  return `51000000-0000-4000-8000-${String(companyIndex).padStart(8, '0')}${String(slot).padStart(4, '0')}`;
}

/** Computes largest-remainder counts matching data/companies.json location proportions. */
export function buildLocationCounts(totalCount) {
  validateGeneratorOptions({ count: totalCount, positionsPerCompany: 0 });
  const weightSum = LOCATION_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  const allocations = LOCATION_WEIGHTS.map((entry, idx) => {
    const exact = (totalCount * entry.weight) / weightSum;
    const base = Math.floor(exact);
    return { idx, entry, count: base, remainder: exact - base };
  });
  let remaining = totalCount - allocations.reduce((sum, item) => sum + item.count, 0);
  for (const item of [...allocations].sort((a, b) => b.remainder - a.remainder || a.idx - b.idx)) {
    if (remaining <= 0) break;
    item.count += 1;
    remaining -= 1;
  }
  return allocations;
}

/** Spreads weighted locations evenly across paginated pages instead of clustering per province. */
export function buildLocationSchedule(totalCount) {
  const buckets = buildLocationCounts(totalCount).map(item => ({
    entry: item.entry,
    remaining: item.count,
    credit: 0
  }));
  const schedule = [];
  for (let i = 0; i < totalCount; i += 1) {
    let best = null;
    for (const bucket of buckets) {
      if (bucket.remaining <= 0) continue;
      bucket.credit += bucket.remaining;
      if (!best || bucket.credit > best.credit) best = bucket;
    }
    best.credit -= totalCount;
    best.remaining -= 1;
    schedule.push(best.entry);
  }
  return schedule;
}

/** Generates deterministic synthetic company and position records matching migrations 001 + 003. */
export function generateSyntheticDataset({
  count = DEFAULT_COMPANY_COUNT,
  positionsPerCompany = DEFAULT_POSITIONS_PER_COMPANY,
  catalogKey = DEFAULT_CATALOG_KEY,
  source = DEFAULT_SOURCE,
  updatedAt = DEFAULT_UPDATED_AT
} = {}) {
  validateGeneratorOptions({ count, positionsPerCompany });
  const locations = buildLocationSchedule(count);
  const companies = [];
  const positions = [];

  for (let idx = 1; idx <= count; idx += 1) {
    const numLabel = String(idx).padStart(4, '0');
    const code = `LT${numLabel}`;
    const topic = DOMAIN_TOPICS[(idx - 1) % DOMAIN_TOPICS.length];
    const loc = locations[idx - 1];
    const id = companyIdForIndex(idx);

    companies.push({
      id,
      directory_code: code,
      name: `LOADTEST ${topic.keyword} บริษัท สหกิจศึกษา ${numLabel} จำกัด`,
      description: `ข้อมูลสังเคราะห์สำหรับทดสอบโหลดด้าน${topic.label} (${topic.keyword}) ลำดับ ${numLabel}`,
      website_url: `https://loadtest-${numLabel}.example.invalid`,
      address: `${loc.addressPrefix} [LOADTEST-${numLabel}]`,
      location: loc.location,
      logo_path: null,
      source,
      updated_at: updatedAt,
      visibility: 'public',
      data_status: 'mock',
      catalog_key: catalogKey
    });

    for (let slot = 1; slot <= positionsPerCompany; slot += 1) {
      const tpl = POSITION_TEMPLATES[(idx + slot - 2) % POSITION_TEMPLATES.length];
      positions.push({
        id: positionIdForIndex(idx, slot),
        company_id: id,
        title: `LOADTEST ${tpl.title} (${topic.keyword})`,
        description: `ตำแหน่งงานสังเคราะห์สำหรับทดสอบโหลด ${tpl.title} รหัสบริษัท ${code}`,
        location: loc.location,
        announcement_ref: `LT-2569-${numLabel}-${slot}`,
        quota_text: tpl.quota,
        duration_text: tpl.duration,
        academic_year: 2569,
        source,
        updated_at: updatedAt,
        visibility: 'public',
        data_status: 'mock'
      });
    }
  }

  return { companies, positions };
}

/** Formats a JavaScript primitive safely into a PostgreSQL literal. */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new TypeError(`Expected integer SQL literal, got: ${value}`);
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Generates idempotent transactional SQL targeting only the isolated loadtest database. */
export function buildLoadtestCompaniesSql(options = {}) {
  const dataset = generateSyntheticDataset(options);
  const source = options.source ?? DEFAULT_SOURCE;
  const companyChunks = chunkArray(dataset.companies, 100).map(chunk => {
    const rows = chunk.map(c =>
      `  (${[
        `${sqlLiteral(c.id)}::uuid`, sqlLiteral(c.directory_code), sqlLiteral(c.name),
        sqlLiteral(c.description), sqlLiteral(c.website_url), sqlLiteral(c.address),
        sqlLiteral(c.location), sqlLiteral(c.logo_path), sqlLiteral(c.source),
        `${sqlLiteral(c.updated_at)}::timestamptz`, sqlLiteral(c.visibility),
        sqlLiteral(c.data_status), sqlLiteral(c.catalog_key)
      ].join(', ')})`
    ).join(',\n');
    return `INSERT INTO companies (
  id, directory_code, name, description, website_url, address, location,
  logo_path, source, updated_at, visibility, data_status, catalog_key
) VALUES
${rows}
ON CONFLICT (id) DO UPDATE SET
  directory_code = EXCLUDED.directory_code,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  website_url = EXCLUDED.website_url,
  address = EXCLUDED.address,
  location = EXCLUDED.location,
  logo_path = EXCLUDED.logo_path,
  source = EXCLUDED.source,
  updated_at = EXCLUDED.updated_at,
  visibility = EXCLUDED.visibility,
  data_status = EXCLUDED.data_status,
  catalog_key = EXCLUDED.catalog_key;`;
  });

  const positionChunks = chunkArray(dataset.positions, 150).map(chunk => {
    const rows = chunk.map(p =>
      `  (${[
        `${sqlLiteral(p.id)}::uuid`, `${sqlLiteral(p.company_id)}::uuid`, sqlLiteral(p.title),
        sqlLiteral(p.description), sqlLiteral(p.location), sqlLiteral(p.announcement_ref),
        sqlLiteral(p.quota_text), sqlLiteral(p.duration_text), sqlLiteral(p.academic_year),
        sqlLiteral(p.source), `${sqlLiteral(p.updated_at)}::timestamptz`,
        sqlLiteral(p.visibility), sqlLiteral(p.data_status)
      ].join(', ')})`
    ).join(',\n');
    return `INSERT INTO positions (
  id, company_id, title, description, location, announcement_ref,
  quota_text, duration_text, academic_year, source, updated_at, visibility, data_status
) VALUES
${rows}
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  location = EXCLUDED.location,
  announcement_ref = EXCLUDED.announcement_ref,
  quota_text = EXCLUDED.quota_text,
  duration_text = EXCLUDED.duration_text,
  academic_year = EXCLUDED.academic_year,
  source = EXCLUDED.source,
  updated_at = EXCLUDED.updated_at,
  visibility = EXCLUDED.visibility,
  data_status = EXCLUDED.data_status;`;
  });

  const sections = [
    `-- Synthetic load-test companies (${dataset.companies.length}) and positions (${dataset.positions.length}).`,
    `-- TARGET ONLY the isolated loadtest PostgreSQL database (coed-loadtest-db). NEVER run against production RDS.`,
    `\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL lock_timeout = '10s';\nSET LOCAL statement_timeout = '30s';`,
    `DO $guard$\nBEGIN\n  IF to_regclass('public.companies') IS NULL OR to_regclass('public.positions') IS NULL THEN\n    RAISE EXCEPTION 'Required directory tables (companies, positions) do not exist. Run migrations first.';\n  END IF;\nEND $guard$;`,
    ...companyChunks,
    ...positionChunks,
    `SELECT\n  (SELECT count(*)::int FROM companies WHERE source = ${sqlLiteral(source)}) AS loadtest_companies,\n  (SELECT count(*)::int FROM positions WHERE source = ${sqlLiteral(source)}) AS loadtest_positions,\n  (SELECT count(*)::int FROM companies WHERE visibility = 'public' AND (catalog_key IS NOT NULL OR NOT EXISTS (\n    SELECT 1 FROM companies cat WHERE cat.catalog_key IS NOT NULL AND cat.visibility = 'public'\n  ))) AS visible_directory_companies;\nCOMMIT;`
  ];

  return `${sections.join('\n\n')}\n`;
}

function summarizeLocations(companies) {
  const counts = {};
  for (const c of companies) {
    const key = c.location ?? 'null';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const opts = {
    count: DEFAULT_COMPANY_COUNT,
    positionsPerCompany: DEFAULT_POSITIONS_PER_COMPANY,
    catalogKey: DEFAULT_CATALOG_KEY,
    out: null,
    stats: false,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--stats') opts.stats = true;
    else if (arg === '--count') opts.count = Number(argv[++i]);
    else if (arg === '--positions') opts.positionsPerCompany = Number(argv[++i]);
    else if (arg === '--out' || arg === '-o') opts.out = argv[++i] || '';
    else if (arg === '--catalog-key') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--catalog-key requires a value (or "null").');
      opts.catalogKey = value.toLowerCase() === 'null' ? null : value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  validateGeneratorOptions(opts);
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node scripts/loadtest/generate-companies.mjs [options]
Options:
  --count <300..500>      Number of synthetic companies (default: 400)
  --positions <0..5>      Positions per company (default: 2)
  --catalog-key <key|null> Value for catalog_key column (default: loadtest-synthetic-2569)
  -o, --out <path>        Write UTF-8 SQL file to path instead of stdout
  --stats                 Print JSON location distribution summary instead of SQL`);
    process.exit(0);
  }
  if (opts.stats) {
    const dataset = generateSyntheticDataset(opts);
    console.log(JSON.stringify({
      companies: dataset.companies.length,
      positions: dataset.positions.length,
      catalogKey: opts.catalogKey,
      locations: summarizeLocations(dataset.companies)
    }, null, 2));
  } else {
    const sql = buildLoadtestCompaniesSql(opts);
    if (opts.out) {
      const outPath = resolve(opts.out);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, sql, 'utf8');
      console.error(`Wrote UTF-8 loadtest seed SQL (${opts.count} companies) to ${outPath}`);
    } else {
      process.stdout.write(sql);
    }
  }
}
