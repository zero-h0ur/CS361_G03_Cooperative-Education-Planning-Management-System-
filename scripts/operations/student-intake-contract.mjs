import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Review-only source contract. This module has no connection, Apply or AWS path.
export const VERSION='021_phase1_pending_intake.sql';
export const SQL_SHA256='e7beab8e04c60434649339a79dc857295ad4cc15d651ba5dd95f2fe30fd70442';
export function readPendingIntakeSql(){
 const bytes=readFileSync(new URL('../../src/db/upgrades/'+VERSION,import.meta.url));
 if(bytes.includes(13) || createHash('sha256').update(bytes).digest('hex')!==SQL_SHA256)throw Error('PENDING_INTAKE_SOURCE_INTEGRITY');
 return bytes.toString('utf8');
}
