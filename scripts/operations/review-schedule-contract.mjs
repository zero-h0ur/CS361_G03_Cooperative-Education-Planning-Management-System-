import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const FRESH_SHA256='5a4db76e5abe6e44692929dad360a783837f5fe9d267fb1bad0e818aa408113f';
export const UPGRADE_SHA256='c6cc6904edf0dfa4df9eab09c45bcecca9ba4529cc15204f30026d29fd3b88fa';
export function readReviewScheduleUpgrade(){
 const fresh=readFileSync(new URL('../../src/db/migrations/024_coordinator_review_window.sql',import.meta.url));
 const upgrade=readFileSync(new URL('../../src/db/upgrades/024_coordinator_review_window.sql',import.meta.url));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 if(hash(fresh)!==FRESH_SHA256 || hash(upgrade)!==UPGRADE_SHA256 || !upgrade.subarray(upgrade.indexOf(Buffer.from('-- Review dates may'))).equals(fresh))throw Error('REVIEW_SCHEDULE_SQL_CHANGED');
 return upgrade.toString('utf8');
}
