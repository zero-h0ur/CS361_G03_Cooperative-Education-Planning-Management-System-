import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_PATH = path.resolve(__dirname, '../data/raw-companies-2569.csv');
const OUTPUT_JSON_PATH = path.resolve(__dirname, '../data/companies.json');

// Map of known company logos in resources/images
const LOGO_MAP = {
  'agoda': 'resources/images/agoda.jpg',
  'อโกดา': 'resources/images/agoda.jpg',
  'cp all': 'resources/images/CP-ALL.png',
  'ซีพี ออลล์': 'resources/images/CP-ALL.png',
  'g-able': 'resources/images/g-able.png',
  'จีเอเบิล': 'resources/images/g-able.png',
  'gosoft': 'resources/images/gosoft.png',
  'โกซอฟท์': 'resources/images/gosoft.png',
  'huawei': 'resources/images/huawei.jpg',
  'หัวเว่ย': 'resources/images/huawei.jpg',
  'kbtg': 'resources/images/KBTG.jpg',
  'กสิกร บิซิเนส': 'resources/images/KBTG.jpg',
  'krungsri': 'resources/images/krungsri.jpg',
  'กรุงศรี': 'resources/images/krungsri.jpg',
  'nectec': 'resources/images/nectec.png',
  'เนคเทค': 'resources/images/nectec.png',
  'อิเล็กทรอนิกส์และคอมพิวเตอร์แห่งชาติ': 'resources/images/nectec.png',
  'ptt digital': 'resources/images/PTT-Digital.png',
  'พีทีที ดิจิตอล': 'resources/images/PTT-Digital.png',
  'ptt': 'resources/images/PTT.png',
  'scb techx': 'resources/images/SCB-TechX.png',
  'เอสซีบี เทคเอกซ์': 'resources/images/SCB-TechX.png',
  'scb': 'resources/images/SCB.jpg',
  'ไทยพาณิชย์': 'resources/images/SCB.jpg',
  'scbx': 'resources/images/SCBX.jpg',
  'scg': 'resources/images/SCG.png',
  'ปูนซิเมนต์ไทย': 'resources/images/SCG.png',
  'วงใน': 'resources/images/wongnai.png',
  'ไลน์แมน': 'resources/images/wongnai.png'
};

function findLogo(name = '') {
  const lower = name.toLowerCase();
  for (const [key, logoPath] of Object.entries(LOGO_MAP)) {
    if (lower.includes(key)) {
      return logoPath;
    }
  }
  return null;
}

function normalizeLocation(address = '') {
  const addr = String(address);
  if (addr.includes('กรุงเทพ') || addr.includes('Bangkok')) return 'กรุงเทพฯ';
  if (addr.includes('นนทบุรี')) return 'นนทบุรี';
  if (addr.includes('ปทุมธานี') || addr.includes('Pathumthani')) return 'ปทุมธานี';
  if (addr.includes('เชียงใหม่')) return 'เชียงใหม่';
  if (addr.includes('ชลบุรี')) return 'ชลบุรี';
  if (addr.includes('ระยอง')) return 'ระยอง';
  if (addr.includes('สมุทรปราการ')) return 'สมุทรปราการ';
  if (addr.includes('สมุทรสาคร')) return 'สมุทรสาคร';
  if (addr.includes('ภูเก็ต')) return 'ภูเก็ต';
  if (addr.includes('พระนครศรีอยุธยา') || addr.includes('อยุธยา')) return 'พระนครศรีอยุธยา';
  return 'กรุงเทพฯ';
}

function normalizeCompanyName(name = '') {
  return name
    .replace(/^บริษัท\s*/i, '')
    .replace(/\s*จำกัด\s*\(มหาชน\)/g, '')
    .replace(/\s*จำกัด/g, '')
    .replace(/\s*\(มหาชน\)/g, '')
    .replace(/\s*\(ประเทศไทย\)/g, '')
    .replace(/\s*\(สำนักงานใหญ่\)/g, '')
    .replace(/\s*เซอร์วิสเซส/g, '')
    .trim();
}

function parseCsv(content) {
  const lines = [];
  let currentLine = [];
  let currentField = '';
  let insideQuote = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuote && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
      } else {
        insideQuote = !insideQuote;
      }
    } else if (char === ',' && !insideQuote) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuote) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip \n
      }
      currentLine.push(currentField.trim());
      currentField = '';
      if (currentLine.some(f => f.length > 0)) {
        lines.push(currentLine);
      }
      currentLine = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.some(f => f.length > 0)) {
      lines.push(currentLine);
    }
  }

  return lines;
}

export function importCompanies() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV file not found at: ${CSV_PATH}`);
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(raw);

  // Split into Section 1 (Announcements) and Section 2 (Master Partners)
  const announcements = [];
  const partners = [];

  let currentSection = null;

  for (const row of rows) {
    const firstCell = (row[0] || '').trim();

    if (firstCell === 'ลำดับ') {
      currentSection = 'announcements';
      continue;
    }

    if (firstCell === 'Code') {
      currentSection = 'partners';
      continue;
    }

    if (currentSection === 'announcements') {
      // Check if this row is a valid announcement row (row[0] is a number)
      const num = parseInt(firstCell, 10);
      if (!isNaN(num) && row.length >= 6) {
        announcements.push({
          index: num,
          companyName: (row[1] || '').trim(),
          positionTitle: (row[2] || '').trim(),
          quota: (row[3] || '').trim(),
          contact: (row[4] || '').trim(),
          duration: (row[5] || '').trim(),
          updatedAt: (row[6] || '').trim(),
          status: (row[7] || '').trim()
        });
      }
    } else if (currentSection === 'partners') {
      if (firstCell.startsWith('C') && row.length >= 3) {
        partners.push({
          code: firstCell,
          name: (row[1] || '').trim(),
          address: (row[2] || '').trim()
        });
      }
    }
  }

  console.log(`Parsed ${announcements.length} announcements and ${partners.length} master partners.`);

  // Group announcements by company
  const announcementsByCompany = new Map();

  for (const ann of announcements) {
    const norm = normalizeCompanyName(ann.companyName).toLowerCase();
    if (!announcementsByCompany.has(norm)) {
      announcementsByCompany.set(norm, []);
    }
    announcementsByCompany.get(norm).push(ann);
  }

  // Build master companies list
  const companies = [];
  const matchedAnnouncementIndices = new Set();

  for (const partner of partners) {
    const normPartner = normalizeCompanyName(partner.name).toLowerCase();
    const location = normalizeLocation(partner.address);
    const logo = findLogo(partner.name);

    // Look for matching announcements
    let matchedAnnList = [];

    for (const [annNorm, annList] of announcementsByCompany.entries()) {
      if (
        normPartner === annNorm ||
        normPartner.includes(annNorm) ||
        annNorm.includes(normPartner) ||
        (normPartner.includes('nectec') && annNorm.includes('อิเล็กทรอนิกส์และคอมพิวเตอร์แห่งชาติ')) ||
        (normPartner.includes('เกียรตินาคิน') && annNorm.includes('เกียรตินาคิน')) ||
        (normPartner.includes('เอ็ม 365') && annNorm.includes('เอ็ม 365')) ||
        (normPartner.includes('สพธอ') && annNorm.includes('ธุรกรรมทางอิเล็กทรอนิกส์')) ||
        (normPartner.includes('เบทาโกร') && annNorm.includes('เบทาโกร')) ||
        (normPartner.includes('คูโบต้า') && annNorm.includes('คูโบต้า')) ||
        (normPartner.includes('กรุงศรี') && annNorm.includes('กรุงศรี')) ||
        (normPartner.includes('ซีดีจี') && annNorm.includes('ซีดีจี'))
      ) {
        matchedAnnList.push(...annList);
        annList.forEach(a => matchedAnnouncementIndices.add(a.index));
      }
    }

    const isRecruiting = matchedAnnList.length > 0;

    // Collect positions
    const positions = [];
    let contactInfo = '';
    let duration = '';

    if (isRecruiting) {
      for (const ann of matchedAnnList) {
        if (!contactInfo && ann.contact) contactInfo = ann.contact;
        if (!duration && ann.duration) duration = ann.duration;

        // Check if position title contains multiple titles separated by comma or newlines
        const titles = ann.positionTitle.split(/[\r\n,]+/).map(t => t.trim()).filter(Boolean);
        for (const title of titles) {
          positions.push({
            title: title.replace(/^[-\s•(small yellow diamond)]+/, '').trim(),
            quota: ann.quota || '-',
            contact: ann.contact || contactInfo,
            duration: ann.duration || duration
          });
        }
      }
    }

    companies.push({
      id: partner.code,
      code: partner.code,
      name: partner.name,
      location,
      address: partner.address,
      logo,
      is_recruiting: isRecruiting,
      positions_count: positions.length,
      positions,
      contact: contactInfo,
      recruiting_period: duration,
      academic_year: 2569,
      data_status: 'verified'
    });
  }

  // Check if any announcements didn't match master partners list
  const unmatchedAnnouncements = announcements.filter(a => !matchedAnnouncementIndices.has(a.index));
  if (unmatchedAnnouncements.length > 0) {
    console.log(`Unmatched announcements (${unmatchedAnnouncements.length}):`);
    for (const u of unmatchedAnnouncements) {
      console.log(`  - #${u.index}: ${u.companyName} (${u.positionTitle})`);
      // Add as standalone recruiting partner if not found in master C-list
      const location = normalizeLocation(u.contact);
      companies.push({
        id: `C_EXTRA_${u.index}`,
        code: `C+${u.index}`,
        name: u.companyName,
        location,
        address: u.companyName,
        logo: findLogo(u.companyName),
        is_recruiting: true,
        positions_count: 1,
        positions: [{
          title: u.positionTitle,
          quota: u.quota || '-',
          contact: u.contact,
          duration: u.duration
        }],
        contact: u.contact,
        recruiting_period: u.duration,
        academic_year: 2569,
        data_status: 'verified'
      });
    }
  }

  const recruitingCount = companies.filter(c => c.is_recruiting).length;

  const dataset = {
    metadata: {
      title: 'รายชื่อสถานประกอบการสหกิจศึกษา สาขาวิชาวิทยาการคอมพิวเตอร์ มหาวิทยาลัยธรรมศาสตร์',
      academic_year: 2569,
      total_companies: companies.length,
      recruiting_companies: recruitingCount,
      updated_at: new Date().toISOString()
    },
    companies
  };

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(dataset, null, 2), 'utf-8');
  console.log(`Successfully generated ${OUTPUT_JSON_PATH}`);

  const OUTPUT_JS_PATH = path.resolve(__dirname, '../companies-data.js');
  const jsContent = `/**
 * Auto-generated by scripts/import-companies-csv.mjs
 * Academic Year: ${dataset.metadata.academic_year}
 * Total: ${dataset.metadata.total_companies}, Recruiting: ${dataset.metadata.recruiting_companies}
 */
(function(root) {
  root.COMPANIES_DATA = Object.freeze(${JSON.stringify(dataset, null, 2)});
})(typeof window !== 'undefined' ? window : globalThis);
`;
  fs.writeFileSync(OUTPUT_JS_PATH, jsContent, 'utf-8');
  console.log(`Successfully generated ${OUTPUT_JS_PATH}`);
  console.log(`Total companies: ${companies.length}, Actively recruiting: ${recruitingCount}`);

  return dataset;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importCompanies();
}
