# Timothy Finance Alpha

This directory is the separately deployable Finance application boundary being built inside the
existing CHMS repository. It begins at `1.0.0-alpha.1`; legacy Connect/Finance version history is
preserved separately.

## Current scope

The alpha serves a branded staging shell and `/health`. It intentionally has no D1, KV, R2,
service binding, queue, cron, email, payment, authentication, production route, or production data
connection. A successful shell deployment proves packaging and release isolation only.

The initial deployment is intentionally unrouted: both `workers_dev` and preview URLs are disabled.
Do not add a reachable hostname until Cloudflare Access is enabled for the account and protection is
attached to the whole Worker. This prevents a second, unprotected URL from bypassing the staging
sign-in gate.

Existing Finance remains operational in the current Connect Worker. Moving a reader, writer,
route, identity flow, or database table requires a later reviewed slice with contract,
reconciliation, and rollback evidence.

## Files

- `shell.js` — Cloudflare Worker entry point and safe health endpoint.
- `version.js` — intentional semantic prerelease version.
- `../../wrangler.finance.staging.jsonc` — isolated staging Worker configuration.
- `../../test/finance-alpha-shell.test.js` — boundary, response, and security regression tests.

## Validate

From the repository root:

```sh
npm ci
npx vitest run test/finance-alpha-shell.test.js
npx wrangler deploy --dry-run --config wrangler.finance.staging.jsonc
```

Run the repository's full required validation before merging:

```sh
npm test
node .github/scripts/check-built-scripts.js
```

## Release sequence

Use intentional versions only:

`1.0.0-alpha.x` → `1.0.0-beta.x` → `1.0.0-rc.x` → `1.0.0`

Every staging deployment records the exact main commit in `RELEASE_SHA`. Do not deploy this Worker
to a production route, attach production resources, or treat an alpha version as authoritative.
