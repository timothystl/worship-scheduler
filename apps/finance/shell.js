import { FINANCE_RELEASE_CHANNEL, FINANCE_VERSION } from './version.js';
import givingFixture from '../../contracts/examples/giving-summary-v1.synthetic.json';
import { acceptConnectGivingSummaryV1 } from './connect-giving-consumer.js';
import { buildSummaryV1, FINANCE_SUMMARY_CONTRACT, readSyntheticSummary } from './summary-service.js';
import { isFinanceMethodAllowed, resolveFinanceRoute } from './route-manifest.js';

const PRODUCT = 'finance';
const SUMMARY_CONTRACT = FINANCE_SUMMARY_CONTRACT;
const GIVING_CONTRACT = 'connect.giving-summary.v1';
const SYNTHETIC_GIVING = acceptConnectGivingSummaryV1(givingFixture);

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

function formatCents(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

function renderShell(metadata, summary, giving) {
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
    .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(9rem,1fr)); gap: .75rem; margin-top: 1.25rem; }
    .card { padding: 1rem; border: 1px solid #27425a; border-radius: .65rem; }
    .card small { display: block; color: #80c7ff; margin-bottom: .35rem; }
    .card strong { font-size: 1.3rem; }
    footer { margin-top: 2rem; color: #7890a4; font-size: .8rem; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Isolated staging environment</div>
    <h1>Timothy Finance</h1>
    <p>The rebuilt Finance application boundary is running. Business data and production workflows are not connected in this alpha release.</p>
    <div class="status">Environment ready · no production writers attached</div>
    <section class="grid" aria-label="Synthetic finance summary">
      <div class="card"><small>Church actual</small><strong>${formatCents(summary.church.actual_cents)}</strong></div>
      <div class="card"><small>Church budget</small><strong>${formatCents(summary.church.budget_cents)}</strong></div>
      <div class="card"><small>Balance sheet</small><strong>${formatCents(summary.balanceSheet.balance_cents)}</strong></div>
      <div class="card"><small>Childcare rooms</small><strong>${Number(summary.childcare.room_count || 0)}</strong></div>
      <div class="card"><small>Giving net</small><strong>${formatCents(giving.totals.netCents)}</strong></div>
      <div class="card"><small>Giving records</small><strong>${Number(giving.reconciliation.sourceRecordCount || 0)}</strong></div>
    </section>
    <p><small>All values shown here are deterministic synthetic staging fixtures. Giving is the committed Connect contract example, validated locally with no network call.</small></p>
    <footer>${release}</footer>
  </main>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const metadata = releaseMetadata(env);

    if (!isFinanceMethodAllowed(request.method)) {
      return response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, HEAD' },
      });
    }

    const route = resolveFinanceRoute(url.pathname);
    if (!route) {
      return response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    if (route.id === 'health') {
      const body = request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', ...metadata });
      return response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }

    if (route.id === 'summary-v1') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify(buildSummaryV1(metadata, summary));
        return response(body, { headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Finance-Contract': SUMMARY_CONTRACT,
        } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (route.id === 'giving-preview-v1') {
      const body = request.method === 'HEAD' ? null : JSON.stringify(SYNTHETIC_GIVING);
      return response(body, { headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Finance-Contract': GIVING_CONTRACT,
      } });
    }

    if (route.id === 'summary-legacy') {
      try {
        const summary = await readSyntheticSummary(env.FINANCE_DB);
        const body = request.method === 'HEAD' ? null : JSON.stringify({ ...metadata, dataClassification: 'synthetic', summary });
        return response(body, { headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Deprecation: 'true',
          Link: '</api/v1/summary>; rel="successor-version"',
        } });
      } catch {
        return response(JSON.stringify({ error: 'Synthetic staging data unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
    }

    if (route.id === 'shell') {
      if (request.method === 'HEAD') return response(null, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      try {
        return response(renderShell(metadata, await readSyntheticSummary(env.FINANCE_DB), SYNTHETIC_GIVING), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      } catch {
        return response('Synthetic staging data unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    }

    return response('Route manifest mismatch', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
