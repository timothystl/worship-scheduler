import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminApi } from '../src/api-admin.js';
import { authCookieHeader } from '../src/auth.js';

// Council gets a narrower, per-user slice of the Compensation Planner: unlike finance/staff
// (whose `finance` permission opens the whole Finance workspace) and unlike the dedicated
// `compensation` role (one shared fork), council's `finance` item is hardcoded to the
// Compensation Planner sub-tab only (isCompensationPlannerRequest in api-chms.js), and each
// council login may steer only the raise PLAN — the roster-wide/per-worker raise method, the
// custom/scale percentages, and the baseline-only comparison toggle — never a worker's seed
// facts or a hand-typed dollar override. Every council save lands under a key scoped to that
// user's own username (api-finance.js), so one council member's plan can never overwrite
// another's or the real admin/finance plan.

const SECRET = 'test-signing-secret';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  )`);
  sqlite.exec(`CREATE TABLE chms_config (key TEXT PRIMARY KEY, value TEXT)`);
  sqlite.exec(`CREATE TABLE finance_qb_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    realm_id TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    access_token_expires_at TEXT NOT NULL DEFAULT '',
    refresh_token_expires_at TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL DEFAULT 'production',
    connected_at TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT NOT NULL DEFAULT ''
  )`);
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async all() { return { results: sqlite.prepare(sql).all(...args) }; },
          };
        },
        async first() { return sqlite.prepare(sql).get() ?? null; },
        async all() { return { results: sqlite.prepare(sql).all() }; },
        async run() { sqlite.prepare(sql).run(); return { meta: {} }; },
      };
    },
    batch(stmts) { return Promise.all(stmts.map(s => s.run())); },
  };
  return { db, sqlite };
}

let db, sqlite, env;
beforeEach(() => {
  ({ db, sqlite } = makeDb());
  env = { DB: db, ADMIN_PASSWORD: SECRET, SESSION_SECRET: SECRET };
  // getAuthInfo live-checks any username-bearing cookie against app_users on every request
  // (auth.js), so each council login needs a real, active row here — unlike the admin/
  // break-glass cookies elsewhere in this file, which carry no username and skip that check.
  sqlite.prepare(`INSERT INTO app_users (username, role, active) VALUES (?, 'council', 1)`).run('elder1');
  sqlite.prepare(`INSERT INTO app_users (username, role, active) VALUES (?, 'council', 1)`).run('elder2');
});

async function call(role, username, path, method, body) {
  const cookie = (await authCookieHeader(env, role, username || '')).split(';')[0];
  const url = new URL('https://connect.timothystl.org/admin/api/' + path);
  const req = new Request(url, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleAdminApi(req, env, url, method);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

describe('council role — GET /admin/api/me', () => {
  it('resolves finance:edit (narrowed to Compensation Planner) and giving:anon', async () => {
    const r = await call('council', 'elder1', 'me', 'GET');
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('council');
    expect(r.body.permissions.finance).toBe('edit');
    expect(r.body.permissions.giving).toBe('anon');
    expect(r.body.permissions.register).toBe('none');
  });
});

describe('council role — Compensation Planner reads', () => {
  it('can read the bootstrap segments the tab needs', async () => {
    // finance/overview/finance/daycare/etc. are also on the allowlist (isCompensationPlannerRequest
    // in api-chms.js) but pull in QuickBooks/daycare tables this minimal harness doesn't model;
    // finance/status and finance/planning/salary are the two exercised by compensation-role.test.js
    // for the same reason and are representative of the read path being tested here.
    for (const seg of ['finance/status', 'finance/planning/salary']) {
      const r = await call('council', 'elder1', seg, 'GET');
      expect(r.status, seg).toBe(200);
    }
  });

  it('403s the rest of the Finance module', async () => {
    for (const seg of ['finance/church/balances', 'finance/qb/connect', 'finance/property/detail']) {
      const r = await call('council', 'elder1', seg, 'GET');
      expect(r.status, seg).toBe(403);
      expect(r.body.error, seg).toMatch(/Compensation Planner only/);
    }
  });

  it('403s everywhere else in the app the way a normal council session would not', async () => {
    const r = await call('council', 'elder1', 'finance/planning/church/override-bulk', 'POST', { rows: [] });
    expect(r.status).toBe(403);
  });
});

describe('council role — saving the plan', () => {
  it('saves only the raise-plan fields, into a key scoped to this username', async () => {
    const r = await call('council', 'elder1', 'finance/planning/salary', 'PUT', {
      roster: [{ name: 'Smuggled Seed Edit', actualSalaryCents: 1 }],
      compMethod: 'custom', compCustomPct: 4.25, compBaselineRosterOnly: true,
      compOverrides: { 0: '999999' },
      targetCategory: 'Smuggled Category',
    });
    expect(r.status).toBe(200);
    const stored = JSON.parse(sqlite.prepare("SELECT value FROM chms_config WHERE key='finance_salary_planner_council_elder1'").get().value);
    expect(stored.compMethod).toBe('custom');
    expect(stored.compCustomPct).toBe(4.25);
    expect(stored.compBaselineRosterOnly).toBe(true);
    // Everything outside COUNCIL_EDITABLE_FIELDS is dropped, even though the client sent it.
    expect(stored.roster).toBeUndefined();
    expect(stored.compOverrides).toBeUndefined();
    expect(stored.targetCategory).toBeUndefined();
    // And the shared admin/finance roster was never touched.
    expect(sqlite.prepare("SELECT value FROM chms_config WHERE key='finance_salary_planner'").get()).toBeFalsy();
  });

  it('never lets a council save overwrite the real admin/finance plan', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Admin Worker' }], compMethod: 'cola' });
    await call('council', 'elder1', 'finance/planning/salary', 'PUT', { compMethod: 'custom', compCustomPct: 10 });
    const adminRead = await call('admin', '', 'finance/planning/salary', 'GET');
    expect(adminRead.body.data.roster[0].name).toBe('Admin Worker');
    expect(adminRead.body.data.compMethod).toBe('cola');
  });

  it("layers this council member's plan choices on top of the real roster, not in place of it", async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', {
      roster: [{ name: 'Real Worker', actualSalaryCents: 5000000 }], compMethod: 'cola',
    });
    await call('council', 'elder1', 'finance/planning/salary', 'PUT', { compMethod: 'custom', compScalePct: 90 });
    const r = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    expect(r.body.data.roster[0].name).toBe('Real Worker');       // seed data: the real roster
    expect(r.body.data.roster[0].actualSalaryCents).toBe(5000000);
    expect(r.body.data.compMethod).toBe('custom');                // this member's own plan choice
    expect(r.body.data.compScalePct).toBe(90);
  });

  it('two council members never see or overwrite each other\'s plan', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Real Worker' }], compMethod: 'cola' });
    await call('council', 'elder1', 'finance/planning/salary', 'PUT', { compMethod: 'custom', compCustomPct: 2 });
    await call('council', 'elder2', 'finance/planning/salary', 'PUT', { compMethod: 'scalepct', compScalePct: 80 });
    const r1 = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    const r2 = await call('council', 'elder2', 'finance/planning/salary', 'GET');
    expect(r1.body.data.compMethod).toBe('custom');
    expect(r1.body.data.compCustomPct).toBe(2);
    expect(r2.body.data.compMethod).toBe('scalepct');
    expect(r2.body.data.compScalePct).toBe(80);
    // Both still see the same real roster underneath.
    expect(r1.body.data.roster[0].name).toBe('Real Worker');
    expect(r2.body.data.roster[0].name).toBe('Real Worker');
  });

  it('before saving, reads the same shared roster everyone else starts from', async () => {
    await call('admin', '', 'finance/planning/salary', 'PUT', { roster: [{ name: 'Admin Worker' }] });
    const r = await call('council', 'elder1', 'finance/planning/salary', 'GET');
    expect(r.body.data.roster[0].name).toBe('Admin Worker');
  });
});
