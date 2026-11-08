import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const FRESH_SHA256='d361f970dd94dc5fb4b42da172dde8c58894be3ca2148a5b2748be571f31ca10';
export const UPGRADE_SHA256='68b8f3d9f4ad257868933e9e5371a256a78bd08efedf692b343bd10c1e117b9d';
export function readAcademicReviewUpgrade(){
 const fresh=readFileSync(new URL('../../src/db/migrations/023_phase1_academic_review.sql',import.meta.url));
 const upgrade=readFileSync(new URL('../../src/db/upgrades/023_phase1_academic_review.sql',import.meta.url));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(hash(fresh)!==FRESH_SHA256 || hash(upgrade)!==UPGRADE_SHA256 || !upgrade.subarray(upgrade.indexOf(Buffer.from('-- Additive review evidence.'))).equals(fresh))throw Error('ACADEMIC_REVIEW_SQL_CHANGED');
 return upgrade.toString('utf8');
}
