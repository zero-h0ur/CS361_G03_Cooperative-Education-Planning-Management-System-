import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
// Review source only. Number022 was free in the C7 read-only inventory.
// No database connection or AWS execution in this reader.
export const VERSION='022_coordinator_intake_controls.sql';
export const SQL_SHA256='40ea01888fdfac3ea7892e08b0f6bc043ecc16b28271e74b6a318ae461c42d97';
export function readIntakeControlsSql(){
 const bytes=readFileSync(new URL('../../src/db/upgrades/'+VERSION,import.meta.url));
 if(bytes.includes(13) || createHash('sha256').update(bytes).digest('hex')!==SQL_SHA256)throw Error('INTAKE_CONTROLS_SOURCE_INTEGRITY');
 return bytes.toString('utf8');
}
