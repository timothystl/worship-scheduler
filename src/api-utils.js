// Shared utilities used across multiple api-*.js modules.
import { json } from './auth.js';

// Disambiguate household display names when multiple households share the same name.
// "Smith Family" + "John" → "John Smith Family"; "Smith" + "John" → "John Smith"
export function disambiguateHHName(name, headFirst) {
  if (!headFirst) return name;
  const m = name.match(/^(.*?)\s*Family\s*$/i);
  return m ? (headFirst + ' ' + m[1].trim() + ' Family') : (headFirst + ' ' + name);
}

// Returns the ISO date string (YYYY-MM-DD) of the Monday of the current UTC week.
export function isoWeekKey() {
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun
  const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mon = new Date();
  mon.setUTCDate(mon.getUTCDate() + daysToMon);
  return mon.toISOString().slice(0, 10);
}

// ── CSV GIVING IMPORT HELPERS ─────────────────────────────────────────────────

// Parse Breeze fund strings into per-fund splits.
// Handles:
//   "40085 General Fund"
//   "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
//   "General Fund: $160.00, Tuition Aid: $40.00"
//   "" or "nan"  → General Fund
export function parseFundSplits(fundStr, totalCents) {
  const s = (fundStr || '').trim();
  if (!s || s.toLowerCase() === 'nan') return [{ name: 'General Fund', cents: totalCents }];
  // Breeze CSV format: starts with numeric fund ID prefix e.g. "40085 General Fund (160.00)"
  if (/^\d+\s/.test(s)) {
    const parts = s.split(/,\s*(?=\d)/);
    const splits = parts.map(p => {
      const m = p.trim().match(/^(.+?)(?:\s+\(([0-9.]+)\))?\s*$/);
      return m ? { name: m[1].trim(), cents: m[2] ? Math.round(parseFloat(m[2]) * 100) : null } : null;
    }).filter(Boolean);
    if (splits.length > 1) return splits.map(f => ({ name: f.name, cents: f.cents ?? 0 }));
    if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
  }
  // Colon format: "General Fund: $160.00, Tuition Aid: $40.00"
  if (/:\s*\$?[0-9]/.test(s)) {
    const parts = s.split(/,\s*(?=\S)/);
    const splits = [];
    for (const p of parts) {
      const m = p.trim().match(/^([^:]+?):\s*\$?([0-9.]+)\s*$/);
      if (m) splits.push({ name: m[1].trim(), cents: Math.round(parseFloat(m[2]) * 100) });
    }
    if (splits.length > 1) return splits;
    if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
  }
  return [{ name: s, cents: totalCents }];
}

// Compute the breeze_id / entry key for a CSV giving row.
//   splitIdx: 0-based index within a parseFundSplits multi-fund single row (-1 if not multi-fund)
//   nthOcc:   how many times this payment ID has appeared in the CSV so far (1-indexed)
export function givingEntryId(pid, nthOcc, splitIdx) {
  if (splitIdx >= 0) return pid + '-' + (splitIdx + 1);  // parseFundSplits multi-fund row
  return nthOcc === 1 ? pid : pid + '-' + nthOcc;         // Breeze per-fund multi-row
}

// Returns true if this giving row is already present in existingIds (dedup check).
export function isGivingDup(pid, nthOcc, existingIds) {
  return nthOcc === 1
    ? (existingIds.has(pid) || existingIds.has(pid + '-1'))
    : existingIds.has(pid + '-' + nthOcc);
}

// ── PHONE NORMALIZATION ───────────────────────────────────────────────────
// Strips formatting and returns (XXX) XXX-XXXX for 10-digit US numbers.
// Returns original string unchanged for international or unusual formats.
export function normalizePhone(raw) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return '(' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return raw;
}

// ── LOB ADDRESS VALIDATION ────────────────────────────────────────────────
// Uses Lob's US Verification API (Basic auth, API key as username).
// Lob deliverability values → dpvConfirmation equivalents returned to frontend:
//   deliverable                → Y (confirmed)
//   deliverable_unnecessary_unit → Y (confirmed, unit not needed)
//   deliverable_missing_unit   → S (primary ok, secondary needed)
//   deliverable_incorrect_unit → D (primary ok, secondary wrong)
//   undeliverable              → N (no match)

// ── UTILS API HANDLER ─────────────────────────────────────────────────────
export async function handleUtilsApi(req, env, url, method, seg, db, isAdmin) {

  // POST /admin/api/utils/validate-address
  if (seg === 'utils/validate-address' && method === 'POST') {
    if (!env.LOB_API_KEY) {
      return json({ error: 'LOB_API_KEY secret not configured in Cloudflare.' }, 503);
    }
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const primary_line = (b.address1 || '').trim();
    if (!primary_line) return json({ error: 'address1 is required' }, 400);

    try {
      const body = { primary_line };
      if (b.address2?.trim()) body.secondary_line = b.address2.trim();
      if (b.city?.trim())     body.city = b.city.trim();
      if (b.state?.trim())    body.state = b.state.trim();
      if (b.zip?.trim())      body.zip_code = b.zip.replace(/[^0-9]/g, '').slice(0, 5);

      const res = await fetch('https://api.lob.com/v1/us_verifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + btoa(env.LOB_API_KEY + ':'),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error?.message || ('Lob error ' + res.status);
        return json({ error: msg }, 422);
      }

      const data = await res.json();
      const c = data.components || {};
      // Map Lob deliverability to dpvConfirmation for consistent frontend handling
      const lobDpv = {
        deliverable: 'Y',
        deliverable_unnecessary_unit: 'Y',
        deliverable_missing_unit: 'S',
        deliverable_incorrect_unit: 'D',
        undeliverable: 'N',
      };
      const dpv = lobDpv[data.deliverability] || 'N';
      return json({
        ok: true,
        address1: data.primary_line || '',
        address2: data.secondary_line || '',
        city: c.city || '',
        state: c.state || '',
        zip: c.zip_code || '',
        zip4: c.zip_code_plus_4 || '',
        dpvConfirmation: dpv,
        deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
        deliverability: data.deliverability || '',
      });
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  // POST /admin/api/utils/normalize-phones — one-time bulk phone cleanup (admin only)
  if (seg === 'utils/normalize-phones' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const rows = (await db.prepare(`SELECT id, phone FROM people WHERE phone != ''`).all()).results || [];
    const toUpdate = rows
      .map(r => ({ id: r.id, norm: normalizePhone(r.phone), orig: r.phone }))
      .filter(r => r.norm !== r.orig);
    for (const row of toUpdate) {
      await db.prepare('UPDATE people SET phone=? WHERE id=?').bind(row.norm, row.id).run();
    }
    return json({ ok: true, updated: toUpdate.length, total_with_phone: rows.length });
  }

  return null;
}
