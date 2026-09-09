# Security

## Trust boundaries

Authentication proves identity; server-side authorization grants capabilities. Navigation hiding
is not a security control. Current roles and the permission matrix are documented in `AGENTS.md`;
high-risk Finance, Giving, HR, compensation, and administration capabilities remain explicit and
audited.

Cloudflare Access protects the entire Finance staging Worker. This is a staging access boundary,
not shared production staff identity and not authorization to connect production data.

## Sensitive data

Do not expose credentials, session material, personal records, gifts, payroll/HR data, childcare
data, or payment information. Cross-product APIs return only required fields. New anonymous routes
default to denied until explicitly allowlisted and tested.

Runtime credentials belong in managed Cloudflare secrets or equivalent provider stores. Document
secret names and ownership, never values. `SECRETS.md` is a security-sensitive historical reference
pending controlled replacement; do not copy it into issues or new docs.

GitHub secret-scanning alert #1 is tracked in private CHMS issue #876. Its client-visible Firebase
key requires provider-side API/application restriction and usage verification before the alert can
be resolved or the key rotated. No Git-history rewrite is authorized by that issue.

## Change review

Authentication, permission, migration, credential, public-route, and cross-service changes require
focused negative-path tests and a rollback plan. Production configuration, data, and releases
require explicit approval for the operation.
