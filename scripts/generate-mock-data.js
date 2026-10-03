import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateUUID(prefix) {
  const hash = crypto.createHash('md5').update(prefix).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

const companies = [];
for (let i = 1; i <= 12; i++) {
  companies.push({
    id: generateUUID(`company-${i}`),
    name: `Demo Company ${i}`,
    description: `Description for demo company ${i}`,
    website_url: `https://example.com/company${i}`,
    location: i % 2 === 0 ? 'Bangkok' : 'Chiang Mai',
    source: 'mock_generator',
    updated_at: '2026-10-04T00:00:00Z',
    visibility: 'public',
    data_status: 'mock'
  });
}

const positions = [];
for (let i = 1; i <= 18; i++) {
  const companyId = companies[(i % 12)].id;
  positions.push({
    id: generateUUID(`position-${i}`),
    company_id: companyId,
    title: `Mock Position ${i}`,
    description: `Description for position ${i}`,
    location: i % 3 === 0 ? 'Phuket' : 'Bangkok',
    source: 'mock_generator',
    updated_at: '2026-10-04T00:00:00Z',
    visibility: 'public',
    data_status: 'mock'
  });
}

const rounds = [];
for (let i = 1; i <= 3; i++) {
  rounds.push({
    id: generateUUID(`round-${i}`),
    name: `Co-op Round ${i}`,
    academic_year: 2026,
    source: 'mock_generator',
    updated_at: '2026-10-04T00:00:00Z',
    visibility: 'public',
    data_status: 'mock'
  });
}

const document_metadata = [];
for (let i = 1; i <= 8; i++) {
  document_metadata.push({
    id: generateUUID(`doc-${i}`),
    title: `Mock Document ${i}`,
    public_url: `https://example.com/docs/doc${i}.pdf`,
    academic_year: 2026,
    source: 'mock_generator',
    updated_at: '2026-10-04T00:00:00Z',
    visibility: 'public',
    data_status: 'mock'
  });
}

const students = [];
for (let i = 1; i <= 5; i++) {
  students.push({
    id: generateUUID(`student-${i}`),
    anonymous_ref: `mock-student-${i}`,
    source: 'mock_generator',
    updated_at: '2026-10-04T00:00:00Z',
    visibility: 'private',
    data_status: 'mock'
  });
}

const plans = [];
for (let i = 1; i <= 7; i++) {
  const studentId = students[(i % 5)].id;
  const roundId = i % 2 === 0 ? rounds[0].id : null;
  plans.push({
    id: generateUUID(`plan-${i}`),
    student_id: studentId,
    round_id: roundId,
    source: 'mock_generator',
    updated_at: '2026-10-04T00:00:00Z',
    visibility: 'private',
    data_status: 'mock'
  });
}

const data = {
  companies,
  positions,
  rounds,
  document_metadata,
  students,
  plans
};

const outputPath = path.join(__dirname, '../data/seed/canonical-mock-data.json');
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
console.log('Mock dataset generated at', outputPath);

