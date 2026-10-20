import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGOS_DIR = path.resolve(__dirname, '../resources/images/company-logos');
const MAPPING_OUTPUT = path.resolve(__dirname, '../data/company-logos.json');

// Domain mapping for recognized companies
export const DOMAIN_MAP = {
  // Actively Recruiting & Major Partners
  'bangkokbank': { domain: 'www.bangkokbank.com', matchKeywords: ['ธนาคารกรุงเทพ', 'bangkok bank'] },
  'cdg': { domain: 'cdg.co.th', matchKeywords: ['ซีดีจี', 'cdg'] },
  'vernity': { domain: 'vernity.com', matchKeywords: ['เวอร์นิตี้', 'vernity'] },
  'mobileconnect': { domain: 'mobileconnect.co.th', matchKeywords: ['โมบาย คอนเน็ค', 'mobile connect'] },
  'houseofdev': { domain: 'houseofdev.tech', matchKeywords: ['เฮาส์ออฟเดฟ', 'house of dev'] },
  'siamkubota': { domain: 'www.siamkubota.co.th', matchKeywords: ['คูโบต้า', 'kubota'] },
  'datafarm': { domain: 'datafarm.co.th', matchKeywords: ['ดาต้าฟาร์ม', 'data farm'] },
  'm365': { domain: 'm365.co.th', matchKeywords: ['เอ็ม 365', 'm 365', 'm365'] },
  'becworld': { domain: 'www.becworld.com', matchKeywords: ['บีอีซี', 'bec world', 'ช่อง 3'] },
  'etda': { domain: 'etda.or.th', matchKeywords: ['สพธอ', 'ธุรกรรมทางอิเล็กทรอนิกส์', 'etda'] },
  'nipacloud': { domain: 'nipa.cloud', matchKeywords: ['นิภา', 'nipa'] },
  'betagro': { domain: 'www.betagro.com', matchKeywords: ['เบทาโกร', 'betagro'] },
  'thailife': { domain: 'thailife.com', matchKeywords: ['ไทยประกันชีวิต', 'thai life'] },
  'kkp': { domain: 'kkpfg.com', matchKeywords: ['เกียรตินาคิน', 'kkp', 'dime'] },
  'krungsrinimble': { domain: 'krungsrinimble.com', matchKeywords: ['กรุงศรี นิมเบิล', 'krungsri nimble'] },
  'toyota': { domain: 'www.toyota.co.th', matchKeywords: ['โตโยต้า', 'toyota'] },
  'ditc': { domain: 'ditc.co.th', matchKeywords: ['ดีไอทีซี', 'ditc', 'ธรรมนิติ'] },
  'canon': { domain: 'canon.co.th', matchKeywords: ['แคนนอน', 'canon'] },
  'ttbbank': { domain: 'ttbbank.com', matchKeywords: ['ทหารไทยธนชาต', 'ttb', 'ทีทีบี'] },
  'kasikornbank': { domain: 'www.kasikornbank.com', matchKeywords: ['กสิกรไทย', 'kasikorn'] },
  'centralretail': { domain: 'www.centralretail.com', matchKeywords: ['เซ็นทรัล รีเทล', 'central retail', 'cpc'] },
  'bigc': { domain: 'www.bigc.co.th', matchKeywords: ['บิ๊กซี', 'big c'] },
  'ais': { domain: 'ais.th', matchKeywords: ['แอดวานซ์ อินโฟร์', 'ais', 'เอไอเอส'] },
  'true': { domain: 'true.th', matchKeywords: ['ทรู', 'true'] },
  'bangchak': { domain: 'bangchak.co.th', matchKeywords: ['บางจาก', 'bangchak'] },
  'pttor': { domain: 'www.pttor.com', matchKeywords: ['ปตท. น้ำมัน', 'ptt or', 'or'] }
};

export async function fetchCompanyLogos() {
  if (!fs.existsSync(LOGOS_DIR)) {
    fs.mkdirSync(LOGOS_DIR, { recursive: true });
  }

  const generatedMap = {};
  console.log(`Starting logo fetch for ${Object.keys(DOMAIN_MAP).length} mapped companies...`);

  for (const [slug, info] of Object.entries(DOMAIN_MAP)) {
    const filename = `${slug}.png`;
    const localRelPath = `resources/images/company-logos/${filename}`;
    const absolutePath = path.resolve(LOGOS_DIR, filename);

    if (fs.existsSync(absolutePath)) {
      console.log(`  [Cached] ${slug} -> ${localRelPath}`);
      generatedMap[slug] = {
        path: localRelPath,
        keywords: info.matchKeywords
      };
      continue;
    }

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${info.domain}&sz=128`;
    try {
      const res = await fetch(faviconUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        // Only write if buffer is non-trivial (valid image response)
        if (buffer.length > 200) {
          fs.writeFileSync(absolutePath, buffer);
          console.log(`  [Downloaded] ${slug} (${info.domain}) -> ${localRelPath}`);
          generatedMap[slug] = {
            path: localRelPath,
            keywords: info.matchKeywords
          };
          continue;
        }
      }
      console.log(`  [Skipped] ${slug} (Empty/Default favicon from ${info.domain})`);
    } catch (err) {
      console.warn(`  [Failed] ${slug} (${info.domain}):`, err.message);
    }
  }

  fs.writeFileSync(MAPPING_OUTPUT, JSON.stringify(generatedMap, null, 2), 'utf-8');
  console.log(`Saved logo mapping to ${MAPPING_OUTPUT}`);
  return generatedMap;
}

// Self-run when invoked directly
if (process.argv[1] && process.argv[1].endsWith('fetch-company-logos.mjs')) {
  fetchCompanyLogos().catch(console.error);
}
