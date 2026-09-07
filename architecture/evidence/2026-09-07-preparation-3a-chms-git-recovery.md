# Preparation 3A — CHMS Git source recovery proof

> **Historical evidence — not AI startup instructions.** `AGENTS.md` is the sole current
> agent instruction file. Do not preload this document; open it only for a task that needs it,
> and verify dated claims against current code, tests, configuration, and live behavior.


Date: September 7, 2026, 12:29 a.m. UTC (September 6, 7:29 p.m. CDT)  
Scope: `timothystl/chms` Git history and exact source restore points only  
Change policy: read-only against GitHub; disposable local backup and restore test; no deployment or production configuration change

## Result

The `chms` Git repository can be mirrored, bundled, integrity-checked, restored into a fresh checkout, and checked out at both the current `main` commit and the most recently deployed Cloudflare Worker source commit.

This proves source recoverability from the current GitHub remote. It does **not** complete Preparation 3A because the resulting bundle was created in disposable scratch storage rather than a named, durable, independently controlled encrypted backup location.

## Restore points

| Purpose | Commit | Evidence |
|---|---|---|
| Current `main` after deployment-safety PR #831 | `5af49947d21418dbeccf99691822906276824574` | GitHub `main`; restored checkout matched exactly |
| Most recent Cloudflare Worker deployment source | `490c3f9f8f5ba6502f914a6374c83f58df791f76` | GitHub Actions deployment run `34049928504`; restored checkout matched exactly |
| Deployment-safety change before merge | `677240e44f3108b44e4a981d2a8fbb88ec08a098` | PR #831 head; both push and pull-request validation runs passed |

PR #831 changed workflow files only. GitHub evaluated the newly merged manual-only workflow on the merge, so commit `5af4994` was not deployed to Cloudflare. The application source at `490c3f9` remains the latest Worker deployment source.

## Procedure exercised

1. Cloned the GitHub repository as a mirror.
2. Ran `git fsck --full --strict` against the mirror.
3. Created a complete `git bundle` with all refs.
4. Verified the bundle from inside the mirror repository.
5. Cloned a fresh working repository from the bundle, not from GitHub.
6. Checked out detached commits `490c3f9` and `5af4994` and verified the full SHAs.

The bundle reported complete history and included 859 refs, including branches, tags, and GitHub pull-request refs.

## Integrity record

| Item | Value |
|---|---|
| Bundle size | 15,258,856 bytes |
| SHA-256 | `dd5096efaa81a0dcfaa7efb7704646dbf1de9505674af281fa5b4f06570ebd31` |
| Existing repository tags | 4 |
| Existing tags | `v.0.1.0_stable`, `v.2.1`, `v0.2.0`, `v1.201.0` |
| Current production/pre-overhaul tag | None |
| Temporary test location | Disposable `/tmp` storage; not a retained backup |

The optional local application-test rerun could not install packages because this execution environment did not approve package-registry network access. That does not affect the Git object and checkout recovery proof. The same proposed source change had already passed both GitHub validation runs before PR #831 merged.

## Exit-gate assessment

Preparation 3A is **partially complete**:

- PASS — exact current and deployed source SHAs are recorded;
- PASS — complete Git history passed integrity verification;
- PASS — the bundle restored into a fresh checkout;
- PASS — both required commits were recoverable from the restored bundle;
- OPEN — no durable independent encrypted backup location is recorded;
- OPEN — no repeatable operator schedule or retention policy is approved; and
- DEFERRED — immutable pre-migration tags should be created only when implementation is authorized and the precise cutover restore point is known.

## Next bounded action

Choose the durable encrypted backup location and operator. Then recreate the mirror bundle, store it outside GitHub, verify its checksum after upload/download, restore it again from that stored copy, and record duration and retention. Do not treat this disposable test bundle as the retained backup.

After that, continue Preparation 3 with `tlc-volunteer-db`: full schema/data export, disposable D1 restore, object/count/index/trigger checks, and monetary control-total reconciliation. This requires authenticated Cloudflare access but must not alter the production database.
