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

- Roles are `admin`, `finance`, `staff`, `council`, `member`, and `volunteer`; feature access is
  resolved by the server-side permission matrix. UI hiding is never authorization.
- Council Giving access is aggregate/anonymous only. New anonymous endpoints are denied until
  explicitly allowlisted.
- Never expose credentials or personal, giving, payroll, HR, child/family, or payment data.
- `SECRETS.md` is security-sensitive reference material, not startup reading. Do not reproduce
  values. Any removal requires credential inventory, rotation decisions, and Git-history review.
- No production query, migration, deployment, auth/configuration change, data move, or destructive
  cleanup without Andrew's explicit approval for that operation.

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
- Preparation 3 is in progress. The CHMS Git bundle was integrity-tested and restored from
  a retained copy; Andrew has copies on SharePoint and his hard drive. On September 8,
  `tlc-volunteer-db` was exported and restored into disposable D1 databases locally and through
  GitHub Actions: integrity, 117 schema objects, 60 table counts, and 36 numeric financial controls
  matched, with zero foreign-key violations; plaintext and disposable copies were deleted. The
  repeatable workflow uses a dedicated D1 token. Andrew approved weekly encrypted independent
  exports, additional exports before significant schema or data migrations, eight weeks of weekly
  retention, twelve months of month-end retention, and quarterly disposable restore tests. Issue
  #846 tracks the storage location, encryption implementation, alternate operator, and retained-copy evidence.
- The approved myMDO authorization migrations are live and synchronized to source through
  childcare-portal PR #328. Do not reapply them. Cron, advisor, function-drift and role-governance
  follow-up remains open in the existing preparation issues.
- The deployment-safety part of Implementation 1 was pulled forward and completed in PR #831.
  No other implementation phase is authorized.
- Preparation 6 documentation reset is underway. Finance extraction, repository renames,
  shared-auth rollout, payroll movement, and documentation deletion remain blocked until its
  signoff. Preparation 7 is the formal go/no-go for the broader implementation sequence.

## Documentation discipline

`CLAUDE.md` only imports this file. `AI_SESSION_START_HERE.md`, `NOTES.md`, `PLAN.md`, the
architecture packet, and dated evidence remain reference/history—not startup instructions or
competing current status. Read the smallest task-relevant source only. Preserve licenses and
evidence. Keep durable rules here, work items in the issue tracker, and history in Git. Keep this
file below 200 lines and update the checkpoint whenever overhaul status materially changes.
