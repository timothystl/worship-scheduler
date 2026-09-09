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

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = request.method === 'HEAD' ? null : renderShell(metadata);
      return response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    return response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  },
};
