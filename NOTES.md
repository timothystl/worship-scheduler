# Dev Notes — Volunteer / ChMS App

This file is checked at the start of every debugging or improvement session.
Update it as issues are found, fixed, or queued.

---

## Architecture Quick Reference

- **Runtime**: Cloudflare Workers + D1 (SQLite at the edge)
- **Entry point**: `tlc-volunteer-worker.js` → routes to `src/api-chms.js` (people/giving/import) and other handlers
- **Frontend**: `chms-admin.html` + `src/html-chms.js` (rendered server-side as a single HTML string)
- **Auth**: role-based — `admin | finance | staff | member`
- **Breeze ChMS API base URL**: `https://<BREEZE_SUBDOMAIN>.breezechms.com/api/`

### Key Breeze API quirks
- `/api/profile` returns field definitions; the `id` on a field is NOT the key used in a person's `details` object — use `field_id` instead.
- `/api/people?details=1` returns people with a `details` object keyed by `field_id` values.
- DOB may live at `person.birth_date` (top-level) OR `details['birthdate']` (literal key) rather than under a numeric field ID.
- The built-in person-type field ID is `1076274773`; values `1=Member, 2=Attender, 3=Visitor`.
- `fk(field)` helper: `String(field.field_id || field.id)` — always use this to get the detail lookup key.

---

## Known Issues / TODO

| # | Area | Description | Status |
|---|------|-------------|--------|
| 1 | Bulk Breeze import | Crashes on 2nd batch with HTML response (Cloudflare error page) instead of JSON — added global try/catch + D1 param-limit fix (chunked NOT IN) | Fixed — monitor |
| 2 | Bulk Breeze import | If the import still errors, check browser console for `"Bulk import error: ..."` JSON — the exact exception message will now be visible | Open — needs test run |
| 3 | Deactivation query | `NOT IN (ids...)` was spreading all IDs into one D1 bind call; D1 limit is ~100 params — now batched in chunks of 90 | Fixed |
| 4 | Per-person Breeze sync | `POST /admin/api/import/breeze-sync-person` — added endpoint + "Sync Breeze" button on profile page | Fixed |
| 5 | Demographic fields blank | DOB, baptism, confirmation, anniversary, gender, marital status not populating on import — fixed field ID lookup (`field_id` vs `id`), added literal key fallbacks, fixed `findField` to prefer date-named fields | Fixed |
| 6 | Confirmation field | `findField` was matching "Confirmed" (dropdown) instead of "Confirmation Date" (date field) — tightened exact-match list | Fixed |
| 7 | DOB field | Breeze "Age" field stores birthdate; added "age"/"age and birthdate" to DOB search patterns; also checks `p.birth_date` top-level and `details['birthdate']` literal key | Fixed |
| 8 | Individual gifts | Gift edit modal not showing — duplicate modal ID bug | Fixed |
| 9 | Statement send | Send statement from profile was broken | Fixed |
| 10 | Demographics Edit button | Role/visibility CSS issue on Edit button in demographics section | Fixed |

---

## Recent Changes (newest first)

### 2026-04-15
- **Bulk import global try/catch** (`src/api-chms.js`): Wrapped entire `import/breeze` handler in try/catch so uncaught exceptions return `{ ok: false, error: "..." }` JSON instead of Cloudflare HTML error page.
- **Deactivation query batching**: Changed `NOT IN (?)` deactivation to process IDs in chunks of 90 to respect D1's ~100-parameter limit.
- **Per-person Breeze sync**: Added `POST /admin/api/import/breeze-sync-person` endpoint and "Sync Breeze" button on the profile demographics section.
- **Demographic field detection**: Fixed `field_id` vs `id` lookup, added literal key fallbacks, improved `findField` date-preference logic, updated `extractDate` to check `birth_date`/`birthday` keys.

---

## Useful Debug Patterns

### Check what Breeze fields are being matched
On the first batch of a bulk import, the response includes `_diag` with:
- `dob_field`, `baptism_field`, `confirmation_field` — which Breeze fields were matched
- `sample_detail_keys` — first 20 keys from first person's `details` object
- `all_profile_fields` — full list of field names/IDs from `/api/profile`

### Per-person sync diagnostic
`POST /admin/api/import/breeze-sync-person` returns `{ diag: { all_profile_field_names, detail_keys_in_breeze, detail_sample, field_matches, fetch_debug } }` — check browser console after clicking "Sync Breeze".

### Cloudflare Worker returning HTML instead of JSON
Means an uncaught exception escaped the handler. Check:
1. Is there a try/catch around the relevant endpoint block?
2. Are there any `await` calls outside try/catch that could throw?
3. D1 parameter limit (~100 per statement) — use chunked queries for large IN/NOT IN lists.

---

## Environment Variables (Cloudflare Worker secrets)
- `BREEZE_SUBDOMAIN` — subdomain for `<subdomain>.breezechms.com`
- `BREEZE_API_KEY` — Breeze API key
- `DB` — D1 database binding
