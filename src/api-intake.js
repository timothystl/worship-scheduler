// ── Public intake endpoints ───────────────────────────────────────────
// These handle form submissions forwarded from the public website (timothystl.org).
// Auth is via the X-Intake-Key header matching env.CHMS_INTAKE_API_KEY — NOT a
// user session. The only caller should be the timothystl.org admin worker's
// /api/contact and /api/prayer handlers.
import { json } from './auth.js';

function splitName(full) {
  const parts = (full || '').trim().split(/\s+/);
  if (!parts.length || !parts[0]) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

async function findPersonByEmail(db, email) {
  if (!email) return null;
  return await db.prepare(
    "SELECT id, first_name, last_name, email, first_contact_date FROM people WHERE LOWER(email) = LOWER(?) AND status='active' LIMIT 1"
  ).bind(email).first();
}

export async function handleIntakeApi(req, env, path) {
  const expectedKey = env.CHMS_INTAKE_API_KEY || '';
  if (!expectedKey) return json({ error: 'Intake not configured' }, 503);
  const key = req.headers.get('X-Intake-Key') || '';
  if (key !== expectedKey) return json({ error: 'Unauthorized' }, 401);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const name    = String(body.name    || '').trim().slice(0, 200);
  const email   = String(body.email   || '').trim().slice(0, 200);
  const phone   = String(body.phone   || '').trim().slice(0, 40);
  const message = String(body.message || '').trim().slice(0, 5000);
  const source  = String(body.source  || '').slice(0, 200);
  const submittedAt = body.submitted_at && /^\d{4}-\d{2}-\d{2}/.test(String(body.submitted_at))
    ? String(body.submitted_at).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const db = env.DB;

  if (path === '/api/intake/connect-card') {
    if (!name || !message) return json({ error: 'name and message required' }, 400);
    const { first, last } = splitName(name);
    let person = await findPersonByEmail(db, email);
    let created = false;
    if (!person) {
      const r = await db.prepare(
        `INSERT INTO people(first_name, last_name, email, phone, member_type, status, active, first_contact_date, followup_status)
         VALUES(?, ?, ?, ?, 'Visitor', 'active', 1, ?, 'new')`
      ).bind(first, last, email, phone, submittedAt).run();
      person = { id: r.meta.last_row_id };
      created = true;
    } else {
      const updates = [];
      const binds = [];
      if (!person.first_contact_date) { updates.push("first_contact_date=?", "followup_status='new'"); binds.push(submittedAt); }
      if (phone) { updates.push('phone = CASE WHEN phone = "" THEN ? ELSE phone END'); binds.push(phone); }
      if (updates.length) {
        binds.push(person.id);
        await db.prepare(`UPDATE people SET ${updates.join(', ')} WHERE id=?`).bind(...binds).run();
      }
    }
    const noteText = 'Contact card (' + (source || 'website') + '):\n' + message;
    await db.prepare(
      "INSERT INTO follow_up_items(person_id, type, notes, created_at) VALUES(?, 'general', ?, datetime('now'))"
    ).bind(person.id, noteText).run();
    return json({ ok: true, person_id: person.id, created });
  }

  if (path === '/api/intake/prayer') {
    if (!message) return json({ error: 'message required' }, 400);
    let personId = null;
    if (email) {
      const p = await findPersonByEmail(db, email);
      if (p) personId = p.id;
    }
    const r = await db.prepare(
      `INSERT INTO prayer_requests(person_id, requester_name, requester_email, request_text, source, submitted_at, status)
       VALUES(?, ?, ?, ?, ?, ?, 'open')`
    ).bind(personId, name, email, message, source || 'website', submittedAt).run();
    return json({ ok: true, request_id: r.meta.last_row_id, person_id: personId });
  }

  return json({ error: 'Not found' }, 404);
}
