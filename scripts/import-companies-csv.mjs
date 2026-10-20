import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildImportSql } from './operations/partner-import-sql.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG = 'partner-registry-2569';
export const stableId = key => {
  const h = crypto.createHash('sha256').update('coed-directory:' + key).digest('hex').slice(0, 32);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20);
};
const normalize = s => String(s || '').normalize('NFKC').toLowerCase()
  .replace(/^บริษัท\s*/, '').replace(/\s*จำกัด(?:\s*\(มหาชน\))?/g, '')
  .replace(/\s*\((?:ประเทศไทย|สำนักงานใหญ่|มหาชน)\)/g, '').replace(/\s+/g, ' ').trim();
const nullable = s => String(s || '').trim() || null;

export function parseCsv(input) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('Malformed CSV.');
  if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}
export function normalizeDuration(s = '') { return String(s || '').trim().replace(/\s+/g, ' '); }
function region(address) {
  if (/กรุงเทพ|bangkok|กทม/i.test(address)) return 'กรุงเทพฯ';
  return ['นนทบุรี', 'ปทุมธานี', 'เชียงใหม่', 'ชลบุรี', 'ระยอง', 'สมุทรปราการ',
    'สมุทรสาคร', 'ภูเก็ต', 'พระนครศรีอยุธยา'].find(s => address.includes(s)) || null;
}
function safeText(value, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[<>@]|(?:\+66|0)[\d ()-]{8,}/.test(value)) throw new Error('Unsafe catalogue field; review source privately.');
  return value.trim();
}
export function validatePayload(payload) {
  const rootFields = new Set(['catalog_key', 'academic_year', 'imported_at', 'companies', 'positions', 'registry_aliases']);
  if (!payload || Object.keys(payload).some(key => !rootFields.has(key))) throw new Error('Unexpected catalogue field.');
  const sets = [
    [payload.companies, new Set(['id', 'code', 'name', 'address', 'location', 'logo', 'source', 'data_status', 'updated_at'])],
    [payload.positions, new Set(['id', 'company_id', 'title', 'announcement_ref', 'quota', 'duration', 'academic_year', 'source', 'data_status', 'updated_at'])]
  ];
  if (payload.catalog_key !== CATALOG || payload.academic_year !== 2569 || !payload.companies?.length) throw new Error('Wrong catalogue target.');
  const ids = new Set();
  const codes = new Set();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const validDate = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
  if (!validDate(payload.imported_at)) throw new Error('Invalid import date.');
  for (const [items, fields] of sets) {
    if (!Array.isArray(items)) throw new Error('Invalid records.');
    for (const item of items) {
      if (!item || Object.keys(item).some(k => !fields.has(k)) || ids.has(item.id) || !uuid.test(item.id)) throw new Error('Unexpected field or duplicate ID.');
      ids.add(item.id);
      if (item.source !== CATALOG || item.data_status !== 'to_validate') throw new Error('Invalid source/status.');
      if (!validDate(item.updated_at)) throw new Error('Invalid record date.');
      for (const k of ['name', 'address', 'location', 'title', 'quota', 'duration']) {
        if (item[k] !== null && item[k] !== undefined) safeText(item[k], k === 'address' ? 1500 : 1000);
      }
      if (item.logo && (!/^resources\/images\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp)$/.test(item.logo) || item.logo.includes('..'))) throw new Error('Invalid logo path.');
    }
  }
  for (const company of payload.companies) {
    if (!/^C\d{2,}$/.test(company.code) || codes.has(company.code)) throw new Error('Invalid/duplicate registry code.');
    codes.add(company.code); safeText(company.name);
  }
  const companyIds = new Set(payload.companies.map(c => c.id));
  if (payload.positions.some(p => !companyIds.has(p.company_id) || p.academic_year !== 2569 ||
      !/^2569:\d+$/.test(p.announcement_ref))) throw new Error('Invalid announcement reference.');
  for (const position of payload.positions) safeText(position.title, 250);
  if (!Array.isArray(payload.registry_aliases) || payload.registry_aliases.some(group =>
    !Array.isArray(group) || group.some(code => !codes.has(code)))) throw new Error('Invalid registry aliases.');
}
export function buildCatalogue(raw, { forms = '', logos = {}, importedAt = new Date().toISOString() } = {}) {
  let section = ''; const partners = [], announcements = [];
  for (const r of parseCsv(raw)) {
    if (r[0] === 'ลำดับ') { section = 'announcements'; continue; }
    if (r[0] === 'Code') { section = 'partners'; continue; }
    if (section === 'announcements' && /^\d+$/.test(r[0])) {
      // Only these columns are permitted; contact/identity columns are discarded.
      announcements.push({ key: r[0], company: r[1], title: r[2], quota: nullable(r[3]), duration: normalizeDuration(r[5]) });
    }
    if (section === 'partners' && /^C\d+$/.test(r[0])) partners.push({ code: r[0], name: r[1], address: r[2] || '' });
  }
  if (!partners.length || new Set(partners.map(p => p.code)).size !== partners.length) throw new Error('Missing/duplicate registry codes.');
  const durations = new Map();
  for (const r of parseCsv(forms).slice(1)) if (r[2] && r[3]) durations.set(normalize(r[2]), normalizeDuration(r[3]));
  const companies = partners.map(p => ({
    id: stableId(CATALOG + ':' + p.code), code: p.code, name: safeText(p.name),
    address: nullable(p.address), location: region(p.address), logo: logos[p.code] || null,
    source: CATALOG, data_status: 'to_validate', updated_at: importedAt
  }));
  const byName = new Map();
  for (const c of companies) { const key = normalize(c.name); if (!byName.has(key)) byName.set(key, []); byName.get(key).push(c); }
  for (const group of byName.values()) group.sort((a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)));
  // Exact legal-name aliases only. No brand/substring matching across subsidiaries.
  const aliases = new Map([
    ['ศูนย์เทคโนโลยีอิเล็กทรอนิกส์และคอมพิวเตอร์แห่งชาติ', 'C02'],
    ['สำนักงานพัฒนาธุรกรรมทางอิเล็กทรอนิกส์', 'C31']
  ].map(([name, code]) => [normalize(name), code]));
  const positions = [], unmatched = [];
  for (const a of announcements) {
    const name = normalize(a.company), c = byName.get(name)?.[0] || companies.find(c => c.code === aliases.get(name));
    if (!c) { unmatched.push(a.key); continue; }
    for (const title of String(a.title || '').split(/[\r\n,]+/).map(s => s.replace(/^[-•\s]+/, '').trim()).filter(Boolean)) {
      positions.push({ id: stableId(CATALOG + ':' + c.code + ':' + a.key + ':' + normalize(title)),
        company_id: c.id, title: safeText(title, 250), announcement_ref: '2569:' + a.key,
        quota: a.quota, duration: nullable(durations.get(name) || a.duration), academic_year: 2569,
        source: CATALOG, data_status: 'to_validate', updated_at: importedAt });
    }
  }
  if (unmatched.length) throw new Error('Unmatched announcement rows: ' + unmatched.join(', ') + '. Add an exact reviewed alias.');
  const payload = { catalog_key: CATALOG, academic_year: 2569, imported_at: importedAt, companies, positions,
    registry_aliases: [...byName.values()].filter(g => g.length > 1).map(g => g.map(c => c.code)) };
  validatePayload(payload); return payload;
}
function main() {
  const args = process.argv.slice(2), value = flag => { const i = args.indexOf(flag); return i < 0 ? null : args[i + 1]; };
  const input = value('--input'), out = value('--output-directory');
  if (!input || !out || !path.isAbsolute(out)) throw new Error('Use --input <private-csv> --output-directory <absolute-private-directory>.');
  const target = path.resolve(out);
  if (target === ROOT || target.startsWith(ROOT + path.sep)) throw new Error('Private output must be outside the repository.');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(target) !== target) throw new Error('Output must not contain symlinks.');
  if ((fs.statSync(target).mode & 0o077) !== 0) throw new Error('Output directory must be private (0700).');
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/companies.json'), 'utf8'));
  const logos = Object.fromEntries(current.companies.map(c => [c.code, c.logo]));
  const payload = buildCatalogue(fs.readFileSync(input, 'utf8'), {
    logos, forms: value('--forms') ? fs.readFileSync(value('--forms'), 'utf8') : ''
  });
  const sql = buildImportSql(payload);
  fs.writeFileSync(path.join(target, 'partner-import.json'), JSON.stringify(payload, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(path.join(target, 'partner-import.sql'), sql, { mode: 0o600, flag: 'wx' });
  if (args.includes('--write-public')) fs.writeFileSync(path.join(ROOT, 'data/companies.json'),
    JSON.stringify({ metadata: { academic_year: 2569, source: CATALOG, total_companies: payload.companies.length },
      companies: payload.companies }, null, 2) + '\n');
  console.log(JSON.stringify({ companies: payload.companies.length, positions: payload.positions.length,
    registryAliases: payload.registry_aliases, contactsIncluded: false,
    sqlSha256: crypto.createHash('sha256').update(sql).digest('hex'), outputDirectory: target }, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
