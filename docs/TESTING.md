# Testing

Use Node 22. For every repository change:

```sh
npm ci
npm test
node .github/scripts/check-built-scripts.js
```

Add focused tests for the changed route, permission, schema, failure, or frontend path. Confirm a
regression test fails on the prior behavior and does not pass vacuously.

Finance alpha validation:

```sh
npx vitest run test/finance-alpha-shell.test.js
npx wrangler deploy --dry-run --config wrangler.finance.staging.jsonc
```

For configuration-only changes, also dry-run the affected Worker configuration. For database work,
test on disposable/local or verified staging state first, reconcile schema and control totals, and
record the exact database identity. A passing unit suite does not establish a successful migration,
live authorization, production health, or business-data correctness.

Before a production release, the dispatch workflow repeats the full suite on the exact approved
`main` SHA. Post-release checks must remain bounded and must not expose sensitive records.

Pull-request CI also packages all three Worker configurations with Wrangler `--dry-run`. This
checks production, Connect staging, and Finance staging configuration/binding resolution without
uploading or changing a Worker.
