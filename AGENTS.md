# Timothy Connect and Finance — Agent Instructions

This is the only AI startup instruction file for this repository. Claude reads it through
`CLAUDE.md`; Codex reads it directly. Do not preload or inventory other Markdown files.
Open a reference only when the current task specifically requires it, and verify dated claims
against current source, tests, GitHub, deployed configuration, and live behavior.

## Product boundary

This repository currently serves Connect, Giving, Finance, Serve, and Scheduler from the
Cloudflare Worker `tlc-chms`. Production uses D1 `tlc-volunteer-db`, KV `RSVP_STORE`, R2
`tlc-chms-photos`, and a daily `14:00 UTC` cron. Staging uses a separate D1 database and no cron.

The target architecture has four staff products: Church Website, Connect, Finance, and myMDO.

- Connect owns people, households, Giving, communications, volunteers, scheduling,
  facilities, governance, and restricted church HR.
- Finance owns accounting imports, budgets, actuals, balances, forecasts, property finance,
  compensation planning, and future payroll processing.
- Giving remains authoritative in Connect. Finance must eventually consume versioned summaries,
  not become a second writer of gifts, batches, deposits, funds, or donor records.
- myMDO owns raw childcare operations, billing, schedules, clock events, and MDO payroll inputs.
- Repository or database boundaries change only when ownership, security, load, or failure
  isolation justifies them.

## Settled operational facts

- Finance is already a separate backend/frontend module, but it still shares the Worker and D1
  database with Connect.
- Finance currently has fifteen `finance_*` tables plus Finance-owned JSON settings mixed into
  shared `chms_config`.
- Finance directly reads Connect-owned `funds` and `giving_monthly_fund_totals`. A versioned
  Giving-summary contract must exist before physical Finance extraction.
- QuickBooks Budget API never connected successfully. Budget data is maintained through the
  working CSV/Excel import path. Do not describe QuickBooks Budget API as active, depend on it
  for current workflows, or spend time reconnecting it unless Andrew explicitly reopens that
  product decision. Existing OAuth/sync code and tables require a deliberate retirement change.
- TinyMCE is self-hosted from `vendor/tinymce/`. The subscription has lapsed. Do not add cloud
  scripts, cloud API keys, paid editor loads, or a CDN dependency.
- Production schema initialization is currently coupled to runtime `initDb()` and
  `schema_fingerprint`; the numbered migration folder is not the complete production ledger.
  Do not “fix” that during unrelated work.

## Access and data safety

- Roles are `admin`, `finance`, `staff`, `council`, `member`, `volunteer`, and `compensation`
  (view+edit access to the Compensation Planner sub-tab of Finance only, saved separately from
  the shared admin/finance roster); feature access is resolved by the server-side permission
  matrix. UI hiding is never authorization.
- Council Giving access is aggregate/anonymous only. New anonymous endpoints are denied until
  explicitly allowlisted.
- Never expose credentials or personal, giving, payroll, HR, child/family, or payment data.
- `SECRETS.md` is security-sensitive reference material, not startup reading. Do not reproduce
  values. Any removal requires credential inventory, rotation decisions, and Git-history review.
- Documentation changes and read-only production queries do not require separate approval.
- Ask Andrew before changing application source code. Production migrations, deployments,
  authentication or configuration changes, data moves, and destructive cleanup also require his
  explicit approval for that operation.

## Git, deployment, and verification

- Automatic Claude-branch merging was removed. Branches and pull requests validate without
  deploying.
- Production deployment is manual-only through `.github/workflows/deploy.yml`. It requires the
  full approved `main` commit SHA and a release reason. Never dispatch it without explicit
  production-release approval.
- Preserve unrelated concurrent work. Do not reset, rebase, force-push, or overwrite shared
  history. Use a branch or disposable worktree.
- Use Node 22. Run `npm test` and `node .github/scripts/check-built-scripts.js` before merge.
  Add focused tests for the changed path and verify regression tests are non-vacuous.
- Current code and live evidence outrank documentation. Search callers and tests before removing
  routes, schema, configuration keys, or compatibility paths.

## Timothy Digital overhaul checkpoint

- Preparation 0 is complete.
- Preparation 1 is closed by Andrew's acceptance of remaining stabilization uncertainty.
- Preparation 2's seven-day usage baseline is waived and closed.
- The CHMS retained-backup packet passed its recorded checks. The repeatable `tlc-volunteer-db` exercise passed locally and
  in GitHub Actions, matching 117 schema objects, 60 table counts, 36 numeric financial controls,
  integrity and foreign keys before deleting plaintext and disposable copies. On September 8, the
  first encrypted source-and-D1 package passed a restricted-SharePoint upload/download checksum
  test. A later full package added current source at `c0a78bc`, a fresh D1 export, all 244 objects
  (112,920,749 bytes) from R2 `tlc-chms-photos`, and a Cloudflare configuration/secret-name
  inventory. Its local encryption/decryption, Git, D1 and per-object checks passed. A downloaded
  SharePoint copy then matched the original encrypted package by size and SHA-256. A disposable R2
  restore was not separately demonstrated. The same recovery key is held separately. Issue #846 records a restricted
  SharePoint folder as the primary independent destination and an encrypted local or external
  drive as the secondary copy, alongside the approved cadence and retention. Andrew accepted sole
  operator continuity and directed that no alternate operator or further CHMS backup step block
  preparation. Do not turn those accepted limitations into passed tests.
- The approved myMDO authorization migrations are live and synchronized to source through
  childcare-portal PR #328. Do not reapply them. Migration-ledger, cron, advisor, function-drift,
  and governance follow-ups closed in #837 and #840–844. Andrew approved the Preparation 5 role defaults with granular per-user checkboxes: presets
  seed least-privilege defaults, authorized administrators can narrow or deliberately extend grants,
  and high-risk permissions remain explicit, server-enforced and audited. Current assignments were
  retained by owner decision, and #844 closes Preparation 5. The Council compensation workspace is
  a separate product addition rather than preparation work.
- The deployment-safety part of Implementation 1 was pulled forward and completed in PR #831.
  On September 9 Andrew authorized beginning the overhaul with non-destructive parallel staging.
  Finance staging is now `1.0.0-alpha.3`: protected by Worker-level Access, backed by a dedicated
  synthetic-only D1, export/restore tested, and read-only. That authorization does not permit Finance data movement,
  shared-auth rollout, production routes or competing writers without a separately reviewed slice.
- Preparation 6 documentation reset is underway; the current Markdown path dispositions are
  recorded in the private architecture repository. Finance extraction, repository renames,
  shared-auth rollout, payroll movement, and documentation deletion remain blocked until its
  signoff. Preparation 7 is the formal go/no-go for the broader implementation sequence.

## Documentation discipline

`CLAUDE.md` only imports this file. `AI_SESSION_START_HERE.md`, `NOTES.md`, `PLAN.md`, the
architecture packet, and dated evidence remain reference/history—not startup instructions or
competing current status. Read the smallest task-relevant source only. Preserve licenses and
evidence. Keep durable rules here, work items in the issue tracker, and history in Git. Keep this
file below 200 lines and update the checkpoint whenever overhaul status materially changes.
