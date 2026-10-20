import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGOS_DIR = path.resolve(__dirname, '../resources/images/company-logos');
const MAPPING_OUTPUT = path.resolve(__dirname, '../data/company-logos.json');

// Comprehensive Domain Mapping for Approved Partner Companies (C01-C112)
export const DOMAIN_MAP = {
  // Major Partners & Actively Recruiting
  'bangkokbank': { domain: 'www.bangkokbank.com', matchKeywords: ['ธนาคารกรุงเทพ', 'bangkok bank'] },
  'cdg': { domain: 'cdg.co.th', matchKeywords: ['ซีดีจี', 'cdg'] },
  'vernity': { domain: 'vernity.com', matchKeywords: ['เวอร์นิตี้', 'vernity'] },
  'mobileconnect': { domain: 'mobileconnect.co.th', matchKeywords: ['โมบาย คอนเน็ค', 'mobile connect'] },
  'houseofdev': { domain: 'houseofdev.tech', matchKeywords: ['เฮาส์ออฟเดฟ', 'house of dev'] },
  'siamkubota': { domain: 'www.siamkubota.co.th', matchKeywords: ['คูโบต้า', 'kubota'] },
  'datafarm': { domain: 'datafarm.co.th', matchKeywords: ['ดาต้าฟาร์ม', 'data farm'] },
  'm365': { domain: 'm365.co.th', matchKeywords: ['เอ็ม 365', 'm 365', 'm365'] },
  'becworld': { domain: 'www.ch3plus.com', matchKeywords: ['บีอีซี', 'bec world', 'ช่อง 3'] },
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
  'pttor': { domain: 'www.pttor.com', matchKeywords: ['ปตท. น้ำมัน', 'ptt or', 'or'] },

  // Additional 67 Partner Companies
  'set': { domain: 'www.set.or.th', matchKeywords: ['ตลาดหลักทรัพย์แห่งประเทศไทย', 'set'] },
  'ngernturbo': { domain: 'www.ngernturbo.com', matchKeywords: ['เงินเทอร์โบ', 'ngen turbo'] },
  'cpf': { domain: 'www.cpfworldwide.com', matchKeywords: ['เจริญโภคภัณฑ์อาหาร', 'cpf', 'ซีพีเอฟ'] },
  'cjexpress': { domain: 'www.cjexpress.co.th', matchKeywords: ['ซี.เจ. เอ็กซ์เพรส', 'cj express'] },
  'tcctechnology': { domain: 'www.tcctechnology.com', matchKeywords: ['ที.ซี.ซี. เทคโนโลยี', 'tcc technology'] },
  'krungsriauto': { domain: 'www.krungsriauto.com', matchKeywords: ['อยุธยา แคปปิตอล', 'krungsri auto'] },
  'arise': { domain: 'arise.tech', matchKeywords: ['อะไรส์', 'arise', 'อิน ฟินิธัส'] },
  'itone': { domain: 'www.itone.co.th', matchKeywords: ['ไอทีวัน', 'it one'] },
  'botnoi': { domain: 'botnoi.ai', matchKeywords: ['ไอบอทน้อย', 'botnoi'] },
  'yuanta': { domain: 'www.yuanta.co.th', matchKeywords: ['หยวนต้า', 'yuanta'] },
  'infilight': { domain: 'infilight.co.th', matchKeywords: ['อินฟิไลท์', 'infilight'] },
  'ai9': { domain: 'ai9.co.th', matchKeywords: ['เอไอไนน์', 'ai9'] },
  'scgchemicals': { domain: 'www.scgchemicals.com', matchKeywords: ['เอสซีจี เคมิคอลส์', 'scgc'] },
  'tisco': { domain: 'www.tisco.co.th', matchKeywords: ['ทิสโก้', 'tisco'] },
  'pea': { domain: 'www.pea.co.th', matchKeywords: ['การไฟฟ้าส่วนภูมิภาค', 'pea'] },
  'blendata': { domain: 'blendata.co', matchKeywords: ['เบลนเดต้า', 'blendata'] },
  'cloudhm': { domain: 'www.cloudhm.co.th', matchKeywords: ['คลาวด์ เอชเอ็ม', 'cloud hm'] },
  'delitech': { domain: 'www.delitech.co.th', matchKeywords: ['เดลิเทค', 'delitech'] },
  'exxonmobil': { domain: 'www.exxonmobil.com', matchKeywords: ['เอ็กซอนโมบิล', 'exxonmobil', 'esso'] },
  'inext': { domain: 'inext.co.th', matchKeywords: ['อินโนเวทีฟ เอ็กซ์ตรีมิสต์', 'inext'] },
  'kingpower': { domain: 'www.kingpower.com', matchKeywords: ['คิง เพาเวอร์', 'king power'] },
  'lseg': { domain: 'www.lseg.com', matchKeywords: ['ตลาดหลักทรัพย์ลอนดอน', 'lseg'] },
  'groupib': { domain: 'www.group-ib.com', matchKeywords: ['กรุ๊ป-ไอบี', 'group-ib'] },
  'oceanlife': { domain: 'www.oceanlifeonline.com', matchKeywords: ['ไทยสมุทร', 'ocean life'] },
  'idealab': { domain: 'idealab.com', matchKeywords: ['ไอเดียแล็บ', 'idealab'] },
  'b3tech': { domain: 'b3tech.co.th', matchKeywords: ['บี ทรี เทคโนโลยี', 'b3 technology'] },
  'dohome': { domain: 'www.dohome.co.th', matchKeywords: ['ดูโฮม', 'dohome'] },
  'skilllane': { domain: 'www.skilllane.com', matchKeywords: ['สกิลเลน', 'skilllane'] },
  'got': { domain: 'www.got.co.th', matchKeywords: ['เก็ต ออน เทคโนโลยี', 'get on technology'] },
  'edvisory': { domain: 'edvisory.co.th', matchKeywords: ['เอ็ดไวซอรี่', 'เอดไวซอรี่', 'edvisory'] },
  'synphaet': { domain: 'www.synphaet.co.th', matchKeywords: ['สินแพทย์', 'synphaet'] },
  'derive': { domain: 'derive.co.th', matchKeywords: ['ไอ.แอล.เอส', 'ils', 'derive'] },
  'supalai': { domain: 'www.supalai.com', matchKeywords: ['ศุภาลัย', 'supalai'] },
  'cubesofttech': { domain: 'www.cubesofttech.com', matchKeywords: ['คิวบ์ ซอฟท์เทค', 'cube softtech'] },
  'merxil': { domain: 'merxil.com', matchKeywords: ['เมอร์ซิล', 'merxil'] },
  'gofive': { domain: 'www.gofive.co.th', matchKeywords: ['โกไฟว์', 'gofive'] },
  'ascendcorp': { domain: 'www.ascendcorp.com', matchKeywords: ['แอสเซนด์ กรุ๊ป', 'ascend group'] },
  'betimes': { domain: 'betimes.biz', matchKeywords: ['บีทามส์', 'betimes'] },
  'lulutech': { domain: 'lulutech.co.th', matchKeywords: ['ลูลู่', 'lulutech'] },
  'yipintsoi': { domain: 'www.yipintsoi.com', matchKeywords: ['ยิบอินซอย', 'yip in tsoi'] },
  'jobbkk': { domain: 'www.jobbkk.com', matchKeywords: ['จ๊อบบีเคเค', 'jobbkk'] },
  'loxley': { domain: 'www.loxley.co.th', matchKeywords: ['ล็อกซเล่ย์', 'loxley'] },
  'ey': { domain: 'www.ey.com', matchKeywords: ['อีวาย', 'ey'] },
  'scgcico': { domain: 'www.scgchemicals.com', matchKeywords: ['ไอโค พอลิเมอร์', 'scgc ico'] },
  'vcabo': { domain: 'www.vcabo.com', matchKeywords: ['วีคาโบ้', 'vcabo'] },
  'unisecurity': { domain: 'unisecurity.co.th', matchKeywords: ['ยูนิ ซีเคียวริตี้', 'uni security'] },
  'jitta': { domain: 'www.jitta.com', matchKeywords: ['จิตตะ', 'jitta'] },
  'netbay': { domain: 'www.netbay.co.th', matchKeywords: ['เน็ตเบย์', 'netbay'] },
  'tleasing': { domain: 'www.tleasing.co.th', matchKeywords: ['ที ลีสซิ่ง', 't leasing'] },
  'trinityroots': { domain: 'trinityroots.co.th', matchKeywords: ['ทรีนิตี้ รูทส์', 'trinity roots'] },
  'narit': { domain: 'www.narit.or.th', matchKeywords: ['สถาบันวิจัยดาราศาสตร์', 'narit'] },
  'iamconsulting': { domain: 'iam-consulting.com', matchKeywords: ['ไอ แอม คอนซัลติ้ง', 'i am consulting'] },
  'dhipaya': { domain: 'www.dhipaya.co.th', matchKeywords: ['ทิพยประกันภัย', 'dhipaya'] },
  'krungthai': { domain: 'krungthai.com', matchKeywords: ['กรุงไทย', 'krungthai', 'ktb'] },
  'vannasplus': { domain: 'vannasplus.com', matchKeywords: ['แวนเนส พลัส', 'vannas plus'] },
  'iapp': { domain: 'iapp.co.th', matchKeywords: ['ไอแอพพ์', 'iapp'] },
  'innovestx': { domain: 'www.innovestx.co.th', matchKeywords: ['อินโนเวสท์ เอกซ์', 'innovestx'] },
  'datax': { domain: 'datax.scb', matchKeywords: ['เดต้า เอกซ์', 'datax'] },
  'avision': { domain: 'avision.co.th', matchKeywords: ['เอวิชั่น', 'avision'] },
  'sirisoft': { domain: 'www.sirisoft.co.th', matchKeywords: ['สิริซอฟต์', 'sirisoft'] },
  'michelin': { domain: 'www.michelin.co.th', matchKeywords: ['มิชลิน', 'michelin'] },
  'truemoney': { domain: 'www.truemoney.com', matchKeywords: ['แอสเซนด์ มันนี่', 'truemoney', 'true money'] },
  'crg': { domain: 'www.crg.co.th', matchKeywords: ['เซ็นทรัล เรสตอรองส์', 'crg'] }
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

if (process.argv[1] && process.argv[1].endsWith('fetch-company-logos.mjs')) {
  fetchCompanyLogos().catch(console.error);
}
