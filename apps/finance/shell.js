import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from './version.js';

const PRODUCT = 'finance';

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
});

function response(body, init = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(body, { ...init, headers });
}

function releaseMetadata(env) {
  return {
    product: PRODUCT,
    environment: env.ENVIRONMENT || 'unknown',
    version: FINANCE_VERSION,
    releaseChannel: FINANCE_RELEASE_CHANNEL,
    releaseSha: env.RELEASE_SHA || 'local',
  };
}

function renderShell(metadata) {
  const release = `${metadata.version} · ${metadata.releaseChannel}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Timothy Finance — Staging</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #08131f; color: #e8f0f7; }
    main { width: min(42rem, calc(100% - 2rem)); padding: 2.5rem; border: 1px solid #27425a; border-radius: 1rem; background: #0e1e2d; }
    .eyebrow { color: #80c7ff; font-size: .78rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: .65rem 0 1rem; font-size: clamp(2rem, 7vw, 3.5rem); line-height: 1; }
    p { color: #b8c8d6; line-height: 1.6; }
    .status { margin-top: 1.75rem; padding: 1rem; border-radius: .65rem; background: #102a3d; color: #d9efff; }
    footer { margin-top: 2rem; color: #7890a4; font-size: .8rem; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Isolated staging environment</div>
    <h1>Timothy Finance</h1>
    <p>The rebuilt Finance application boundary is running. Business data and production workflows are not connected in this alpha release.</p>
    <div class="status">Environment ready · no production writers attached</div>
    <footer>${release}</footer>
  </main>
</body>
</html>`;
}

async function readSyntheticSummary(db) {
  const statements = [
    "SELECT value FROM finance_settings WHERE key='fixture_label'",
    'SELECT COALESCE(SUM(own_actual_cents),0) AS actual_cents, COALESCE(SUM(own_budget_cents),0) AS budget_cents FROM finance_church_entries',
    'SELECT COALESCE(SUM(own_balance_cents),0) AS balance_cents FROM finance_church_balances',
    'SELECT COUNT(*) AS room_count, COALESCE(SUM(billed_cents),0) AS billed_cents FROM finance_daycare_rooms',
  ];
  const results = await db.batch(statements.map((sql) => db.prepare(sql)));
  const first = (index) => results[index]?.results?.[0] || {};
  if (first(0).value !== 'SYNTHETIC-NO-PRODUCTION-DATA') throw new Error('Synthetic fixture marker missing');
  return { church: first(1), balanceSheet: first(2), childcare: first(3) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const metadata = releaseMetadata(env);

    if (!['GET', 'HEAD'].includes(request.method)) {
      return response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' },
      });
    }

    if (url.pathname === '/health') {
      const body = request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', ...metadata });
      return response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    if (url.pathname === '/api/summary') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify({ ...metadata, dataClassification: 'synthetic', summary });
        return response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = request.method === 'HEAD' ? null : renderShell(metadata);
      return response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
