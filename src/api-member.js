// ── Member Portal API ─────────────────────────────────────────────────────────
// Handles all /member/* and /portal/verify/* routes.
// Auth uses a separate cookie (tlc-member) signed with ADMIN_PASSWORD.
// Cookie value: <ts>.<people_id>.<sig>  sig covers "ts.people_id"
import { json, html, hashPassword, verifyPassword, esc, escHtml } from './auth.js';
import { initDb } from './db.js';

const MEMBER_IDLE_MS = 30 * 60 * 1000; // 30 minutes
const INVITE_TTL_MS  =  7 * 24 * 60 * 60 * 1000; // 7 days

// ── Cookie helpers ────────────────────────────────────────────────────────────

async function memberCookieHeader(env, peopleId) {
  const ts  = Date.now().toString();
  const pid = String(peopleId);
  const payload = `${ts}.${pid}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.ADMIN_PASSWORD || ''),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/[+]/g, '-').replace(/\//g, '_');
  return `tlc-member=${ts}.${pid}.${b64}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export async function getMemberAuth(req, env) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/tlc-member=([^;\s]+)/);
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [ts, pid, sig] = parts;
  if (!ts || !pid || !sig) return null;
  if (Date.now() - parseInt(ts, 10) > MEMBER_IDLE_MS) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(env.ADMIN_PASSWORD || ''),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(`${ts}.${pid}`));
    return valid ? { peopleId: parseInt(pid, 10) } : null;
  } catch { return null; }
}

async function refreshMemberCookie(response, auth, env) {
  if (!auth) return response;
  const existing = response.headers.get('Set-Cookie') || '';
  if (existing.includes('tlc-member=')) return response;
  const newCookie = await memberCookieHeader(env, auth.peopleId);
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', newCookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Email sender (Resend) ─────────────────────────────────────────────────────

async function sendInviteEmail(env, toEmail, toName, token, isReset) {
  const workerUrl = env.WORKER_URL || 'https://chms.timothystl.org';
  const link = `${workerUrl}/portal/verify/${token}`;
  const subject = isReset ? 'Reset your TLC Member Portal password' : 'You\'re invited to the TLC Member Portal';
  const body = isReset
    ? `<p>Hi ${escHtml(toName)},</p><p>Click the link below to reset your Member Portal password. This link expires in 7 days.</p><p><a href="${link}">Reset Password</a></p><p>If you didn't request this, ignore this email.</p>`
    : `<p>Hi ${escHtml(toName)},</p><p>You've been invited to the Timothy Lutheran Church Member Portal, where you can view the church directory, your volunteer schedule, and prayer requests.</p><p><a href="${link}" style="background:#0A3C5C;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">Set Up Your Account</a></p><p>This link expires in 7 days.</p>`;

  if (!env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Timothy Lutheran <noreply@timothystl.org>',
      to: [toEmail],
      subject,
      html: body,
    }),
  }).catch(() => {});
}

// ── Route dispatcher ──────────────────────────────────────────────────────────

export async function handleMemberApi(req, env, path, method) {
  await initDb(env.DB).catch(() => {});

  // Auth endpoints — no session required
  if (path === '/member/login'    && method === 'POST') return memberLogin(req, env);
  if (path === '/member/logout'   && method === 'POST') return memberLogout();
  if (path === '/member/register' && method === 'POST') return memberRegister(req, env);
  if (path === '/member/api/session' && method === 'GET') return memberSessionCheck(req, env);
  if (path === '/member/api/vapid-public-key' && method === 'GET') {
    return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
  }

  // Verify token — GET shows form, POST submits password
  const verifyMatch = path.match(/^[/]portal[/]verify[/]([0-9a-f]{64})$/);
  if (verifyMatch) {
    if (method === 'GET')  return verifyTokenGet(env, verifyMatch[1]);
    if (method === 'POST') return verifyTokenPost(req, env, verifyMatch[1]);
  }

  // Authenticated endpoints
  const auth = await getMemberAuth(req, env);
  if (!auth) return json({ error: 'Unauthorized' }, 401);

  let resp;
  if (path === '/member/api/me'              && method === 'GET')  resp = await memberGetMe(env, auth);
  else if (path === '/member/api/me'         && method === 'PUT')  resp = await memberPutMe(req, env, auth);
  else if (path === '/member/api/directory'  && method === 'GET')  resp = await memberDirectory(env, auth);
  else if (path === '/member/api/schedule'   && method === 'GET')  resp = await memberSchedule(env, auth);
  else if (path === '/member/api/prayer-requests' && method === 'GET')  resp = await memberPrayerGet(env);
  else if (path === '/member/api/prayer-requests' && method === 'POST') resp = await memberPrayerPost(req, env, auth);
  else if (path === '/member/api/push-subscribe'  && method === 'POST') resp = await memberPushSubscribe(req, env, auth);
  else resp = json({ error: 'Not found' }, 404);

  return refreshMemberCookie(resp, auth, env);
}

// ── Admin: send invite for a person ──────────────────────────────────────────
// Called from handleAdminApi — not from handleMemberApi above.

export async function handleSendInvite(req, env, personId) {
  const db = env.DB;
  const p = await db.prepare('SELECT id, first_name, last_name, email FROM people WHERE id=?').bind(personId).first();
  if (!p) return json({ error: 'Person not found' }, 404);
  if (!p.email) return json({ error: 'Person has no email address' }, 400);

  // Expire any existing unused tokens for this person
  await db.prepare('UPDATE member_invite_tokens SET used=1 WHERE people_id=? AND used=0').bind(personId).run();

  const token = generateToken();
  const expiresAt = Date.now() + INVITE_TTL_MS;
  await db.prepare('INSERT INTO member_invite_tokens (token,people_id,email,expires_at) VALUES (?,?,?,?)')
    .bind(token, personId, p.email, expiresAt).run();

  await sendInviteEmail(env, p.email, p.first_name || p.last_name, token, false);
  return json({ ok: true, email: p.email });
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

async function memberLogin(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const { username, password } = body || {};
  if (!username || !password) return json({ error: 'Username and password required' }, 400);

  const db = env.DB;
  const user = await db.prepare(
    "SELECT id, password_hash, people_id, display_name FROM app_users WHERE LOWER(username)=LOWER(?) AND active=1 AND people_id IS NOT NULL"
  ).bind(String(username).trim()).first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: 'Invalid username or password' }, 401);
  }

  const cookie = await memberCookieHeader(env, user.people_id);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify({ ok: true, displayName: user.display_name || username }), { status: 200, headers });
}

async function memberLogout() {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set('Set-Cookie', 'tlc-member=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

async function memberRegister(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const email = (body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'Valid email required' }, 400);

  const db = env.DB;
  // Look up by email in people table — member type required
  const p = await db.prepare(
    "SELECT id, first_name, last_name, email FROM people WHERE LOWER(email)=? AND LOWER(member_type)='member' AND status='active' LIMIT 1"
  ).bind(email).first();

  // Always return success to avoid email enumeration
  if (!p) return json({ ok: true });

  // Check if they already have an active account
  const existing = await db.prepare('SELECT id FROM app_users WHERE people_id=? AND active=1').bind(p.id).first();
  if (existing) {
    // Send a reset/login link instead
    await db.prepare('UPDATE member_invite_tokens SET used=1 WHERE people_id=? AND used=0').bind(p.id).run();
    const token = generateToken();
    await db.prepare('INSERT INTO member_invite_tokens (token,people_id,email,expires_at) VALUES (?,?,?,?)')
      .bind(token, p.id, p.email, Date.now() + INVITE_TTL_MS).run();
    await sendInviteEmail(env, p.email, p.first_name || p.last_name, token, true);
    return json({ ok: true });
  }

  // New account flow
  await db.prepare('UPDATE member_invite_tokens SET used=1 WHERE people_id=? AND used=0').bind(p.id).run();
  const token = generateToken();
  await db.prepare('INSERT INTO member_invite_tokens (token,people_id,email,expires_at) VALUES (?,?,?,?)')
    .bind(token, p.id, p.email, Date.now() + INVITE_TTL_MS).run();
  await sendInviteEmail(env, p.email, p.first_name || p.last_name, token, false);
  return json({ ok: true });
}

async function memberSessionCheck(req, env) {
  const auth = await getMemberAuth(req, env);
  if (!auth) return json({ authenticated: false }, 200);
  const p = await env.DB.prepare('SELECT first_name, last_name FROM people WHERE id=?').bind(auth.peopleId).first();
  const name = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '';
  const resp = json({ authenticated: true, name });
  return refreshMemberCookie(resp, auth, env);
}

// ── Token verification ────────────────────────────────────────────────────────

const SET_PASSWORD_HTML = (token, error) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Set Password — TLC Member Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#EDF5F8;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;}
.card{background:#fff;border-radius:16px;padding:36px 32px;width:100%;max-width:400px;box-shadow:0 4px 24px rgba(10,60,92,.1);}
h1{font-size:1.4rem;color:#0A3C5C;margin-bottom:8px;}
p{color:#7A6E60;font-size:.9rem;margin-bottom:24px;}
label{display:block;font-size:.82rem;font-weight:600;color:#3D3530;margin-bottom:4px;}
input{width:100%;padding:10px 14px;border:1.5px solid #E8E0D0;border-radius:8px;font-size:.95rem;margin-bottom:16px;outline:none;}
input:focus{border-color:#0A3C5C;}
button{width:100%;padding:12px;background:#0A3C5C;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;}
button:hover{background:#2A5470;}
.err{color:#B85C3A;background:#FFF0EC;border:1px solid #B85C3A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:.85rem;}
</style>
</head>
<body>
<div class="card">
  <h1>Set Your Password</h1>
  <p>Choose a password for your TLC Member Portal account.</p>
  ${error ? `<div class="err">${escHtml(error)}</div>` : ''}
  <form method="POST">
    <label for="pw">Password (8+ characters)</label>
    <input type="password" id="pw" name="password" minlength="8" required autofocus>
    <label for="pw2">Confirm Password</label>
    <input type="password" id="pw2" name="confirm" minlength="8" required>
    <input type="hidden" name="token" value="${escHtml(token)}">
    <button type="submit">Create Account</button>
  </form>
</div>
</body>
</html>`;

const TOKEN_ERROR_HTML = (msg) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Link Expired — TLC Member Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Helvetica Neue',Arial,sans-serif;background:#EDF5F8;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px;}
.card{background:#fff;border-radius:16px;padding:36px 32px;width:100%;max-width:400px;box-shadow:0 4px 24px rgba(10,60,92,.1);text-align:center;}
h1{color:#B85C3A;font-size:1.3rem;margin-bottom:12px;}
p{color:#7A6E60;font-size:.9rem;margin-bottom:24px;}
a{color:#0A3C5C;font-weight:600;}
</style>
</head>
<body>
<div class="card">
  <h1>Link Expired</h1>
  <p>${escHtml(msg)}</p>
  <a href="/portal">Go to Member Portal</a>
</div>
</body>
</html>`;

async function verifyTokenGet(env, token) {
  const row = await env.DB.prepare('SELECT * FROM member_invite_tokens WHERE token=?').bind(token).first();
  if (!row || row.used || row.expires_at < Date.now()) {
    return html(TOKEN_ERROR_HTML('This invitation link has expired or already been used. Ask your administrator for a new one.'));
  }
  return html(SET_PASSWORD_HTML(token, null));
}

async function verifyTokenPost(req, env, token) {
  const row = await env.DB.prepare('SELECT * FROM member_invite_tokens WHERE token=?').bind(token).first();
  if (!row || row.used || row.expires_at < Date.now()) {
    return html(TOKEN_ERROR_HTML('This invitation link has expired or already been used.'));
  }

  let form;
  try { form = await req.formData(); } catch { return html(SET_PASSWORD_HTML(token, 'Invalid form submission.')); }
  const password = form.get('password') || '';
  const confirm  = form.get('confirm')  || '';

  if (password.length < 8) return html(SET_PASSWORD_HTML(token, 'Password must be at least 8 characters.'));
  if (password !== confirm) return html(SET_PASSWORD_HTML(token, 'Passwords do not match.'));

  const db = env.DB;
  const person = await db.prepare('SELECT first_name, last_name FROM people WHERE id=?').bind(row.people_id).first();
  const displayName = person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : '';
  const username = row.email.toLowerCase();
  const hash = await hashPassword(password);

  // Upsert user account
  const existing = await db.prepare('SELECT id FROM app_users WHERE people_id=?').bind(row.people_id).first();
  if (existing) {
    await db.prepare('UPDATE app_users SET password_hash=?,active=1,last_login=datetime(\'now\') WHERE id=?').bind(hash, existing.id).run();
  } else {
    await db.prepare(
      'INSERT OR REPLACE INTO app_users (username,password_hash,display_name,role,active,people_id) VALUES (?,?,?,\'member\',1,?)'
    ).bind(username, hash, displayName, row.people_id).run();
  }

  // Mark token used
  await db.prepare('UPDATE member_invite_tokens SET used=1 WHERE token=?').bind(token).run();

  // Set session cookie and redirect to portal
  const cookie = await memberCookieHeader(env, row.people_id);
  return new Response(null, {
    status: 302,
    headers: { 'Location': '/portal', 'Set-Cookie': cookie }
  });
}

// ── Authenticated API: Me ─────────────────────────────────────────────────────

async function memberGetMe(env, auth) {
  const db = env.DB;
  const p = await db.prepare(`
    SELECT p.id, p.first_name, p.last_name, p.email, p.phone,
           p.address1, p.address2, p.city, p.state, p.zip,
           p.photo_url, p.member_type, p.household_id,
           h.name AS household_name
    FROM people p
    LEFT JOIN households h ON h.id = p.household_id
    WHERE p.id = ?
  `).bind(auth.peopleId).first();
  if (!p) return json({ error: 'Not found' }, 404);
  return json(p);
}

async function memberPutMe(req, env, auth) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const { email, phone } = body || {};

  const db = env.DB;
  const updates = [];
  const vals = [];
  if (typeof email === 'string') { updates.push('email=?'); vals.push(email.trim()); }
  if (typeof phone === 'string') { updates.push('phone=?'); vals.push(phone.trim()); }
  if (!updates.length) return json({ ok: true });

  vals.push(auth.peopleId);
  await db.prepare(`UPDATE people SET ${updates.join(',')} WHERE id=?`).bind(...vals).run();
  return json({ ok: true });
}

// ── Authenticated API: Directory ──────────────────────────────────────────────

async function memberDirectory(env, auth) {
  const db = env.DB;
  const rows = await db.prepare(`
    SELECT p.id, p.first_name, p.last_name, p.photo_url,
           p.dir_hide_email, p.dir_hide_phone,
           p.email, p.phone, h.name AS household_name
    FROM people p
    LEFT JOIN households h ON h.id = p.household_id
    WHERE LOWER(p.member_type)='member' AND p.status='active'
    ORDER BY p.last_name, p.first_name
  `).all();
  const people = (rows.results || []).map(function(p) {
    return {
      id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      photo_url: p.photo_url || '',
      household_name: p.household_name || '',
      email: p.dir_hide_email ? '' : (p.email || ''),
      phone: p.dir_hide_phone ? '' : (p.phone || ''),
    };
  });
  return json(people);
}

// ── Authenticated API: Schedule ───────────────────────────────────────────────

async function memberSchedule(env, auth) {
  const db = env.DB;
  // Get person's breeze_id and name for matching against scheduler assignments
  const p = await db.prepare('SELECT breeze_id, first_name, last_name FROM people WHERE id=?').bind(auth.peopleId).first();
  if (!p) return json([]);

  const breezeId = p.breeze_id || '';
  const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();

  // Fetch schedule from KV
  let schedule = [];
  try {
    const raw = await env.RSVP_STORE.get('ws_schedule_v2');
    if (raw) schedule = JSON.parse(raw);
  } catch { return json([]); }

  if (!Array.isArray(schedule)) return json([]);

  const todayISO = new Date().toISOString().slice(0, 10);
  const assignments = [];

  for (const row of schedule) {
    const dateStr = row.date ? (typeof row.date === 'string' ? row.date : new Date(row.date).toISOString()) : '';
    const dateISO = dateStr.slice(0, 10);
    if (dateISO < todayISO) continue;

    if (row.type === 'special' && Array.isArray(row.services)) {
      for (const svc of row.services) {
        for (const [role, pid] of Object.entries(svc.assignments || {})) {
          if (pid && (pid === breezeId || pid === String(auth.peopleId))) {
            assignments.push({ date: dateISO, service: svc.time || 'Service', role, type: 'special', label: row.name || 'Special Service' });
          }
        }
      }
      continue;
    }

    if (row.type !== 'sunday') continue;
    const asns = row.assignments || {};
    for (const [role, svcs] of Object.entries(asns)) {
      for (const [svc, pid] of Object.entries(svcs || {})) {
        if (pid && (pid === breezeId || pid === String(auth.peopleId))) {
          assignments.push({ date: dateISO, service: svc, role, type: 'sunday', label: row.label || '' });
        }
      }
    }
  }

  assignments.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return json(assignments);
}

// ── Authenticated API: Prayer Requests ───────────────────────────────────────

async function memberPrayerGet(env) {
  const rows = await env.DB.prepare(`
    SELECT id, requester_name, request_text, status, submitted_at, source
    FROM prayer_requests
    WHERE status IN ('open','praying')
    ORDER BY submitted_at DESC
    LIMIT 50
  `).all();
  return json(rows.results || []);
}

async function memberPrayerPost(req, env, auth) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  const text = (body?.request_text || '').trim();
  if (!text) return json({ error: 'Request text required' }, 400);

  const db = env.DB;
  const p = await db.prepare('SELECT first_name, last_name, email FROM people WHERE id=?').bind(auth.peopleId).first();
  const name = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '';

  await db.prepare(
    'INSERT INTO prayer_requests (person_id,requester_name,requester_email,request_text,source,status) VALUES (?,?,?,?,\'member_portal\',\'open\')'
  ).bind(auth.peopleId, name, p?.email || '', text).run();

  return json({ ok: true });
}

// ── Authenticated API: Push Subscription ─────────────────────────────────────

async function memberPushSubscribe(req, env, auth) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  // Accept null to unsubscribe, or a PushSubscription-shaped object
  if (body === null || body === undefined) {
    await env.DB.prepare("UPDATE app_users SET push_subscription='' WHERE people_id=?").bind(auth.peopleId).run();
    return json({ ok: true });
  }

  const { endpoint, keys } = body || {};
  if (!endpoint || typeof endpoint !== 'string') return json({ error: 'Invalid subscription' }, 400);
  if (!keys?.p256dh || !keys?.auth) return json({ error: 'Invalid subscription keys' }, 400);

  const subJson = JSON.stringify({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  await env.DB.prepare("UPDATE app_users SET push_subscription=? WHERE people_id=?")
    .bind(subJson, auth.peopleId).run();
  return json({ ok: true });
}
