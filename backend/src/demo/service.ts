import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Config } from '../config.js';
import { transaction } from '../db/pool.js';
import { AppError } from '../platform/errors.js';
import { digest } from '../identity/password.js';
import { audit } from '../audit.js';

export const DEMO_LOCK = 720261030;
export const DEMO_WRITES = 5000;
export const DEMO_SESSIONS = 200;
export const DEMO_LESSONS = 30;
export const demoProfiles = ['professor', 'aluno-1', 'aluno-2', 'aluno-3'] as const;
export type DemoProfile = typeof demoProfiles[number];
const blocked = (message: string) => new AppError(503, 'DEMO_CONFIGURATION', message);

async function dedicated(c: pg.PoolClient | pg.Client, config: Config) {
  const { rows: [row] } = await c.query('SELECT current_database() AS name');
  if (!config.publicDemo || !row.name.startsWith('pingpresenca_demo_'))
    throw blocked('Demonstração exige PUBLIC_DEMO=true e banco dedicado pingpresenca_demo_*.');
}

export async function assertDemoMode(pool: pg.Pool | pg.Client, config: Config) {
  // Old-schema health tests must still be able to expose SCHEMA_NOT_READY.
  const { rows: [table] } = await pool.query("SELECT to_regclass('demo_state') AS name");
  const marked = table.name ? Boolean((await pool.query('SELECT 1 FROM demo_state')).rowCount) : false;
  if (marked !== config.publicDemo)
    throw blocked('Modo incompatível com o banco. Prepare uma demonstração vazia ou use a configuração da instalação regular.');
}

// Dedicated connection: holds the reset barrier for the entire HTTP application lifetime.
// Separate from the request pool, so pool.end() cannot deadlock waiting for this lease.
export async function demoLease(config: Config) {
  const client = new pg.Client({ ...config.database, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    if (config.publicDemo) await dedicated(client, config);
    await client.query('SELECT pg_advisory_lock_shared($1)', [DEMO_LOCK]);
    await assertDemoMode(client, config);
    return client;
  } catch (error) { await client.end(); throw error; }
}

export async function demoStatus(pool: pg.Pool) {
  const { rows: [row] } = await pool.query(`SELECT expires_at, clock_timestamp() >= expires_at AS expired,
    GREATEST(0,$1-writes) AS remaining FROM demo_state`, [DEMO_WRITES]);
  if (!row) throw blocked('Demonstração não preparada.');
  return { expiresAt: row.expires_at.toISOString() as string, expired: row.expired as boolean,
    remainingOperations: row.remaining as number };
}

export async function demoLogin(pool: pg.Pool, profile: DemoProfile) {
  return transaction(pool, async c => {
    const { rows: [state] } = await c.query(`UPDATE demo_state SET sessions=sessions+1
      WHERE expires_at>clock_timestamp() AND sessions<$1 RETURNING profiles,expires_at`, [DEMO_SESSIONS]);
    if (!state) throw new AppError(429, 'DEMO_LIMIT', 'Ciclo de demonstração encerrado ou limite de acessos atingido. Aguarde a restauração.');
    const accountId = state.profiles[profile] as string;
    const token = randomBytes(32).toString('base64url');
    const { rows: [session] } = await c.query(`INSERT INTO auth_sessions(token_hash,account_id,expires_at)
      VALUES ($1,$2,LEAST((SELECT expires_at FROM demo_state),clock_timestamp()+interval '2 hours'))
      RETURNING expires_at`, [digest(token), accountId]);
    await audit(c, { actorId: accountId, actorRole: profile === 'professor' ? 'PROFESSOR' : 'STUDENT',
      action: 'DEMO_SESSION_CREATED', targetId: accountId, details: { profile } });
    return { token, expiresAt: session.expires_at as Date };
  });
}

export async function reserveDemoWrite(pool: pg.Pool, createsLesson: boolean) {
  await transaction(pool, async c => {
    const { rows: [state] } = await c.query(`SELECT *, expires_at>clock_timestamp() AS active
      FROM demo_state FOR UPDATE`);
    if (!state?.active || state.writes >= DEMO_WRITES)
      throw new AppError(429, 'DEMO_LIMIT', 'Ciclo de demonstração encerrado ou limite de operações atingido. Aguarde a restauração.');
    // Reserve creation slots before executing the route; failed creations count too.
    // The reserved count in profiles is not exposed as a user-selectable identity.
    const reserved = Number(state.profiles.createdLessons ?? 2);
    if (createsLesson && reserved >= DEMO_LESSONS)
      throw new AppError(429, 'DEMO_LIMIT', 'Limite de aulas da demonstração atingido. Utilize as aulas existentes.');
    await c.query(`UPDATE demo_state SET writes=writes+1,
      profiles=jsonb_set(profiles,'{createdLessons}',to_jsonb($1::integer))`,
      [reserved + Number(createsLesson)]);
  });
}

export async function prepareDemo(pool: pg.Pool, config: Config, replace = false) {
  return transaction(pool, async c => {
    await dedicated(c, config);
    const { rows: [lock] } = await c.query('SELECT pg_try_advisory_xact_lock($1) AS acquired', [DEMO_LOCK]);
    if (!lock.acquired) throw blocked('Pare a API da demonstração antes de preparar ou restaurar seus dados.');
    const existing = Boolean((await c.query('SELECT 1 FROM demo_state')).rowCount);
    if (existing && !replace) throw blocked('Demonstração já preparada. Restauração exige --replace-demo-data.');
    // Explicit inventory, no CASCADE and no arbitrary table/database names.
    const tables = `attendance_attempts,attendance_authorizations,attendance_code_limits,
      attendance_records,attendance_openings,attendance_sessions,password_recoveries,invitations,
      auth_sessions,audit_events,enrollments,offering_teachers,lessons,offerings,locations,
      disciplines,account_roles,account_profiles,accounts`;
    if (!existing) {
      for (const table of tables.split(',').map(t => t.trim())) {
        if ((await c.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)
          throw blocked('Banco contém dados sem marcador de demonstração. Nenhum dado foi removido.');
      }
      const { rows: [installation] } = await c.query('SELECT bootstrap_completed_at FROM installation');
      if (installation?.bootstrap_completed_at) throw blocked('Instalação já configurada não pode ser convertida em demonstração.');
    } else {
      // Deliberate infrastructure-only discard of a marked synthetic database.
      await c.query(`TRUNCATE ${tables}`);
    }
    const ids = Object.fromEntries(demoProfiles.map(p => [p, randomUUID()]));
    for (const profile of demoProfiles) {
      const name = profile === 'professor' ? 'Professor de demonstração' : `Aluno ${profile.at(-1)} de demonstração`;
      await c.query('INSERT INTO accounts(id,password_hash) VALUES($1,NULL)', [ids[profile]]);
      await c.query('INSERT INTO account_profiles(account_id,name,email) VALUES($1,$2,$3)',
        [ids[profile], name, `${profile}@demo.invalid`]);
      await c.query('INSERT INTO account_roles(account_id,role) VALUES($1,$2)',
        [ids[profile], profile === 'professor' ? 'PROFESSOR' : 'STUDENT']);
    }
    const discipline = randomUUID(), offering = randomUUID();
    await c.query("INSERT INTO disciplines(id,name) VALUES($1,'Introdução ao Ping Presença')", [discipline]);
    await c.query(`INSERT INTO offerings(id,discipline_id,name,term,shift,attendance_mode)
      VALUES($1,$2,'Turma aberta de demonstração','Demonstração','Livre','PILOT')`, [offering, discipline]);
    await c.query('INSERT INTO offering_teachers VALUES($1,$2)', [offering, ids.professor]);
    for (const p of demoProfiles.slice(1))
      await c.query(`INSERT INTO enrollments(id,offering_id,account_id,enrolled_at)
        VALUES($1,$2,$3,clock_timestamp()-interval '1 day')`, [randomUUID(), offering, ids[p]]);
    for (const required of [false, true]) {
      const location = randomUUID();
      await c.query(`INSERT INTO locations(id,name,latitude,longitude,radius,geo_required)
        VALUES($1,$2,-23.5505,-46.6333,100,$3)`, [location,
        required ? 'Referência fixa em São Paulo — GPS obrigatório' : 'Sala virtual — sem exigência de GPS', required]);
      await c.query(`INSERT INTO lessons(id,offering_id,location_id,title,description,starts_at,ends_at,attendance_mode)
        VALUES($1,$2,$3,$4,$5,clock_timestamp()-interval '5 minutes',clock_timestamp()+interval '24 hours','PILOT')`,
        [randomUUID(), offering, location, required ? '02 · Experimente a política de localização' : '01 · Sua primeira chamada',
        required ? 'Local fixo de referência: fora de São Paulo, rejeição ou pendência é esperada. Negar localização gera pendência após confirmação. Não é GPS simulado.'
          : 'Abra a chamada como professor. Em outro navegador ou celular, entre como aluno e confirme pelo QR ou código. Não insira dados reais.']);
    }
    const { rows: [state] } = await c.query(`INSERT INTO demo_state(singleton,generation,expires_at,profiles)
      VALUES(true,$1,clock_timestamp()+interval '24 hours',$2)
      ON CONFLICT(singleton) DO UPDATE SET generation=EXCLUDED.generation,expires_at=EXCLUDED.expires_at,
      profiles=EXCLUDED.profiles,writes=0,sessions=0 RETURNING expires_at`, [randomUUID(), ids]);
    await c.query(`INSERT INTO audit_events(id,actor_kind,action,details)
      VALUES($1,'INFRASTRUCTURE','DEMO_PREPARED',$2)`, [randomUUID(), { replaced: existing, synthetic: true }]);
    return { expiresAt: state.expires_at.toISOString() as string };
  });
}
