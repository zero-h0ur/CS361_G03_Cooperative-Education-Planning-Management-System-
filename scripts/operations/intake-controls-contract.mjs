import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Local review source only. No production number, database or AWS execution.
export const SQL_SHA256='40ea01888fdfac3ea7892e08b0f6bc043ecc16b28271e74b6a318ae461c42d97';
export function readIntakeControlsSql(){
 const bytes=readFileSync(new URL('../../src/db/proposals/phase1_intake_controls.sql',import.meta.url));
 if(bytes.includes(13) || createHash('sha256').update(bytes).digest('hex')!==SQL_SHA256)throw Error('INTAKE_CONTROLS_SOURCE_INTEGRITY');
 return bytes.toString('utf8');
}
