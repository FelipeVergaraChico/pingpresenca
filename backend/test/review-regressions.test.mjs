// Standalone review: owns a randomly named, disposable PostgreSQL container.
// Never loads .env or accepts a database URL from the operator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseConfig } from '../dist/config.js';
import { createPool } from '../dist/db/pool.js';
import { initializeInstallation } from '../dist/installation.js';
import { migrate } from '../dist/db/migrate.js';
import { buildApp } from '../dist/app.js';
import { assertSchemaReady } from '../dist/db/readiness.js';

test('Review E0/E1 with isolated PostgreSQL', async (t) => {
  const name=`pingpresenca-review-${randomBytes(6).toString('hex')}`;
  const db='pingpresenca_test_review', password=randomBytes(24).toString('hex');
  const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  let created=false, pool, app;
  try {
    docker('run','-d','--name',name,'-e','POSTGRES_USER=pingtest','-e',`POSTGRES_PASSWORD=${password}`,'-e',`POSTGRES_DB=${db}`,'-p','127.0.0.1::5432','postgres:16-alpine'); created=true;
    let ready=false;
    for(let i=0;i<60;i++) { try {docker('exec',name,'pg_isready','-h','127.0.0.1','-U','pingtest','-d',db);ready=true;break;} catch {await new Promise(r=>setTimeout(r,500));} }
    assert(ready,'Synthetic PostgreSQL readiness');
    const port=docker('port',name,'5432/tcp').split(':').at(-1);
    const config=parseConfig({NODE_ENV:'test',PUBLIC_ORIGIN:'http://localhost:5173',COOKIE_SECURE:'false',INSTALLATION_NAME:'Review synthetic',INSTALLATION_TIME_ZONE:'America/Sao_Paulo',BOOTSTRAP_SECRET:randomBytes(32).toString('hex'),DATABASE_URL:`postgresql://pingtest:${password}@127.0.0.1:${port}/${db}`});
    pool=createPool(config);
    await t.test('R06: an empty database is not ready and is not migrated by a readiness check', async () => {
      await assert.rejects(assertSchemaReady(pool), {code:'SCHEMA_NOT_READY',status:503});
      assert.equal((await pool.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name,null);
    });
    const sql=await readFile(new URL('../migrations/001_foundation.sql',import.meta.url),'utf8');
    await pool.query(sql);
    await pool.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz DEFAULT clock_timestamp())');
    await pool.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',['001_foundation.sql',createHash('sha256').update(sql).digest('hex')]);
    await initializeInstallation(pool,config);
    app=await buildApp(config,pool);
    let n=1;
    const post=(url,body,cookie='')=>app.inject({method:'POST',url,payload:body,headers:{origin:config.publicOrigin,cookie},remoteAddress:`192.0.2.${n++}`});
    const get=(url,cookie='')=>app.inject({url,headers:{cookie}});
    const ok=async(url,body,cookie='')=>{const r=await post(url,body,cookie); assert(r.statusCode<300,`${url}: ${r.statusCode} ${r.body}`);return r.json();};
    await ok('/api/bootstrap',{name:'Owner review',email:'owner-review@example.com',password,secret:config.bootstrapSecret});
    const login=async(email)=>{const r=await post('/api/auth/login',{email,password});assert.equal(r.statusCode,200);return String(r.headers['set-cookie']).split(';')[0];};
    const owner=await login('owner-review@example.com');
    await t.test('R06: health must not report ready when the E1 schema is missing',async()=>{
      const academic=await get('/api/offerings',owner);
      assert.equal(academic.statusCode,500); // establishes the version mismatch
      const health=await get('/api/health');
      assert.equal(health.statusCode,503);
      assert.equal(health.json().code,'SCHEMA_NOT_READY');
      assert.match(health.json().message,/npm run db:migrate/);
      assert(!health.body.includes(password));
    });
    await migrate(pool);
    await t.test('R06: the matching schema is ready, but an unknown applied migration is not', async () => {
      assert.equal((await get('/api/health')).statusCode,200);
      await pool.query("INSERT INTO schema_migrations(name,checksum) VALUES('999_unknown.sql','synthetic')");
      assert.equal((await get('/api/health')).statusCode,503);
      await pool.query("DELETE FROM schema_migrations WHERE name='999_unknown.sql'");
      await assertSchemaReady(pool);
    });
    const createAccount=async(name,roles)=>{
      const email=`${name}@example.com`;
      const {id}=await ok('/api/admin/accounts',{name,email,institutionalId:null,roles},owner);
      const {url}=await ok(`/api/admin/accounts/${id}/invitations`,{},owner);
      await ok('/api/invitations/accept',{token:url.split('#invite=')[1],password});
      return {id,cookie:await login(email)};
    };
    const teacher=await createAccount('Teacher-review',['PROFESSOR']);
    const student=await createAccount('Student-review',['STUDENT']);
    const {id:discipline}=await ok('/api/disciplines',{name:'Review discipline',description:''},owner);
    const locationBody={name:'Review room',latitude:-23,longitude:-46,radius:100,geoRequired:true};
    const {id:location}=await ok('/api/locations',locationBody,owner);
    const offerBody={disciplineId:discipline,name:'Review offering',term:'2026/2',shift:'Noite',attendanceMode:'PILOT'};
    const {id:offering}=await ok('/api/offerings',offerBody,owner);
    const lessonBody={offeringId:offering,locationId:location,title:'Review lesson',description:'',startsLocal:'2026-09-10T19:00',endsLocal:'2026-09-10T21:00',attendanceMode:'PILOT'};
    const {id:lesson}=await ok('/api/lessons',lessonBody,owner);
    const {id:enrollment}=await ok(`/api/offerings/${offering}/enrollments`,{accountId:student.id,enrolledLocal:'2026-01-01T00:00',endedLocal:'2099-12-31T00:00'},owner);
    await t.test('R07: an active enrollment with a scheduled end can be ended earlier without reopening history',async()=>{
      const members=(await get(`/api/offerings/${offering}/members`,owner)).json();
      assert.equal(members.enrollments.find(e=>e.id===enrollment).can_end,true);
      // Only the symmetric difference in eligibility is protected. A locked lesson
      // at the old exclusive boundary must not prevent shortening the period.
      const {id:outside}=await ok('/api/lessons',{...lessonBody,startsLocal:'2099-12-31T00:00',endsLocal:'2099-12-31T01:00'},owner);
      await pool.query('UPDATE lessons SET context_locked_at=clock_timestamp() WHERE id=$1',[outside]);
      assert.equal((await post(`/api/enrollments/${enrollment}/end`,{endedLocal:'2100-01-01T00:00',version:1},owner)).statusCode,400);
      await pool.query('UPDATE lessons SET context_locked_at=clock_timestamp() WHERE id=$1',[lesson]);
      const blocked=await post(`/api/enrollments/${enrollment}/end`,{endedLocal:'2026-09-10T19:00',version:1},owner);
      assert.equal(blocked.json().code,'HISTORICAL_ENROLLMENT');
      const r=await post(`/api/enrollments/${enrollment}/end`,{endedLocal:'2026-09-10T20:00',version:1},owner);
      assert.equal(r.statusCode,200,`${r.json().code}: ${r.json().message}`);
      const row=(await pool.query('SELECT ended_at,version FROM enrollments WHERE id=$1',[enrollment])).rows[0];
      assert.equal(row.ended_at.toISOString(),'2026-09-10T23:00:00.000Z');
      assert.equal(row.version,2);
      const events=(await pool.query("SELECT actor_id,actor_role,details FROM audit_events WHERE action='ENROLLMENT_ENDED' AND target_id=$1",[enrollment])).rows;
      assert.equal(events.length,1);
      assert(events[0].actor_id);
      assert.equal(events[0].actor_role,'OWNER');
      assert.deepEqual(events[0].details.before,{endedAt:'2099-12-31T03:00:00.000Z',version:1});
      assert.equal(Date.parse(events[0].details.after.endedAt),row.ended_at.getTime());
      assert.equal(events[0].details.after.version,2);
      await pool.query('UPDATE lessons SET context_locked_at=NULL WHERE id=$1',[lesson]);
      assert.equal((await post(`/api/enrollments/${enrollment}/end`,{endedLocal:'2026-09-10T20:00',version:1},owner)).json().code,'VERSION_CONFLICT');
    });
    await t.test('R07: already-ended periods remain closed; future shortening is concurrent and audit-atomic', async () => {
      const {id:past}=await ok(`/api/offerings/${offering}/enrollments`,{accountId:student.id,enrolledLocal:'2000-01-01T00:00',endedLocal:'2000-02-01T00:00'},owner);
      assert.equal((await post(`/api/enrollments/${past}/end`,{endedLocal:'2000-01-20T00:00',version:1},owner)).json().code,'ENROLLMENT_ALREADY_ENDED');
      assert.equal((await get(`/api/offerings/${offering}/members`,owner)).json().enrollments.find(e=>e.id===past).can_end,false);
      const {id:future}=await ok(`/api/offerings/${offering}/enrollments`,{accountId:student.id,enrolledLocal:'2099-01-01T00:00',endedLocal:'2099-06-01T00:00'},owner);
      await pool.query(`CREATE FUNCTION review_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$;
        CREATE TRIGGER review_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION review_fail_audit()`);
      try {
        assert.equal((await post(`/api/enrollments/${future}/end`,{endedLocal:'2099-04-01T00:00',version:1},owner)).statusCode,500);
        assert.equal((await pool.query('SELECT version FROM enrollments WHERE id=$1',[future])).rows[0].version,1);
      } finally {
        await pool.query('DROP TRIGGER review_fail_audit ON audit_events; DROP FUNCTION review_fail_audit()');
      }
      const results=await Promise.all(['2099-04-01T00:00','2099-05-01T00:00'].map(endedLocal=>post(`/api/enrollments/${future}/end`,{endedLocal,version:1},owner)));
      assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
      assert.equal(Number((await pool.query("SELECT count(*) FROM audit_events WHERE action='ENROLLMENT_ENDED' AND target_id=$1",[future])).rows[0].count),1);
    });
    await t.test('PASS: unauthenticated/student/unlinked teacher denied administrative writes and individual lists',async()=>{
      const writes=[
        ['/api/admin/settings',{institutionalIdRequired:false,version:1,reason:'Review'}],
        ['/api/admin/accounts',{name:'Forbidden review',email:'forbidden@example.com',institutionalId:null,roles:['STUDENT']}],
        [`/api/admin/accounts/${student.id}/profile`,{name:'Forbidden review',institutionalId:null,version:2,reason:'Review'}],
        [`/api/admin/accounts/${student.id}/roles`,{roles:['ADMIN'],version:2,reason:'Review'}],
        [`/api/admin/accounts/${student.id}/invitations`,{}],
        ['/api/disciplines',{name:'Forbidden discipline',description:''}],
        [`/api/disciplines/${discipline}`,{name:'Forbidden discipline',description:'',version:1}],
        ['/api/locations',locationBody],[`/api/locations/${location}`,{...locationBody,version:1}],
        ['/api/offerings',offerBody],[`/api/offerings/${offering}`,{name:'Forbidden offering',term:'2026/2',shift:'Noite',attendanceMode:'PILOT',version:1}],
        [`/api/offerings/${offering}/teachers`,{teacherIds:[teacher.id],version:1}],
        [`/api/offerings/${offering}/enrollments`,{accountId:student.id,enrolledLocal:'2026-09-01T00:00',endedLocal:null}],
        [`/api/enrollments/${enrollment}/end`,{endedLocal:'2026-09-10T20:00',version:1}],
        ['/api/lessons',lessonBody],[`/api/lessons/${lesson}`,{...lessonBody,version:1}],
      ];
      for(const cookie of ['',student.cookie,teacher.cookie]) for(const [url,body] of writes) {
        const r=await post(url,body,cookie);assert([401,403,404].includes(r.statusCode),`${url}: ${r.statusCode}`);
      }
      for(const cookie of ['',student.cookie,teacher.cookie]) for(const url of ['/api/admin/accounts','/api/admin/settings','/api/admin/installation',`/api/offerings/${offering}/members`,`/api/lessons/${lesson}/planning`]) {
        const r=await get(url,cookie); assert([401,403,404].includes(r.statusCode),`${url}: ${r.statusCode}`);
      }
      t.diagnostic('63 direct authorization requests denied as expected');
    });
    await t.test('PASS: linked teacher writes lose authority after unlink; student response excludes policy and colleagues',async()=>{
      await ok(`/api/offerings/${offering}/teachers`,{teacherIds:[teacher.id],version:1},owner);
      await ok(`/api/lessons/${lesson}`,{...lessonBody,description:'Allowed edit',version:1},teacher.cookie);
      await ok(`/api/offerings/${offering}/teachers`,{teacherIds:[],version:2},owner);
      assert.equal((await post(`/api/lessons/${lesson}`,{...lessonBody,version:2},teacher.cookie)).statusCode,404);
      const response=await get(`/api/offerings/${offering}/lessons`,student.cookie);
      assert.equal(response.statusCode,200); assert.equal(response.json().items.length,1);
      for(const key of ['latitude','longitude','radius','password_hash','students','teacherIds']) assert.equal(response.body.includes(`"${key}"`),false,key);
    });
    await t.test('PASS: same-version edits race, only one update and one audit event survive',async()=>{
      const before=(await pool.query("SELECT count(*) FROM audit_events WHERE action='DISCIPLINE_UPDATED'")).rows[0].count;
      const results=await Promise.all(['Alpha','Beta'].map(name=>post(`/api/disciplines/${discipline}`,{name,description:'',version:1},owner)));
      assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
      assert.equal(Number((await pool.query("SELECT count(*) FROM audit_events WHERE action='DISCIPLINE_UPDATED'")).rows[0].count),Number(before)+1);
    });
    await t.test('PASS: migration checksum divergence fails instead of rewriting applied history',async()=>{
      await pool.query("UPDATE schema_migrations SET checksum='synthetic-mismatch' WHERE name='002_academic_preparation.sql'");
      await assert.rejects(migrate(pool),/alterada após aplicação/);
      assert.equal((await get('/api/health')).statusCode,503);
      assert.equal((await pool.query("SELECT checksum FROM schema_migrations WHERE name='002_academic_preparation.sql'")).rows[0].checksum,'synthetic-mismatch');
    });
  } finally {
    if(app) await app.close(); if(pool) await pool.end();
    if(created) {docker('rm','-f','-v',name);t.diagnostic('Only the synthetic review database/container were removed.');}
  }
});
