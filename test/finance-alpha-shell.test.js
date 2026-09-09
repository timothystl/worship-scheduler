import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../apps/finance/shell.js';
import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from '../apps/finance/version.js';
import { FINANCE_QUERY_BUDGETS, runBudgetedReadBatch } from '../apps/finance/query-budget.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'wrangler.finance.staging.jsonc'), 'utf8'));
const summarySchema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps/finance/contracts/summary-v1.schema.json'), 'utf8'));
const statements = [];
const env = {
  ENVIRONMENT: 'staging', RELEASE_SHA: 'test-sha',
  FINANCE_DB: {
    prepare(sql) { statements.push(sql); return { sql }; },
    async batch() {
      return [
        { results: [{ value: 'SYNTHETIC-NO-PRODUCTION-DATA' }] },
        { results: [{ actual_cents: 20000000, budget_cents: 21000000 }] },
        { results: [{ balance_cents: 60000000 }] },
        { results: [{ room_count: 1, billed_cents: 4000000 }] },
      ];
    },
  },
};

describe('Finance 1.0.0 alpha staging shell', () => {
  it('uses intentional prerelease versioning', () => {
    expect(FINANCE_VERSION).toBe('1.0.0-alpha.9');
    expect(FINANCE_RELEASE_CHANNEL).toBe('alpha');
  });

  it('has a staging-only Worker name and no stateful or outbound bindings', () => {
    expect(config.name).toBe('timothy-finance-app-staging');
    expect(config.vars.ENVIRONMENT).toBe('staging');
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.routes).toEqual([
      { pattern: 'finance-staging.timothystl.org', custom_domain: true },
    ]);
    expect(config.d1_databases).toEqual([expect.objectContaining({
      binding: 'FINANCE_DB',
      database_name: 'timothy-finance-db-staging',
      migrations_dir: 'apps/finance/migrations',
    })]);
    const shell = fs.readFileSync(path.join(repoRoot, 'apps/finance/shell.js'), 'utf8');
    expect(shell).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i);
    expect(shell).not.toMatch(/\.run\(|\.exec\(/);
    for (const forbidden of ['kv_namespaces', 'r2_buckets', 'queues', 'services', 'triggers']) {
      expect(config[forbidden], `${forbidden} must not exist in the alpha shell`).toBeUndefined();
    }
  });

  it('reports non-sensitive release identity from health', async () => {
    const res = await worker.fetch(new Request('https://finance.test/health'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      product: 'finance',
      environment: 'staging',
      version: '1.0.0-alpha.9',
      releaseChannel: 'alpha',
      releaseSha: 'test-sha',
    });
  });

  it('renders a clearly labeled shell with no production connection claim', async () => {
    const res = await worker.fetch(new Request('https://finance.test/'), env);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('Timothy Finance');
    expect(html).toContain('no production writers attached');
    expect(html).toContain('1.0.0-alpha.9 · alpha');
    expect(html).toContain('$200,000');
    expect(html).toContain('$210,000');
    expect(html).toContain('$600,000');
    expect(html).toContain('$1,450');
    expect(html).toContain('Giving records</small><strong>6');
    expect(html).toContain('validated locally with no network call');
    expect(html).toContain('deterministic synthetic staging fixtures');
  });

  it('renders the familiar Finance navigation and explicit non-connected parity scaffolds', async () => {
    const res = await worker.fetch(new Request('https://finance.test/?section=property'), env);
    const html = await res.text();
    for (const label of [
      'Financial Health', 'Church Report', 'Balance Sheet', 'Daycare Report',
      'Commercial Property', 'Budget', 'Chart of Accounts', 'Compensation', 'Data & Imports',
    ]) expect(html).toContain(label);
    expect(html).toContain('href="/?section=property" aria-current="page"');
    expect(html).toContain('Commercial Property staging scaffold');
    expect(html).toContain('production workflow and data are not connected to staging');
    expect(html).toContain('monthly financials');
    expect(html).not.toContain('$1,450');
  });

  it('serves only synthetic read-only summary data', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/summary'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dataClassification).toBe('synthetic');
    expect(body.summary.church.actual_cents).toBe(20000000);
    expect(statements).toHaveLength(4);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
  });

  it('enforces the named summary query budget and read-only statements', async () => {
    expect(FINANCE_QUERY_BUDGETS).toEqual({ summary: 4 });
    await expect(runBudgetedReadBatch(env.FINANCE_DB, 'summary', [
      'SELECT 1', 'SELECT 2', 'SELECT 3', 'SELECT 4', 'SELECT 5',
    ])).rejects.toThrow('Finance query budget exceeded: summary');
    await expect(runBudgetedReadBatch(env.FINANCE_DB, 'summary', [
      'UPDATE finance_settings SET value=value',
    ])).rejects.toThrow('Finance query budget permits SELECT statements only: summary');
    await expect(runBudgetedReadBatch(env.FINANCE_DB, 'missing', [])).rejects.toThrow(
      'Unknown Finance query budget: missing',
    );
  });

  it('publishes a stable versioned summary contract', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/summary'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('finance.summary.v1');
    expect(await res.json()).toEqual({
      contract: 'finance.summary.v1',
      dataClassification: 'synthetic',
      release: {
        product: 'finance', environment: 'staging', version: '1.0.0-alpha.9',
        releaseChannel: 'alpha', releaseSha: 'test-sha',
      },
      summary: {
        church: { actualCents: 20000000, budgetCents: 21000000 },
        balanceSheet: { balanceCents: 60000000 },
        childcare: { roomCount: 1, billedCents: 4000000 },
      },
    });
    expect(statements).toHaveLength(4);
    expect(statements.every((sql) => /^SELECT\b/i.test(sql))).toBe(true);
    expect(summarySchema.$id).toBe('urn:timothy:finance:summary:v1');
    expect(summarySchema.properties.contract.const).toBe('finance.summary.v1');
    expect(summarySchema.additionalProperties).toBe(false);
  });

  it('keeps the alpha compatibility alias visibly deprecated', async () => {
    const res = await worker.fetch(new Request('https://finance.test/api/summary'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('deprecation')).toBe('true');
    expect(res.headers.get('link')).toBe('</api/v1/summary>; rel="successor-version"');
  });

  it('serves the validated static Connect Giving fixture without querying D1 or calling outbound', async () => {
    statements.length = 0;
    const res = await worker.fetch(new Request('https://finance.test/api/v1/connect-giving-preview'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-finance-contract')).toBe('connect.giving-summary.v1');
    const body = await res.json();
    expect(body.contract).toBe('connect.giving-summary.v1');
    expect(body.dataClassification).toBe('aggregate');
    expect(body.totals).toEqual({ grossCents: 150000, refundCents: 5000, netCents: 145000 });
    expect(body.reconciliation).toEqual({ sourceRecordCount: 6, fundCount: 2, totalsMatch: true });
    expect(statements).toHaveLength(0);

    const shell = fs.readFileSync(path.join(repoRoot, 'apps/finance/shell.js'), 'utf8');
    expect(shell).not.toMatch(/await\s+fetch\s*\(|globalThis\.fetch|env\.[A-Za-z0-9_]+\.fetch\s*\(/);
  });

  it('ships restrictive response headers and rejects writes', async () => {
    const get = await worker.fetch(new Request('https://finance.test/'), env);
    expect(get.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(get.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const post = await worker.fetch(new Request('https://finance.test/', { method: 'POST' }), env);
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
