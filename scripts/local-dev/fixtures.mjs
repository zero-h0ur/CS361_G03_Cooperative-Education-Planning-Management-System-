import { issuer } from './config.mjs';

export const id = n => `14000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const personas = Object.freeze([
  ['student01', 'STUDENT'], ['staff01', 'STAFF'], ['advisor01', 'ADVISOR'], ['admin01', 'ADMIN'],
  ['coordinator01', 'COORDINATOR'], ['committee01', 'COMMITTEE'], ['committee02', 'COMMITTEE'], ['committee03', 'COMMITTEE']
].map(([name, role], index) => Object.freeze({ name, role, userId: id(index + 1), subject: `local:${name}` })));

export async function addLocalFixtures(pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const p of personas) {
      await c.query('INSERT INTO users(id,role,display_name) VALUES($1,$2,$3)', [p.userId, p.role, `Synthetic ${p.name}`]);
      await c.query('INSERT INTO external_identity_links(id,user_id,external_issuer,external_subject) VALUES($1,$2,$3,$4)',
        [id(20 + personas.indexOf(p)), p.userId, issuer, p.subject]);
    }
    await c.query(`INSERT INTO students(id,user_id,anonymous_ref,student_number,full_name,institutional_email,
      department,program,major,academic_year,enrollment_status,source,visibility,data_status)
      VALUES($1,$2,'LOCAL140-STUDENT01','LOCAL140001','Synthetic Student 01','student01@example.invalid',
      'LOCAL-CPE','LOCAL-CS','LOCAL-CS',2569,'ACTIVE','synthetic local fixture','private','mock')`, [id(50), id(1)]);
    await c.query(`INSERT INTO rounds(id,name,academic_year,semester,status,source,visibility,data_status)
      VALUES($1,'Local V4 test cycle — synthetic only',2569,1,'OPEN','synthetic local fixture','private','mock')`, [id(100)]);
    await c.query(`INSERT INTO staff_scopes(id,staff_id,department,program,academic_year)
      VALUES($1,$2,'LOCAL-CPE','LOCAL-CS',2569)`, [id(101), id(2)]);
    await c.query(`INSERT INTO companies(id,name,location,source,visibility,data_status)
      VALUES($1,'Synthetic Local Company','Synthetic location','synthetic local fixture','public','mock')`, [id(200)]);
    await c.query(`INSERT INTO positions(id,company_id,title,source,visibility,data_status)
      VALUES($1,$2,'Synthetic local position','synthetic local fixture','public','mock')`, [id(201), id(200)]);
    await c.query(`INSERT INTO document_policies(id,cycle_id,department,program,version,requirements,published_by)
      VALUES($1,$2,'LOCAL-CPE','LOCAL-CS',1,'[]',$3)`, [id(300), id(100), id(2)]);
    await c.query(`INSERT INTO plans(id,student_id,cycle_id,company_id,position_id,status,project_title,source,visibility,data_status)
      VALUES($1,$2,$3,$4,$5,'DRAFT','Synthetic local project','synthetic local fixture','private','mock')`,
      [id(400), id(50), id(100), id(200), id(201)]);
    await c.query(`INSERT INTO selection_cohorts(id,cycle_id,department,program,coordinator_id,committee_one,committee_two,committee_three)
      VALUES($1,$2,'LOCAL-CPE','LOCAL-CS',$3,$4,$5,$6)`, [id(500), id(100), id(5), id(6), id(7), id(8)]);
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
