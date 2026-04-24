// ── ChMS (People & Giving) API handler ────────────────────────────────────────
import { html, json } from './auth.js';
import { brevoUpsertContact, brevoBulkSync, brevoGetListContacts } from './api-emails.js';
import { makeBreezeClient } from './breeze.js';
import { disambiguateHHName, isoWeekKey } from './api-utils.js';
import { handleHouseholdsApi } from './api-households.js';
import { handleImportApi } from './api-import.js';

export async function handleChmsApi(req, env, url, method, seg, role = 'admin') {
  const db = env.DB;

  // ── Role-based access control ────────────────────────────────────
  // Roles: admin | finance | staff | member
  //   admin   — full access
  //   finance — people CRUD + full giving; no attendance/register/followups
  //   staff   — people CRUD + attendance/register/followups/tags; no giving
  //   member  — GET people filtered to member_type='member' only
  const isAdmin   = role === 'admin';
  const isFinance = role === 'admin' || role === 'finance';
  const isStaff   = role === 'admin' || role === 'staff';
  const canEdit   = role === 'admin' || role === 'finance' || role === 'staff';

  // Giving and giving reports — finance+ only
  if ((seg.startsWith('giving') || seg.startsWith('reports/giving')) && !isFinance) {
    return json({ error: 'Access denied: giving data requires finance access' }, 403);
  }
  // Attendance, register, follow-ups, audit — staff+ only (NOT finance)
  if ((seg.startsWith('attendance') || seg.startsWith('register') ||
       seg.startsWith('followup') || seg.startsWith('audit')) && !isStaff) {
    return json({ error: 'Access denied' }, 403);
  }
  // Config (settings) — reads blocked for member; writes admin only
  if (seg.startsWith('config') && method !== 'GET' && !isAdmin) {
    return json({ error: 'Access denied: changing settings requires admin access' }, 403);
  }
  // Imports — admin only
  if (seg.startsWith('import/') && !isAdmin) {
    return json({ error: 'Access denied: imports require admin access' }, 403);
  }
  // Dev board — admin only
  if (seg === 'board' && !isAdmin) {
    return json({ error: 'Access denied' }, 403);
  }
  // Member role — GET people (filtered) + tags + member-types only; all writes blocked
  if (role === 'member') {
    const allowedSegs = seg.startsWith('people') || seg === 'tags' || seg === 'member-types';
    if (!allowedSegs) return json({ error: 'Access denied' }, 403);
    if (method !== 'GET') return json({ error: 'Access denied' }, 403);
  }
  // Write operations — require canEdit (not member)
  if (method !== 'GET' && !canEdit &&
      (seg.startsWith('people') || seg.startsWith('households') || seg.startsWith('tags') ||
       seg.startsWith('attendance') || seg.startsWith('register') || seg.startsWith('funds') ||
       seg.startsWith('organizations'))) {
    return json({ error: 'Access denied: editing requires staff or finance access' }, 403);
  }

  // ── Dashboard ────────────────────────────────────────────────────
  if (seg === 'dashboard' && method === 'GET') {
    // Membership counts by type — GROUP BY LOWER() to merge case variants (e.g. "member" vs "Member")
    const mtCfgRowDash = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const configuredTypesDash = mtCfgRowDash ? JSON.parse(mtCfgRowDash.value) : ['Member','Friend','Visitor','Inactive','Organization','Other'];
    const typeNameMapDash = {};
    for (const t of configuredTypesDash) typeNameMapDash[t.toLowerCase()] = t;
    const typeCounts = (await db.prepare(
      `SELECT LOWER(member_type) as member_type, COUNT(*) as n FROM people WHERE active=1 GROUP BY LOWER(member_type) ORDER BY n DESC`
    ).all()).results || [];
    for (const r of typeCounts) r.member_type = typeNameMapDash[r.member_type] || (r.member_type.charAt(0).toUpperCase() + r.member_type.slice(1));
    const totalPeople = typeCounts.reduce(function(s,r){return s+r.n;},0);
    const totalHouseholds = (await db.prepare(`SELECT COUNT(*) as n FROM households`).first())?.n || 0;
    // DB1: member-only count for dashboard stat card
    const memberCount = (await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)='member'`
    ).first())?.n || 0;
    // DB2: households that contain at least one member
    const memberHHCount = (await db.prepare(
      `SELECT COUNT(DISTINCT household_id) as n FROM people
       WHERE active=1 AND LOWER(member_type)='member'
         AND household_id IS NOT NULL AND household_id != ''`
    ).first())?.n || 0;
    // Added this month / this year
    const addedThisMonth = (await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE active=1 AND created_at >= date('now','start of month')`
    ).first())?.n || 0;
    const addedThisYear = (await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE active=1 AND created_at >= date('now','start of year')`
    ).first())?.n || 0;
    // Giving this year vs last year
    const givingThisYear = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=strftime('%Y','now')`
    ).first())?.total || 0;
    const givingLastYear = (await db.prepare(
      `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=cast(strftime('%Y','now')-1 as text)`
    ).first())?.total || 0;
    // DB4: Month-at-a-time birthdays & anniversaries (exclude visitor/inactive/other/org)
    const dashMonth = Math.max(1, Math.min(12, parseInt(url.searchParams.get('month') || '') || (new Date().getMonth() + 1)));
    const dashMonthStr = String(dashMonth).padStart(2, '0');
    const birthdays = (await db.prepare(
      `SELECT id, first_name, last_name, dob FROM people
       WHERE active=1 AND (status IS NULL OR status='active') AND dob != ''
         AND LOWER(member_type) = 'member'
         AND strftime('%m', dob) = ?
       ORDER BY strftime('%d', dob)`
    ).bind(dashMonthStr).all()).results || [];
    // DB4: fetch anniversaries with role+household so couples can be paired
    const annRows = (await db.prepare(
      `SELECT id, first_name, last_name, anniversary_date, family_role, household_id FROM people
       WHERE active=1 AND (status IS NULL OR status='active')
         AND (deceased=0 OR deceased IS NULL) AND anniversary_date != ''
         AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
         AND strftime('%m', anniversary_date) = ?
         AND NOT EXISTS (
           SELECT 1 FROM people p2
           WHERE p2.household_id=people.household_id AND p2.id!=people.id
             AND (p2.deceased=1 OR p2.status='deceased') AND p2.family_role IN ('head','spouse')
         )
       ORDER BY strftime('%d', anniversary_date), household_id,
         CASE family_role WHEN 'head' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END`
    ).bind(dashMonthStr).all()).results || [];
    // Group same-household + same-date pairs into one entry ("Bob & Alice Johnson")
    const _annRoleOrder = { head: 0, spouse: 1, child: 2, other: 3 };
    const annGroupMap = new Map();
    for (const p of annRows) {
      const key = (p.household_id && p.household_id !== '') ? `${p.household_id}:${p.anniversary_date}` : `_${p.id}`;
      if (!annGroupMap.has(key)) annGroupMap.set(key, []);
      annGroupMap.get(key).push(p);
    }
    // For still-unpaired entries, try to find the household partner who may not have anniversary_date set.
    // Common Breeze pattern: only the head of household has the date; spouse field is blank.
    const unpairedHHIds = [...new Set(
      [...annGroupMap.values()]
        .filter(g => g.length === 1 && g[0].household_id)
        .map(g => g[0].household_id)
    )];
    if (unpairedHHIds.length > 0) {
      const ph = unpairedHHIds.map(() => '?').join(',');
      const partners = (await db.prepare(
        `SELECT id, first_name, last_name, anniversary_date, family_role, household_id
         FROM people WHERE active=1 AND (status IS NULL OR status='active')
           AND (deceased=0 OR deceased IS NULL) AND household_id IN (${ph})`
      ).bind(...unpairedHHIds).all()).results || [];
      const partnersByHH = {};
      for (const s of partners) {
        if (!partnersByHH[s.household_id]) partnersByHH[s.household_id] = [];
        partnersByHH[s.household_id].push(s);
      }
      for (const group of annGroupMap.values()) {
        if (group.length !== 1 || !group[0].household_id) continue;
        const existing = group[0];
        const candidates = (partnersByHH[existing.household_id] || []).filter(s => s.id !== existing.id);
        // Prefer head/spouse roles; fall back to any household member
        const partner = candidates.find(s => s.family_role === 'head' || s.family_role === 'spouse') || candidates[0];
        if (partner) group.push({ ...partner, anniversary_date: existing.anniversary_date });
      }
    }
    const anniversaries = [...annGroupMap.values()]
      .map(group => {
        group.sort((a, b) => (_annRoleOrder[a.family_role] ?? 4) - (_annRoleOrder[b.family_role] ?? 4) || a.id - b.id);
        return {
          id: group[0].id,
          first_name: group.map(p => p.first_name || '').filter(Boolean).join(' & '),
          last_name: group[0].last_name,
          anniversary_date: group[0].anniversary_date,
          paired: group.length > 1
        };
      })
      .sort((a, b) => a.anniversary_date.slice(5) < b.anniversary_date.slice(5) ? -1 : 1);
    // Recent additions
    const recentPeople = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.member_type, p.created_at, h.name as household_name
       FROM people p LEFT JOIN households h ON p.household_id=h.id
       WHERE p.active=1 ORDER BY p.created_at DESC LIMIT 10`
    ).all()).results || [];
    // Most recent attendance
    // DB3: Last 2 services (show both Sunday services)
    const recentAttendance = (await db.prepare(
      `SELECT service_date, service_time, service_name, attendance
       FROM worship_services WHERE attendance > 0
       ORDER BY service_date DESC, service_time DESC LIMIT 2`
    ).all()).results || [];
    // Open follow-up items (pastoral queue)
    const followUpItems = (await db.prepare(
      `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
       LEFT JOIN people p ON p.id=f.person_id
       WHERE f.completed=0 ORDER BY f.created_at DESC LIMIT 50`
    ).all()).results || [];
    // First-time givers in the last 60 days (exclude dismissed records)
    const firstGivers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, MIN(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date)) as first_gift_date
       FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN people p ON p.id=ge.person_id
       WHERE p.first_gift_noted = 0
       GROUP BY ge.person_id
       HAVING first_gift_date >= date('now','-60 days')
       ORDER BY first_gift_date DESC LIMIT 20`
    ).all()).results || [];
    // People not seen recently (last_seen_date set more than 8 weeks ago, or never seen but added 8+ weeks ago)
    const notSeenRecently = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, last_seen_date, created_at FROM people
       WHERE active=1 AND (
         (last_seen_date != '' AND last_seen_date < date('now','-56 days'))
       ) ORDER BY last_seen_date ASC LIMIT 20`
    ).all()).results || [];
    // Weekly review queue (DC1): small batch of stale visitor/friend records due for triage.
    // "Stale" = never reviewed OR last_reviewed_at older than 365 days.
    const reviewQueueBatch = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone,
              created_at, last_reviewed_at, last_seen_date,
              (SELECT MAX(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date))
                 FROM giving_entries ge
                 JOIN giving_batches gb ON gb.id = ge.batch_id
                 WHERE ge.person_id = people.id) AS last_gift_date
       FROM people
       WHERE status='active'
         AND LOWER(member_type) NOT IN ('member','organization','')
         AND (last_reviewed_at = '' OR date(last_reviewed_at) < date('now','-365 days'))
       ORDER BY CASE WHEN last_reviewed_at = '' THEN 0 ELSE 1 END,
                last_reviewed_at ASC,
                created_at ASC
       LIMIT 5`
    ).all()).results || [];
    const reviewQueueTotal = (await db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE status='active'
         AND LOWER(member_type) NOT IN ('member','organization','')
         AND (last_reviewed_at = '' OR date(last_reviewed_at) < date('now','-365 days'))`
    ).first())?.n || 0;
    // New-contact follow-up queue (FU2/DB9)
    const followupQueueBatch = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone,
              first_contact_date, followup_status, followup_notes
       FROM people
       WHERE status='active'
         AND first_contact_date != ''
         AND (followup_status IS NULL OR followup_status != 'done')
         AND LOWER(member_type) NOT IN ('member','organization')
       ORDER BY first_contact_date DESC, id DESC
       LIMIT 5`
    ).all()).results || [];
    const followupQueueTotal = (await db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE status='active'
         AND first_contact_date != ''
         AND (followup_status IS NULL OR followup_status != 'done')
         AND LOWER(member_type) NOT IN ('member','organization')`
    ).first())?.n || 0;
    // Weekly task checklist (engagement_tasks) — auto-seed defaults on first access each week
    let weeklyTasks = [], weeklyTasksWeek = '';
    if (canEdit) {
      weeklyTasksWeek = isoWeekKey();
      weeklyTasks = (await db.prepare(
        'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
      ).bind(weeklyTasksWeek).all()).results || [];
      if (!weeklyTasks.length) {
        const defaults = [
          'Review new visitors in the people list',
          'Send newsletter to new contacts',
          'Follow up with first-time givers',
          'Follow up with prayer requests',
          'Check in with members not seen recently',
        ];
        for (let i = 0; i < defaults.length; i++) {
          await db.prepare('INSERT INTO engagement_tasks(title,week_key,sort_order) VALUES(?,?,?)').bind(defaults[i], weeklyTasksWeek, i).run();
        }
        weeklyTasks = (await db.prepare(
          'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
        ).bind(weeklyTasksWeek).all()).results || [];
      }
    }
    // Open prayer requests (FU1) — staff+ sees these
    let prayerOpen = [], prayerOpenTotal = 0;
    if (canEdit) {
      prayerOpen = (await db.prepare(
        `SELECT pr.id, pr.person_id, pr.requester_name, pr.requester_email, pr.request_text,
                pr.source, pr.status, pr.submitted_at,
                p.first_name, p.last_name
         FROM prayer_requests pr
         LEFT JOIN people p ON p.id = pr.person_id
         WHERE pr.status IN ('open','praying')
         ORDER BY pr.submitted_at DESC, pr.id DESC
         LIMIT 5`
      ).all()).results || [];
      prayerOpenTotal = (await db.prepare(
        "SELECT COUNT(*) AS n FROM prayer_requests WHERE status IN ('open','praying')"
      ).first())?.n || 0;
    }
    return json({
      totalPeople, totalHouseholds, memberCount, memberHHCount,
      addedThisMonth, addedThisYear, dashMonth,
      typeCounts,
      // giving data: finance+ only
      givingThisYear:  isFinance ? givingThisYear  : undefined,
      givingLastYear:  isFinance ? givingLastYear  : undefined,
      firstGivers:     isFinance ? firstGivers     : [],
      // pastoral data: staff+ only
      followUpItems:   isStaff  ? followUpItems   : [],
      recentAttendance: isStaff ? recentAttendance : [],
      birthdays, anniversaries, recentPeople, notSeenRecently,
      // engagement review queue (DC1/DB9): any editor can use
      reviewQueue:     canEdit ? reviewQueueBatch : [],
      reviewQueueTotal: canEdit ? reviewQueueTotal : 0,
      // new-contact follow-up queue (FU2/DB9)
      followupQueue:   canEdit ? followupQueueBatch : [],
      followupQueueTotal: canEdit ? followupQueueTotal : 0,
      // weekly task checklist
      weeklyTasks, weeklyTasksWeek,
      // prayer requests (FU1)
      prayerOpen, prayerOpenTotal
    });
  }

  // ── People ──────────────────────────────────────────────────────
  if (seg === 'people' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const mt = url.searchParams.get('member_type') || '';
    const tagId = url.searchParams.get('tag_id') || '';
    const tagIdsRaw = url.searchParams.get('tag_ids') || '';
    const archivedView = url.searchParams.get('archived') === '1';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 200);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const SORT_COLS = { last_name: 'p.last_name', first_name: 'p.first_name', member_type: 'p.member_type', created_at: 'p.created_at', household: 'h.name' };
    const sortCol = SORT_COLS[url.searchParams.get('sort') || ''] || 'p.last_name';
    const sortDir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';
    const like = '%' + q + '%';
    let where;
    const binds = [like, like, like, like];
    if (archivedView) {
      where = `p.status IN ('archived','deceased') AND LOWER(p.member_type) != 'organization'
        AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
    } else {
      where = `p.active=1 AND (p.status IS NULL OR p.status='active') AND LOWER(p.member_type) != 'organization'
        AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR p.phone LIKE ?)`;
    }
    // Member role can only see people with member_type='member'
    if (role === 'member') { where += ` AND LOWER(p.member_type)='member'`; }
    if (mt) { where += ' AND LOWER(p.member_type)=LOWER(?)'; binds.push(mt); }
    if (tagId) { where += ' AND p.id IN (SELECT person_id FROM person_tags WHERE tag_id=?)'; binds.push(tagId); }
    // Multi-tag AND filter: each tag must match separately
    const tagIds = tagIdsRaw ? tagIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    for (const tid of tagIds) {
      where += ' AND p.id IN (SELECT person_id FROM person_tags WHERE tag_id=?)';
      binds.push(tid);
    }
    // Missing-field AND filter: validate each value against allowlist to prevent injection
    const missingClauses = {
      dob:          `(p.dob IS NULL OR p.dob='')`,
      gender:       `(p.gender IS NULL OR p.gender='')`,
      photo:        `(p.photo_url IS NULL OR p.photo_url='')`,
      anniversary:  `(p.anniversary_date IS NULL OR p.anniversary_date='')`,
      baptism:      `(p.baptism_date IS NULL OR p.baptism_date='')`,
      confirmation: `(p.confirmation_date IS NULL OR p.confirmation_date='')`,
      email:        `(p.email IS NULL OR p.email='')`,
      phone:        `(p.phone IS NULL OR p.phone='')`,
      address:      `(p.address1 IS NULL OR p.address1='')`,
    };
    const missingFieldsRaw = url.searchParams.get('missing_fields') || '';
    for (const f of missingFieldsRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (missingClauses[f]) where += ' AND ' + missingClauses[f];
    }
    // Total count
    const countRow = await db.prepare(`SELECT COUNT(*) as n FROM people p WHERE ${where}`).bind(...binds).first();
    const total = countRow?.n || 0;
    // Paged results
    const rows = (await db.prepare(
      `SELECT p.*, h.name as household_name FROM people p
       LEFT JOIN households h ON p.household_id=h.id
       WHERE ${where} ORDER BY ${sortCol} ${sortDir}, p.last_name ASC, p.first_name ASC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all()).results || [];
    // Batch-load tags for all returned people in a single query (avoids N+1)
    const ids = rows.map(r => r.id);
    const tagsByPerson = {};
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const allTagRows = (await db.prepare(
        `SELECT pt.person_id, t.id, t.name, t.color FROM tags t
         JOIN person_tags pt ON pt.tag_id=t.id WHERE pt.person_id IN (${ph})`
      ).bind(...ids).all()).results || [];
      for (const tr of allTagRows) {
        if (!tagsByPerson[tr.person_id]) tagsByPerson[tr.person_id] = [];
        tagsByPerson[tr.person_id].push({ id: tr.id, name: tr.name, color: tr.color });
      }
    }
    // HQ4: disambiguate household names that are shared across multiple households
    const hhIdsUniq = [...new Set(rows.map(r => r.household_id).filter(Boolean))];
    const hhDisambigMap = {};
    if (hhIdsUniq.length) {
      const ph2 = hhIdsUniq.map(() => '?').join(',');
      const dRows = (await db.prepare(
        `SELECT h.id, h.name,
         COALESCE(
           (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 AND p2.family_role='head' LIMIT 1),
           (SELECT p2.first_name FROM people p2 WHERE p2.household_id=h.id AND p2.active=1 ORDER BY p2.id LIMIT 1)
         ) as head_first_name
         FROM households h WHERE h.id IN (${ph2})
         AND LOWER(h.name) IN (SELECT LOWER(name) FROM households GROUP BY LOWER(name) HAVING COUNT(*)>1)`
      ).bind(...hhIdsUniq).all()).results || [];
      for (const r of dRows) hhDisambigMap[r.id] = disambiguateHHName(r.name, r.head_first_name);
    }
    const people = rows.map(p => ({
      ...p,
      tags: tagsByPerson[p.id] || [],
      household_display_name: hhDisambigMap[p.household_id] || p.household_name || null
    }));
    return json({ people, total, offset, limit });
  }

  if (seg === 'people' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    // FU2: auto-set first_contact_date = today for new manually-added people
    // (not imported from Breeze — those keep their Breeze-supplied dates or blank).
    // Explicit empty string in body overrides the auto-default.
    let firstContactDate = b.first_contact_date;
    if (firstContactDate === undefined || firstContactDate === null) {
      firstContactDate = b.breeze_id ? '' : new Date().toISOString().slice(0,10);
    }
    const r = await db.prepare(
      `INSERT INTO people (first_name,last_name,email,phone,address1,address2,city,state,zip,
       member_type,dob,baptism_date,confirmation_date,anniversary_date,death_date,deceased,
       household_id,family_role,photo_url,notes,breeze_id,gender,marital_status,first_contact_date,sms_opt_in)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
           b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
           b.member_type||'visitor',b.dob||'',b.baptism_date||'',
           b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
           b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',b.breeze_id||'',
           b.gender||'',b.marital_status||'', firstContactDate||'', b.sms_opt_in?1:0
    ).run();
    const personId = r.meta?.last_row_id;
    if (Array.isArray(b.tag_ids)) {
      for (const tid of b.tag_ids) {
        try { await db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(personId,tid).run(); } catch {}
      }
    }
    return json({ ok: true, id: personId });
  }

  if (seg === 'people/bulk-member-type' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Boolean) : [];
    const mt = b.member_type || '';
    if (!ids.length || !mt) return json({ error: 'ids and member_type required' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    await db.prepare(`UPDATE people SET member_type=? WHERE id IN (${placeholders})`).bind(mt, ...ids).run();
    return json({ ok: true, updated: ids.length });
  }

  const pmatch = seg.match(/^people\/(\d+)$/);
  if (pmatch) {
    const pid = parseInt(pmatch[1]);
    if (method === 'GET') {
      const p = await db.prepare(
        `SELECT p.*, h.name as household_name FROM people p
         LEFT JOIN households h ON p.household_id=h.id WHERE p.id=?`
      ).bind(pid).first();
      if (!p) return json({ error: 'Not found' }, 404);
      // Member role can only view actual members
      if (role === 'member' && (p.member_type || '').toLowerCase() !== 'member') {
        return json({ error: 'Not found' }, 404);
      }
      const tags = (await db.prepare(
        `SELECT t.id,t.name,t.color FROM tags t JOIN person_tags pt ON pt.tag_id=t.id WHERE pt.person_id=?`
      ).bind(pid).all()).results || [];
      let giving12mo = 0;
      if (isFinance) {
        const giving12 = await db.prepare(
          `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
           JOIN giving_batches gb ON ge.batch_id=gb.id
           WHERE ge.person_id=? AND gb.batch_date >= date('now','-12 months')`
        ).bind(pid).first();
        giving12mo = giving12?.total || 0;
      }
      // HQ4: disambiguate if this household name is shared with another household
      let household_display_name = p.household_name || null;
      if (p.household_id && p.household_name) {
        const dup2 = await db.prepare(`SELECT COUNT(*) as n FROM households WHERE LOWER(name)=LOWER(?) AND id!=?`).bind(p.household_name, p.household_id).first();
        if (dup2?.n > 0) {
          const hd = await db.prepare(`SELECT first_name FROM people WHERE household_id=? AND active=1 ORDER BY CASE family_role WHEN 'head' THEN 0 ELSE 1 END, id LIMIT 1`).bind(p.household_id).first();
          if (hd?.first_name) household_display_name = disambiguateHHName(p.household_name, hd.first_name);
        }
      }
      return json({ ...p, tags, giving_12mo: giving12mo, household_display_name });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      // Capture old values for audit log
      const oldPerson = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
      await db.prepare(
        `UPDATE people SET first_name=?,last_name=?,email=?,phone=?,address1=?,address2=?,
         city=?,state=?,zip=?,member_type=?,dob=?,baptism_date=?,confirmation_date=?,
         anniversary_date=?,death_date=?,deceased=?,household_id=?,family_role=?,photo_url=?,notes=?,
         public_directory=?,envelope_number=?,last_seen_date=?,gender=?,marital_status=?,
         dir_hide_address=?,dir_hide_phone=?,dir_hide_email=?,baptized=?,confirmed=?,sms_opt_in=? WHERE id=?`
      ).bind(b.first_name||'',b.last_name||'',b.email||'',b.phone||'',
             b.address1||'',b.address2||'',b.city||'',b.state||'MO',b.zip||'',
             b.member_type||'visitor',b.dob||'',b.baptism_date||'',
             b.confirmation_date||'',b.anniversary_date||'',b.death_date||'',b.deceased?1:0,
             b.household_id||null,b.family_role||'',b.photo_url||'',b.notes||'',
             b.public_directory!=null?(b.public_directory?1:0):1,
             b.envelope_number||'',b.last_seen_date||'',b.gender||'',b.marital_status||'',
             b.dir_hide_address?1:0, b.dir_hide_phone?1:0, b.dir_hide_email?1:0,
             b.baptized?1:0, b.confirmed?1:0, b.sms_opt_in?1:0, pid
      ).run();
      if (Array.isArray(b.tag_ids)) {
        await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
        for (const tid of b.tag_ids) {
          try { await db.prepare('INSERT OR IGNORE INTO person_tags(person_id,tag_id) VALUES(?,?)').bind(pid,tid).run(); } catch {}
        }
      }
      // Propagate anniversary_date to household spouse if they don't have one set
      if (b.anniversary_date && b.household_id && ['head','spouse'].includes(b.family_role||'')) {
        try {
          await db.prepare(
            `UPDATE people SET anniversary_date=?
             WHERE household_id=? AND id!=? AND (anniversary_date='' OR anniversary_date IS NULL)
               AND family_role IN ('head','spouse') AND active=1`
          ).bind(b.anniversary_date, b.household_id, pid).run();
        } catch {}
      }
      // Write audit log entries for changed fields
      if (oldPerson) {
        const personName = [(oldPerson.first_name||b.first_name||''), (oldPerson.last_name||b.last_name||'')].filter(Boolean).join(' ');
        const auditFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip',
          'member_type','dob','baptism_date','confirmation_date','anniversary_date','death_date','deceased',
          'household_id','family_role','notes','public_directory','envelope_number','last_seen_date',
          'gender','marital_status'];
        const auditStmt = db.prepare(
          `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
        );
        const ops = [];
        for (const f of auditFields) {
          const ov = String(oldPerson[f] ?? '');
          const nv = String(b[f] ?? '');
          if (ov !== nv) ops.push(auditStmt.bind('update','person',pid,personName,f,ov,nv));
        }
        if (ops.length) await db.batch(ops);
      }
      // Auto-sync to Brevo if email changed and person is a member
      const newEmail = (b.email || '').trim().toLowerCase();
      const oldEmail = (oldPerson?.email || '').trim().toLowerCase();
      if (newEmail && newEmail !== oldEmail && (b.member_type || '').toLowerCase() === 'member') {
        brevoUpsertContact(env, b.email.trim(), b.first_name || '', b.last_name || '').catch(() => {});
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const hard = url.searchParams.get('hard') === 'true';
      if (hard && !isAdmin) return json({ error: 'Access denied: permanent delete requires admin access' }, 403);
      if (hard) {
        await db.prepare('DELETE FROM person_tags WHERE person_id=?').bind(pid).run();
        await db.prepare('DELETE FROM people WHERE id=?').bind(pid).run();
      } else {
        await db.prepare('UPDATE people SET active=0 WHERE id=?').bind(pid).run();
      }
      return json({ ok: true });
    }
  }

  // ── Archive / unarchive / deceased ──────────────────────────────────
  const archiveMatch = seg.match(/^people\/(\d+)\/(archive|unarchive|deceased)$/);
  if (archiveMatch && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const pid = parseInt(archiveMatch[1]);
    const action = archiveMatch[2];
    const person = await db.prepare('SELECT * FROM people WHERE id=?').bind(pid).first();
    if (!person) return json({ error: 'Person not found' }, 404);

    if (action === 'archive') {
      await db.prepare(`UPDATE people SET status='archived', active=0 WHERE id=?`).bind(pid).run();
      await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
        VALUES('update','person',?,?,?,'active','archived')`
      ).bind(pid, `${person.first_name} ${person.last_name}`, 'status').run();
    } else if (action === 'unarchive') {
      await db.prepare(`UPDATE people SET status='active', active=1, deceased=0 WHERE id=?`).bind(pid).run();
      await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
        VALUES('update','person',?,?,?,'archived','active')`
      ).bind(pid, `${person.first_name} ${person.last_name}`, 'status').run();
    } else if (action === 'deceased') {
      if (!isAdmin && !isStaff) return json({ error: 'Access denied' }, 403);
      const today = new Date().toISOString().slice(0, 10);
      await db.prepare(`UPDATE people SET status='deceased', deceased=1, death_date=?, active=0 WHERE id=?`)
        .bind(today, pid).run();
      await db.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value)
        VALUES('update','person',?,?,?,'active','deceased')`
      ).bind(pid, `${person.first_name} ${person.last_name}`, 'status').run();
      // If this person was the household head, promote spouse or first remaining active member
      if (person.household_id && person.family_role === 'head') {
        const members = (await db.prepare(
          `SELECT id, family_role FROM people
           WHERE household_id=? AND id!=? AND active=1 AND (status IS NULL OR status='active')
           ORDER BY CASE family_role WHEN 'spouse' THEN 0 ELSE 1 END, id`
        ).bind(person.household_id, pid).all()).results || [];
        if (members.length > 0) {
          await db.prepare(`UPDATE people SET family_role='head' WHERE id=?`).bind(members[0].id).run();
        }
      }
    }
    return json({ ok: true });
  }

  // ── Brevo newsletter sync (EM1) ──────────────────────────────────────────
  if (seg === 'brevo/sync-contact' && method === 'POST') {
    if (!isStaff) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!b.email) return json({ error: 'email required' }, 400);
    const result = await brevoUpsertContact(env, b.email, b.first_name || '', b.last_name || '');
    return json(result);
  }

  if (seg === 'brevo/bulk-sync' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const members = (await db.prepare(
      `SELECT first_name, last_name, email FROM people
       WHERE active=1 AND (status IS NULL OR status='active')
         AND LOWER(member_type)='member' AND email != ''`
    ).all()).results || [];
    if (!members.length) return json({ ok: true, count: 0, message: 'No members with email addresses found.' });
    const result = await brevoBulkSync(env, members.map(m => ({ email: m.email, firstName: m.first_name, lastName: m.last_name })));
    return json(result);
  }

  if (seg === 'brevo/reconcile' && method === 'GET') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const members = (await db.prepare(
      `SELECT id, first_name, last_name, email FROM people
       WHERE active=1 AND (status IS NULL OR status='active')
         AND LOWER(member_type)='member' AND email != ''
       ORDER BY last_name, first_name`
    ).all()).results || [];
    const brevoResult = await brevoGetListContacts(env);
    if (!brevoResult.ok) return json({ error: brevoResult.error }, 502);
    const brevoSet = new Set(brevoResult.emails);
    const chmsSet = new Set(members.map(m => m.email.toLowerCase()));
    const missingFromBrevo = members.filter(m => !brevoSet.has(m.email.toLowerCase()));
    const inBrevoNotChms = brevoResult.emails.filter(e => !chmsSet.has(e));
    return json({
      chms_member_count: members.length,
      brevo_list_count: brevoResult.emails.length,
      missing_from_brevo: missingFromBrevo,
      in_brevo_not_chms: inBrevoNotChms,
    });
  }

  // ── Person photo upload ──────────────────────────────────────────
  const photoMatch = seg.match(/^people\/(\d+)\/photo$/);
  if (photoMatch && method === 'POST') {
    if (!isStaff) return json({ error: 'Insufficient permissions' }, 403);
    if (!env.PHOTOS) return json({ error: 'Photo storage not configured — create R2 bucket tlc-chms-photos' }, 503);
    const pid = parseInt(photoMatch[1]);
    let file;
    try { const fd = await req.formData(); file = fd.get('photo'); } catch { return json({ error: 'Invalid form data' }, 400); }
    if (!file || !file.size) return json({ error: 'No file provided' }, 400);
    const ct = file.type || 'image/jpeg';
    if (!ct.startsWith('image/')) return json({ error: 'File must be an image' }, 400);
    const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
    const r2Key = `people/${pid}/photo.${ext}`;
    await env.PHOTOS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: ct } });
    const photoUrl = `/admin/r2photo/${r2Key}`;
    await db.prepare('UPDATE people SET photo_url=? WHERE id=?').bind(photoUrl, pid).run();
    return json({ ok: true, photo_url: photoUrl });
  }

  // ── Household photo upload ───────────────────────────────────────
  const hhPhotoMatch = seg.match(/^households\/(\d+)\/photo$/);
  if (hhPhotoMatch && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    if (!env.PHOTOS) return json({ error: 'Photo storage not configured' }, 503);
    const hid = parseInt(hhPhotoMatch[1]);
    let file;
    try { const fd = await req.formData(); file = fd.get('photo'); } catch { return json({ error: 'Invalid form data' }, 400); }
    if (!file || !file.size) return json({ error: 'No file provided' }, 400);
    const ct = file.type || 'image/jpeg';
    if (!ct.startsWith('image/')) return json({ error: 'File must be an image' }, 400);
    const ext = ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg';
    const r2Key = `households/${hid}/photo.${ext}`;
    await env.PHOTOS.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: ct } });
    const photoUrl = `/admin/r2photo/${r2Key}`;
    await db.prepare('UPDATE households SET photo_url=? WHERE id=?').bind(photoUrl, hid).run();
    return json({ ok: true, photo_url: photoUrl });
  }

  // ── Households / Organizations / Tags / Funds → api-households.js ──
  if (seg.startsWith('households') || seg.startsWith('organizations') ||
      seg.startsWith('tags') || seg.startsWith('funds')) {
    const result = await handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, canEdit);
    if (result !== null) return result;
  }

  // ── Follow-up items ─────────────────────────────────────────────
  if (seg === 'followup' && method === 'GET') {
    const completed = url.searchParams.get('completed') === '1' ? 1 : 0;
    const personId = url.searchParams.get('person_id');
    let rows;
    if (personId) {
      rows = (await db.prepare(
        `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
         LEFT JOIN people p ON p.id=f.person_id
         WHERE f.person_id=? ORDER BY f.created_at DESC LIMIT 100`
      ).bind(parseInt(personId)).all()).results || [];
    } else {
      rows = (await db.prepare(
        `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
         LEFT JOIN people p ON p.id=f.person_id
         WHERE f.completed=? ORDER BY f.created_at DESC LIMIT 200`
      ).bind(completed).all()).results || [];
    }
    return json({ items: rows });
  }
  if (seg === 'followup' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO follow_up_items(person_id,type,notes,due_date) VALUES(?,?,?,?)`
    ).bind(b.person_id||null, b.type||'general', b.notes||'', b.due_date||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }
  const fmatch = seg.match(/^followup\/(\d+)$/);
  if (fmatch) {
    const fid = parseInt(fmatch[1]);
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      if (b.completed) {
        await db.prepare(`UPDATE follow_up_items SET completed=1, completed_at=datetime('now') WHERE id=?`).bind(fid).run();
      } else {
        await db.prepare(
          `UPDATE follow_up_items SET type=?,notes=?,due_date=?,completed=0,completed_at='' WHERE id=?`
        ).bind(b.type||'general', b.notes||'', b.due_date||'', fid).run();
      }
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM follow_up_items WHERE id=?').bind(fid).run();
      return json({ ok: true });
    }
  }
  // Audit log
  if (seg === 'audit' && method === 'GET') {
    const entityId = url.searchParams.get('entity_id');
    const entityType = url.searchParams.get('entity_type') || 'person';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
    let rows;
    if (entityId) {
      rows = (await db.prepare(
        `SELECT * FROM audit_log WHERE entity_type=? AND entity_id=? ORDER BY ts DESC LIMIT ?`
      ).bind(entityType, parseInt(entityId), limit).all()).results || [];
    } else {
      rows = (await db.prepare(
        `SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?`
      ).bind(limit).all()).results || [];
    }
    return json({ entries: rows });
  }
  if (seg === 'audit/undo' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const entry = await db.prepare('SELECT * FROM audit_log WHERE id=?').bind(b.id).first();
    if (!entry) return json({ error: 'Audit entry not found' }, 404);
    if (entry.entity_type !== 'person') return json({ error: 'Only person edits can be undone' }, 400);
    // Revert: set the field back to old_value
    const allowedFields = ['first_name','last_name','email','phone','address1','address2','city','state','zip',
      'member_type','dob','baptism_date','confirmation_date','anniversary_date','death_date','deceased',
      'notes','public_directory','envelope_number','last_seen_date'];
    if (!allowedFields.includes(entry.field)) return json({ error: 'Cannot undo this field' }, 400);
    await db.prepare(`UPDATE people SET ${entry.field}=? WHERE id=?`)
      .bind(entry.old_value, entry.entity_id).run();
    // Log the undo itself
    await db.prepare(
      `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
    ).bind('undo','person',entry.entity_id,entry.person_name,entry.field,entry.new_value,entry.old_value).run();
    return json({ ok: true });
  }

  // ── Giving Entries — list for a person ──────────────────────────
  if (seg === 'giving' && method === 'GET') {
    const personId = url.searchParams.get('person_id');
    const year     = url.searchParams.get('year') || '';
    const limit    = Math.min(parseInt(url.searchParams.get('limit') || '500'), 2000);
    if (!personId) return json({ error: 'person_id required' }, 400);
    let sql = `SELECT ge.id, ge.amount, ge.method, ge.check_number, ge.notes,
                ge.fund_id, ge.batch_id, gb.closed as batch_closed, gb.description as batch_description,
                COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as contribution_date,
                f.name as fund_name
               FROM giving_entries ge
               JOIN funds f ON ge.fund_id=f.id
               JOIN giving_batches gb ON ge.batch_id=gb.id
               WHERE ge.person_id=?`;
    const binds = [parseInt(personId)];
    if (year) {
      sql += ` AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?`;
      binds.push(year);
    }
    sql += ` ORDER BY COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) DESC, ge.id DESC LIMIT ?`;
    binds.push(limit);
    const entries = (await db.prepare(sql).bind(...binds).all()).results || [];
    return json({ entries });
  }

  // ── Giving Batches ───────────────────────────────────────────────
  if (seg === 'giving/batches' && method === 'GET') {
    const status = url.searchParams.get('status') || 'all';
    let sql = `SELECT gb.*, COUNT(ge.id) as entry_count, COALESCE(SUM(ge.amount),0) as total_cents
               FROM giving_batches gb LEFT JOIN giving_entries ge ON ge.batch_id=gb.id`;
    const binds = [];
    if (status === 'open') { sql += ' WHERE gb.closed=0'; }
    else if (status === 'closed') { sql += ' WHERE gb.closed=1'; }
    sql += ' GROUP BY gb.id ORDER BY gb.batch_date DESC, gb.id DESC LIMIT 100';
    const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
    return json({ batches: rows });
  }

  if (seg === 'giving/batches' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO giving_batches (batch_date,description) VALUES (?,?)`
    ).bind(b.batch_date||'',b.description||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  const batchMatch = seg.match(/^giving\/batches\/(\d+)$/);
  if (batchMatch) {
    const bid = parseInt(batchMatch[1]);
    if (method === 'GET') {
      const batch = await db.prepare('SELECT * FROM giving_batches WHERE id=?').bind(bid).first();
      if (!batch) return json({ error: 'Not found' }, 404);
      const entries = (await db.prepare(
        `SELECT ge.*, f.name as fund_name,
         COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
         FROM giving_entries ge
         JOIN funds f ON ge.fund_id=f.id
         LEFT JOIN people p ON ge.person_id=p.id
         WHERE ge.batch_id=? ORDER BY ge.id`
      ).bind(bid).all()).results || [];
      return json({ ...batch, entries });
    }
    if (method === 'PUT') {
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await db.prepare(`UPDATE giving_batches SET batch_date=?,description=?,closed=? WHERE id=?`)
        .bind(b.batch_date||'',b.description||'',b.closed?1:0,bid).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const batch = await db.prepare('SELECT closed FROM giving_batches WHERE id=?').bind(bid).first();
      if (!batch) return json({ error: 'Not found' }, 404);
      if (batch.closed) return json({ error: 'Cannot delete a closed batch.' }, 409);
      await db.prepare('DELETE FROM giving_entries WHERE batch_id=?').bind(bid).run();
      await db.prepare('DELETE FROM giving_batches WHERE id=?').bind(bid).run();
      return json({ ok: true });
    }
  }

  const entriesMatch = seg.match(/^giving\/batches\/(\d+)\/entries$/);
  if (entriesMatch) {
    const bid = parseInt(entriesMatch[1]);
    if (method === 'GET') {
      const entries = (await db.prepare(
        `SELECT ge.*, f.name as fund_name,
         COALESCE(p.first_name||' '||p.last_name,'(anonymous)') as person_name
         FROM giving_entries ge
         JOIN funds f ON ge.fund_id=f.id
         LEFT JOIN people p ON ge.person_id=p.id
         WHERE ge.batch_id=? ORDER BY ge.id`
      ).bind(bid).all()).results || [];
      return json({ entries });
    }
    if (method === 'POST') {
      const batch = await db.prepare('SELECT closed FROM giving_batches WHERE id=?').bind(bid).first();
      if (!batch) return json({ error: 'Batch not found' }, 404);
      if (batch.closed) return json({ error: 'Batch is closed.' }, 409);
      let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
      const r = await db.prepare(
        `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(bid,b.person_id||null,b.fund_id,amtCents,b.method||'cash',b.check_number||'',b.notes||'').run();
      return json({ ok: true, id: r.meta?.last_row_id });
    }
  }

  const entryDelMatch = seg.match(/^giving\/entries\/(\d+)$/);
  if (entryDelMatch && method === 'PUT') {
    const eid = parseInt(entryDelMatch[1]);
    const entry = await db.prepare(
      `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
    ).bind(eid).first();
    if (!entry) return json({ error: 'Not found' }, 404);
    if (entry.closed) return json({ error: 'Batch is closed.' }, 409);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const amtCents = Math.round(parseFloat(b.amount || 0) * 100);
    if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
    await db.prepare(
      `UPDATE giving_entries SET fund_id=?,amount=?,method=?,check_number=?,notes=?,contribution_date=? WHERE id=?`
    ).bind(parseInt(b.fund_id), amtCents, b.method||'cash', b.check_number||'', b.notes||'', b.date||'', eid).run();
    return json({ ok: true });
  }
  if (entryDelMatch && method === 'DELETE') {
    const eid = parseInt(entryDelMatch[1]);
    const entry = await db.prepare(
      `SELECT ge.id, gb.closed FROM giving_entries ge JOIN giving_batches gb ON ge.batch_id=gb.id WHERE ge.id=?`
    ).bind(eid).first();
    if (!entry) return json({ error: 'Not found' }, 404);
    if (entry.closed) return json({ error: 'Batch is closed.' }, 409);
    await db.prepare('DELETE FROM giving_entries WHERE id=?').bind(eid).run();
    return json({ ok: true });
  }

  // ── Quick Gift Entry (auto-creates open batch for the month) ─────
  if (seg === 'giving/quick-entry' && method === 'POST') {
    let b = {}; try { b = await req.json(); } catch {}
    const { person_id, fund_id, amount, method: payMethod, date, notes, check_number } = b;
    if (!fund_id || !amount || !date) return json({ error: 'fund_id, amount, and date required' }, 400);
    const amtCents = Math.round(parseFloat(amount) * 100);
    if (amtCents <= 0) return json({ error: 'Amount must be positive' }, 400);
    // Find or create an open manual-entry batch for this month
    const monthKey  = String(date).slice(0, 7);
    const batchDesc = 'Manual Entry ' + monthKey;
    let existBatch = await db.prepare(
      `SELECT id FROM giving_batches WHERE description=? AND closed=0 LIMIT 1`
    ).bind(batchDesc).first();
    let batchId;
    if (existBatch) {
      batchId = existBatch.id;
    } else {
      const br = await db.prepare(
        `INSERT INTO giving_batches (batch_date, description, closed) VALUES (?,?,0)`
      ).bind(date, batchDesc).run();
      batchId = br.meta?.last_row_id;
    }
    const er = await db.prepare(
      `INSERT INTO giving_entries (batch_id,person_id,fund_id,amount,method,check_number,notes,contribution_date)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(batchId, person_id ? parseInt(person_id) : null, parseInt(fund_id),
           amtCents, payMethod || 'cash', check_number || '', notes || '', date).run();
    return json({ ok: true, id: er.meta?.last_row_id, batch_id: batchId });
  }

  // ── Reports ──────────────────────────────────────────────────────
  if (seg === 'reports/people-insights' && method === 'GET') {
    const now = new Date();
    // 24-month window start (first day of month 24 months ago)
    const cutoff24mo = new Date(now.getFullYear() - 2, now.getMonth(), 1).toISOString().slice(0, 10);
    const cutoff5yr  = String(now.getFullYear() - 4);

    const [
      newContactsRaw,
      typeTrendRaw,
      ageRows,
      genderRows,
      hhSizeRaw,
      pipelineRows,
      noHHRow,
    ] = await Promise.all([
      // New contacts by month (last 24 months) — use first_contact_date, fall back to created_at
      db.prepare(
        `SELECT substr(COALESCE(NULLIF(first_contact_date,''), created_at), 1, 7) AS month,
                COUNT(*) AS n
         FROM people
         WHERE status='active' AND LOWER(member_type) != 'organization'
           AND COALESCE(NULLIF(first_contact_date,''), created_at) >= ?
         GROUP BY month ORDER BY month ASC`
      ).bind(cutoff24mo).all().then(r => r.results || []),

      // Member-type by year of first contact (last 5 years)
      db.prepare(
        `SELECT substr(COALESCE(NULLIF(first_contact_date,''), created_at), 1, 4) AS year,
                member_type, COUNT(*) AS n
         FROM people
         WHERE status='active' AND LOWER(member_type) != 'organization'
           AND substr(COALESCE(NULLIF(first_contact_date,''), created_at), 1, 4) >= ?
         GROUP BY year, member_type ORDER BY year ASC, n DESC`
      ).bind(cutoff5yr).all().then(r => r.results || []),

      // Age distribution
      db.prepare(
        `SELECT CASE
           WHEN dob='' OR dob IS NULL THEN 'unknown'
           WHEN (julianday('now')-julianday(dob))/365.25 < 18 THEN 'under_18'
           WHEN (julianday('now')-julianday(dob))/365.25 < 30 THEN 'a18_29'
           WHEN (julianday('now')-julianday(dob))/365.25 < 45 THEN 'a30_44'
           WHEN (julianday('now')-julianday(dob))/365.25 < 65 THEN 'a45_64'
           ELSE 'a65_plus'
         END AS age_group, COUNT(*) AS n
         FROM people
         WHERE status='active' AND LOWER(member_type) != 'organization'
         GROUP BY age_group`
      ).all().then(r => r.results || []),

      // Gender
      db.prepare(
        `SELECT CASE WHEN gender='' OR gender IS NULL THEN 'Unknown' ELSE gender END AS g,
                COUNT(*) AS n
         FROM people
         WHERE status='active' AND LOWER(member_type) != 'organization'
         GROUP BY g ORDER BY n DESC`
      ).all().then(r => r.results || []),

      // Household sizes
      db.prepare(
        `SELECT household_id, COUNT(*) AS size
         FROM people
         WHERE status='active' AND household_id IS NOT NULL AND household_id != 0
         GROUP BY household_id`
      ).all().then(r => r.results || []),

      // Baptism/confirmation pipeline (members only)
      db.prepare(
        `SELECT baptized, confirmed, COUNT(*) AS n
         FROM people
         WHERE status='active' AND LOWER(member_type)='member'
         GROUP BY baptized, confirmed`
      ).all().then(r => r.results || []),

      // People with no household (active non-org)
      db.prepare(
        `SELECT COUNT(*) AS n FROM people
         WHERE status='active' AND LOWER(member_type) != 'organization'
           AND (household_id IS NULL OR household_id = 0)`
      ).first(),
    ]);

    // Build household size buckets
    const hhBuckets = { single: 0, couple: 0, small: 0, large: 0 };
    for (const r of hhSizeRaw) {
      const s = r.size || 0;
      if (s === 1)       hhBuckets.single++;
      else if (s === 2)  hhBuckets.couple++;
      else if (s <= 4)   hhBuckets.small++;
      else               hhBuckets.large++;
    }
    hhBuckets.no_household = noHHRow?.n || 0;

    // Sacramental pipeline
    const pipeline = { neither: 0, baptized_only: 0, confirmed_only: 0, both: 0 };
    for (const r of pipelineRows) {
      const b = r.baptized ? 1 : 0, c = r.confirmed ? 1 : 0;
      if (!b && !c) pipeline.neither += r.n;
      else if (b && !c) pipeline.baptized_only += r.n;
      else if (!b && c) pipeline.confirmed_only += r.n;
      else pipeline.both += r.n;
    }

    // Normalise age groups into ordered array
    const ageOrder = [
      { key: 'under_18', label: 'Under 18' }, { key: 'a18_29', label: '18–29' },
      { key: 'a30_44',   label: '30–44' },    { key: 'a45_64', label: '45–64' },
      { key: 'a65_plus', label: '65+' },       { key: 'unknown', label: 'Unknown (no DOB)' },
    ];
    const ageMap = {};
    for (const r of ageRows) ageMap[r.age_group] = r.n || 0;
    const ageBuckets = ageOrder.map(a => ({ ...a, n: ageMap[a.key] || 0 }));

    return json({
      new_contacts: newContactsRaw,
      member_type_trend: typeTrendRaw,
      age_groups: ageBuckets,
      gender: genderRows,
      household_sizes: hhBuckets,
      sacramental_pipeline: pipeline,
    });
  }

  if (seg === 'reports/membership' && method === 'GET') {
    const dbCounts = (await db.prepare(
      `SELECT member_type, COUNT(*) as n FROM people WHERE active=1 GROUP BY member_type ORDER BY n DESC`
    ).all()).results || [];
    // Merge with configured types so all types appear (even those with 0 members)
    const cfgRow = await db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first();
    const DEFAULT_MEMBER_TYPES = ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
    const configuredTypes = cfgRow ? JSON.parse(cfgRow.value) : DEFAULT_MEMBER_TYPES;
    const countMap = {};
    for (const r of dbCounts) countMap[(r.member_type||'').toLowerCase()] = { raw: r.member_type, n: r.n };
    const counts = configuredTypes.map(t => {
      const key = t.toLowerCase().replace(/\s+/g,'-');
      const found = countMap[key] || countMap[t.toLowerCase()] || {};
      return { member_type: t, n: found.n || 0 };
    });
    // Also include any DB types not in config
    for (const r of dbCounts) {
      const alreadyIn = configuredTypes.some(t => t.toLowerCase().replace(/\s+/g,'-') === (r.member_type||'').toLowerCase() || t.toLowerCase() === (r.member_type||'').toLowerCase());
      if (!alreadyIn) counts.push({ member_type: r.member_type, n: r.n });
    }
    const total = counts.reduce((s,r) => s + r.n, 0);
    const tagCounts = (await db.prepare(
      `SELECT t.name, COUNT(DISTINCT pt.person_id) as n FROM tags t
       LEFT JOIN person_tags pt ON pt.tag_id=t.id GROUP BY t.id ORDER BY t.name`
    ).all()).results || [];
    // R1: Age-group breakdown (only among active, non-organization)
    const ageSql = `
      SELECT
        CASE
          WHEN dob = '' OR dob IS NULL THEN 'unknown'
          WHEN (julianday('now') - julianday(dob)) / 365.25 < 18 THEN 'under_18'
          WHEN (julianday('now') - julianday(dob)) / 365.25 < 30 THEN 'a18_29'
          WHEN (julianday('now') - julianday(dob)) / 365.25 < 45 THEN 'a30_44'
          WHEN (julianday('now') - julianday(dob)) / 365.25 < 65 THEN 'a45_64'
          ELSE 'a65_plus'
        END AS age_group,
        COUNT(*) AS n
      FROM people
      WHERE status='active' AND LOWER(member_type) != 'organization'
      GROUP BY age_group`;
    const ageRows = (await db.prepare(ageSql).all()).results || [];
    const ageMap = {};
    for (const r of ageRows) ageMap[r.age_group] = r.n || 0;
    const ageBuckets = [
      { key: 'under_18', label: 'Under 18', n: ageMap.under_18 || 0 },
      { key: 'a18_29',   label: '18–29',    n: ageMap.a18_29   || 0 },
      { key: 'a30_44',   label: '30–44',    n: ageMap.a30_44   || 0 },
      { key: 'a45_64',   label: '45–64',    n: ageMap.a45_64   || 0 },
      { key: 'a65_plus', label: '65+',      n: ageMap.a65_plus || 0 },
      { key: 'unknown',  label: 'Unknown (no DOB)', n: ageMap.unknown || 0 },
    ];
    return json({ counts, total, tag_counts: tagCounts, age_groups: ageBuckets });
  }

  // ── Engagement review queue (DC1/DB9) ───────────────────────────────
  // Returns a small weekly batch of stale visitor/friend records for triage:
  // archive, engage, promote, or dismiss. Goal: process the whole DB over a year.
  if (seg === 'engagement/review-queue' && method === 'GET') {
    const limit     = Math.min(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 50);
    const maxAgeDays = parseInt(url.searchParams.get('stale_days') || '365', 10) || 365;
    const rows = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone, created_at,
              last_reviewed_at, last_seen_date, first_contact_date,
              (SELECT MAX(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date))
                 FROM giving_entries ge
                 JOIN giving_batches gb ON gb.id = ge.batch_id
                 WHERE ge.person_id = people.id) AS last_gift_date
       FROM people
       WHERE status='active'
         AND LOWER(member_type) NOT IN ('member','organization','')
         AND (last_reviewed_at = ''
              OR date(last_reviewed_at) < date('now', '-' || ? || ' days'))
       ORDER BY CASE WHEN last_reviewed_at = '' THEN 0 ELSE 1 END,
                last_reviewed_at ASC,
                created_at ASC
       LIMIT ?`
    ).bind(maxAgeDays, limit).all()).results || [];
    const totalPending = (await db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE status='active'
         AND LOWER(member_type) NOT IN ('member','organization','')
         AND (last_reviewed_at = ''
              OR date(last_reviewed_at) < date('now', '-' || ? || ' days'))`
    ).bind(maxAgeDays).first())?.n || 0;
    return json({ people: rows, total_pending: totalPending, stale_days: maxAgeDays });
  }

  // Mark a person as reviewed (sets last_reviewed_at = today). Editors+ only.
  if (seg === 'engagement/mark-reviewed' && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const pid = parseInt(b.person_id, 10);
    if (!pid) return json({ error: 'person_id required' }, 400);
    await db.prepare(`UPDATE people SET last_reviewed_at = date('now') WHERE id = ?`).bind(pid).run();
    return json({ ok: true });
  }

  // ── New-contact follow-up queue (FU2) ────────────────────────────────
  // Non-members with a first_contact_date set and followup_status != 'done',
  // newest-first. Feeds the dashboard "New Contacts" card.
  if (seg === 'engagement/followup-queue' && method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 100);
    const rows = (await db.prepare(
      `SELECT id, first_name, last_name, member_type, email, phone,
              first_contact_date, followup_status, followup_notes, created_at
       FROM people
       WHERE status='active'
         AND first_contact_date != ''
         AND (followup_status IS NULL OR followup_status != 'done')
         AND LOWER(member_type) NOT IN ('member','organization')
       ORDER BY first_contact_date DESC, id DESC
       LIMIT ?`
    ).bind(limit).all()).results || [];
    const total = (await db.prepare(
      `SELECT COUNT(*) AS n FROM people
       WHERE status='active'
         AND first_contact_date != ''
         AND (followup_status IS NULL OR followup_status != 'done')
         AND LOWER(member_type) NOT IN ('member','organization')`
    ).first())?.n || 0;
    return json({ people: rows, total });
  }

  // Update follow-up state on a person. Editors+ only.
  // Body: { person_id, followup_status?, followup_notes?, first_contact_date? }
  if (seg === 'engagement/update-followup' && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const pid = parseInt(b.person_id, 10);
    if (!pid) return json({ error: 'person_id required' }, 400);
    const sets = [], binds = [];
    if (b.followup_status !== undefined) {
      const allowed = ['', 'new', 'in_progress', 'done'];
      if (!allowed.includes(b.followup_status)) return json({ error: 'Invalid followup_status' }, 400);
      sets.push('followup_status = ?'); binds.push(b.followup_status);
    }
    if (b.followup_notes !== undefined) {
      sets.push('followup_notes = ?'); binds.push(String(b.followup_notes).slice(0, 2000));
    }
    if (b.first_contact_date !== undefined) {
      const fcd = String(b.first_contact_date || '');
      if (fcd && !/^\d{4}-\d{2}-\d{2}$/.test(fcd)) return json({ error: 'Invalid first_contact_date' }, 400);
      sets.push('first_contact_date = ?'); binds.push(fcd);
    }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    binds.push(pid);
    await db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    return json({ ok: true });
  }

  // ── Weekly engagement task checklist ────────────────────────────────
  // GET  /admin/api/engagement/tasks?week=YYYY-MM-DD
  // POST /admin/api/engagement/tasks  { title, link_url?, week_key }
  // PUT  /admin/api/engagement/tasks/:id  { completed?, title?, link_url? }
  // DELETE /admin/api/engagement/tasks/:id
  if (seg === 'engagement/tasks' && method === 'GET') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const weekKey = url.searchParams.get('week') || isoWeekKey();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return json({ error: 'Invalid week format' }, 400);
    const tasks = (await db.prepare(
      'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
    ).bind(weekKey).all()).results || [];
    return json({ tasks, week_key: weekKey });
  }
  if (seg === 'engagement/tasks' && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const title = String(b.title || '').trim().slice(0, 200);
    if (!title) return json({ error: 'title required' }, 400);
    const weekKey = String(b.week_key || isoWeekKey());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) return json({ error: 'Invalid week_key' }, 400);
    const linkUrl = String(b.link_url || '').slice(0, 500);
    const maxOrder = (await db.prepare(
      'SELECT MAX(sort_order) AS m FROM engagement_tasks WHERE week_key=?'
    ).bind(weekKey).first())?.m ?? -1;
    const r = await db.prepare(
      'INSERT INTO engagement_tasks(title,link_url,week_key,sort_order) VALUES(?,?,?,?)'
    ).bind(title, linkUrl, weekKey, (maxOrder || 0) + 1).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const etMatch = seg.match(/^engagement\/tasks\/(\d+)$/);
  if (etMatch && method === 'PUT') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const tid = parseInt(etMatch[1]);
    const sets = [], binds = [];
    if (b.title !== undefined) { sets.push('title=?'); binds.push(String(b.title || '').trim().slice(0, 200)); }
    if (b.link_url !== undefined) { sets.push('link_url=?'); binds.push(String(b.link_url || '').slice(0, 500)); }
    if (b.completed !== undefined) {
      sets.push('completed=?'); binds.push(b.completed ? 1 : 0);
      sets.push('completed_at=?'); binds.push(b.completed ? new Date().toISOString().slice(0, 10) : '');
    }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    binds.push(tid);
    await db.prepare(`UPDATE engagement_tasks SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
    return json({ ok: true });
  }
  if (etMatch && method === 'DELETE') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const tid = parseInt(etMatch[1]);
    await db.prepare('DELETE FROM engagement_tasks WHERE id=?').bind(tid).run();
    return json({ ok: true });
  }

  // Dismiss a person from the First-Time Givers dashboard card
  const dismissFGMatch = seg.match(/^people\/(\d+)\/dismiss-first-gift$/);
  if (dismissFGMatch && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const pid = parseInt(dismissFGMatch[1]);
    await db.prepare('UPDATE people SET first_gift_noted=1 WHERE id=?').bind(pid).run();
    return json({ ok: true });
  }

  // ── Prayer Requests (FU1) ───────────────────────────────────────────
  // GET  /admin/api/prayer-requests?status=open|praying|answered|closed|all
  // POST /admin/api/prayer-requests                 { person_id?, requester_name?, requester_email?, request_text, submitted_at? }
  // PUT  /admin/api/prayer-requests/:id             { status?, resolution_note?, request_text? }
  // DELETE /admin/api/prayer-requests/:id
  if (seg === 'prayer-requests' && method === 'GET') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const status = url.searchParams.get('status') || 'open';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500);
    let where = '';
    const binds = [];
    if (status === 'open')      { where = "pr.status = 'open'"; }
    else if (status === 'praying') { where = "pr.status = 'praying'"; }
    else if (status === 'answered') { where = "pr.status = 'answered'"; }
    else if (status === 'closed')   { where = "pr.status = 'closed'"; }
    else if (status === 'active')   { where = "pr.status IN ('open','praying')"; }
    else { where = '1=1'; } // 'all'
    const rows = (await db.prepare(
      `SELECT pr.id, pr.person_id, pr.requester_name, pr.requester_email, pr.request_text,
              pr.source, pr.status, pr.resolution_note, pr.submitted_at, pr.resolved_at, pr.created_at,
              p.first_name, p.last_name
       FROM prayer_requests pr
       LEFT JOIN people p ON p.id = pr.person_id
       WHERE ${where}
       ORDER BY pr.submitted_at DESC, pr.id DESC
       LIMIT ?`
    ).bind(...binds, limit).all()).results || [];
    return json({ requests: rows });
  }
  if (seg === 'prayer-requests' && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const text = String(b.request_text || '').trim().slice(0, 5000);
    if (!text) return json({ error: 'request_text required' }, 400);
    const pid = b.person_id ? parseInt(b.person_id, 10) : null;
    const reqName  = String(b.requester_name  || '').trim().slice(0, 200);
    const reqEmail = String(b.requester_email || '').trim().slice(0, 200);
    const submittedAt = b.submitted_at && /^\d{4}-\d{2}-\d{2}/.test(String(b.submitted_at))
      ? String(b.submitted_at).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const r = await db.prepare(
      `INSERT INTO prayer_requests(person_id, requester_name, requester_email, request_text, source, submitted_at, status)
       VALUES(?, ?, ?, ?, 'manual', ?, 'open')`
    ).bind(pid, reqName, reqEmail, text, submittedAt).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  if (seg === 'prayer-requests/export.csv' && method === 'GET') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const statusParam = url.searchParams.get('status') || 'all';
    const allowed = ['open', 'praying', 'answered', 'closed', 'active', 'all'];
    if (!allowed.includes(statusParam)) return json({ error: 'Invalid status' }, 400);
    let where = '1=1';
    if (statusParam === 'active')        where = "pr.status IN ('open','praying')";
    else if (statusParam !== 'all')      where = "pr.status = '" + statusParam + "'";
    const rows = (await db.prepare(
      `SELECT pr.submitted_at, pr.requester_name, pr.requester_email,
              pr.status, pr.resolution_note, pr.resolved_at,
              pr.request_text, pr.source,
              p.first_name, p.last_name
       FROM prayer_requests pr
       LEFT JOIN people p ON p.id = pr.person_id
       WHERE ${where}
       ORDER BY pr.submitted_at DESC, pr.id DESC`
    ).all()).results || [];
    const cols = ['date','name','email','status','resolution_note','resolved_at','request','source'];
    let csv = cols.join(',') + '\n';
    for (const r of rows) {
      const name = r.person_id
        ? ((r.first_name || '') + ' ' + (r.last_name || '')).trim()
        : (r.requester_name || '');
      const vals = [
        r.submitted_at || '', name, r.requester_email || '',
        r.status || '', r.resolution_note || '', r.resolved_at || '',
        r.request_text || '', r.source || '',
      ];
      csv += vals.map(function(v) {
        const s = String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',') + '\n';
    }
    return new Response(csv, { headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="prayer-requests-' + new Date().toISOString().slice(0,10) + '.csv"',
    }});
  }
  const prMatch = seg.match(/^prayer-requests\/(\d+)$/);
  if (prMatch && method === 'PUT') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b = {}; try { b = await req.json(); } catch {}
    const prid = parseInt(prMatch[1]);
    const sets = [], binds = [];
    if (b.status !== undefined) {
      const allowed = ['open', 'praying', 'answered', 'closed'];
      if (!allowed.includes(b.status)) return json({ error: 'Invalid status' }, 400);
      sets.push('status=?'); binds.push(b.status);
      if (b.status === 'answered' || b.status === 'closed') {
        sets.push('resolved_at=?'); binds.push(new Date().toISOString().slice(0, 10));
      } else {
        sets.push("resolved_at=''");
      }
    }
    if (b.resolution_note !== undefined) {
      sets.push('resolution_note=?'); binds.push(String(b.resolution_note || '').slice(0, 2000));
    }
    if (b.request_text !== undefined) {
      sets.push('request_text=?'); binds.push(String(b.request_text || '').slice(0, 5000));
    }
    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    binds.push(prid);
    await db.prepare(`UPDATE prayer_requests SET ${sets.join(',')} WHERE id=?`).bind(...binds).run();
    return json({ ok: true });
  }
  if (prMatch && method === 'DELETE') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const prid = parseInt(prMatch[1]);
    await db.prepare('DELETE FROM prayer_requests WHERE id=?').bind(prid).run();
    return json({ ok: true });
  }

  // ── Contact info completeness (R5) ──────────────────────────────────
  // Counts of active members/attenders missing each contact field, with
  // optional drill-down list via ?field=email|phone|address|dob|photo
  if (seg === 'reports/contact-completeness' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'active'; // 'active' | 'member'
    const field = url.searchParams.get('field') || '';
    let where = "status='active'";
    if (scope === 'member') where += " AND LOWER(member_type)='member'";
    // Exclude organizations from contact-completeness counts (they often lack personal data intentionally)
    where += " AND LOWER(member_type) != 'organization'";
    if (field) {
      let cond;
      if (field === 'email')   cond = "email=''";
      else if (field === 'phone')   cond = "phone=''";
      else if (field === 'address') cond = "address1='' AND city=''";
      else if (field === 'dob')     cond = "dob=''";
      else if (field === 'photo')   cond = "photo_url=''";
      else return json({ error: 'Unknown field' }, 400);
      const rows = (await db.prepare(
        `SELECT id, first_name, last_name, member_type, email, phone, address1, city, state, zip, dob, photo_url
         FROM people WHERE ${where} AND ${cond}
         ORDER BY last_name, first_name LIMIT 500`
      ).all()).results || [];
      return json({ field, scope, people: rows });
    }
    const row = await db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN email=''                THEN 1 ELSE 0 END) AS missing_email,
              SUM(CASE WHEN phone=''                THEN 1 ELSE 0 END) AS missing_phone,
              SUM(CASE WHEN address1='' AND city='' THEN 1 ELSE 0 END) AS missing_address,
              SUM(CASE WHEN dob=''                  THEN 1 ELSE 0 END) AS missing_dob,
              SUM(CASE WHEN photo_url=''            THEN 1 ELSE 0 END) AS missing_photo
       FROM people WHERE ${where}`
    ).first();
    return json({
      scope,
      total:            row?.total           || 0,
      missing_email:    row?.missing_email   || 0,
      missing_phone:    row?.missing_phone   || 0,
      missing_address:  row?.missing_address || 0,
      missing_dob:      row?.missing_dob     || 0,
      missing_photo:    row?.missing_photo   || 0,
    });
  }

  // ── Giving insights (R2) ────────────────────────────────────────────
  // Top givers, lapsed givers (gave prior year, not this year), giving
  // frequency distribution, average-gift trend by year. Finance-gated.
  if (seg === 'reports/giving-insights' && method === 'GET') {
    const year   = parseInt(url.searchParams.get('year') || '', 10);
    if (!year || isNaN(year)) return json({ error: 'year required' }, 400);
    const topN   = Math.min(parseInt(url.searchParams.get('top') || '25', 10) || 25, 100);
    const start  = year + '-01-01';
    const end    = year + '-12-31';
    const pStart = (year - 1) + '-01-01';
    const pEnd   = (year - 1) + '-12-31';

    // Canonical effective date: contribution_date falls back to batch_date
    const effDate = "COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date)";

    // Top givers in `year`
    const topGivers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.member_type,
              COUNT(*) AS gifts, SUM(ge.amount) AS total_cents
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       JOIN people p ON p.id = ge.person_id
       WHERE ${effDate} >= ? AND ${effDate} <= ?
       GROUP BY p.id
       ORDER BY total_cents DESC
       LIMIT ?`
    ).bind(start, end, topN).all()).results || [];

    // Lapsed givers: gave in prior year, nothing in this year
    const lapsed = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.member_type,
              SUM(ge.amount)       AS prior_total_cents,
              COUNT(*)             AS prior_gifts,
              MAX(${effDate})      AS last_gift_date
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       JOIN people p ON p.id = ge.person_id
       WHERE ${effDate} >= ? AND ${effDate} <= ?
         AND p.id NOT IN (
           SELECT DISTINCT ge2.person_id
           FROM giving_entries ge2
           JOIN giving_batches gb2 ON gb2.id = ge2.batch_id
           WHERE COALESCE(NULLIF(ge2.contribution_date,''), gb2.batch_date) >= ?
             AND COALESCE(NULLIF(ge2.contribution_date,''), gb2.batch_date) <= ?
         )
       GROUP BY p.id
       ORDER BY prior_total_cents DESC`
    ).bind(pStart, pEnd, start, end).all()).results || [];

    // Frequency distribution — bucket each giver by # of gifts this year
    const freqRaw = (await db.prepare(
      `SELECT person_id, COUNT(*) AS gifts
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       WHERE ${effDate} >= ? AND ${effDate} <= ?
       GROUP BY person_id`
    ).bind(start, end).all()).results || [];
    const buckets = [
      { label: '1 gift',       min: 1,  max: 1,   n: 0 },
      { label: '2–5 gifts',    min: 2,  max: 5,   n: 0 },
      { label: '6–12 gifts',   min: 6,  max: 12,  n: 0 },
      { label: '13–26 gifts',  min: 13, max: 26,  n: 0 },
      { label: '27+ gifts',    min: 27, max: 9e9, n: 0 },
    ];
    for (const r of freqRaw) {
      const g = r.gifts || 0;
      for (const b of buckets) { if (g >= b.min && g <= b.max) { b.n++; break; } }
    }

    // Average-gift trend — last 5 years ending in `year`
    const trendYears = [];
    for (let y = year - 4; y <= year; y++) trendYears.push(y);
    const trendRows = [];
    for (const y of trendYears) {
      const s = y + '-01-01', e = y + '-12-31';
      const r = await db.prepare(
        `SELECT COUNT(*) AS gifts, COUNT(DISTINCT ge.person_id) AS givers, SUM(ge.amount) AS total_cents
         FROM giving_entries ge
         JOIN giving_batches gb ON gb.id = ge.batch_id
         WHERE ${effDate} >= ? AND ${effDate} <= ?`
      ).bind(s, e).first();
      const gifts  = r?.gifts  || 0;
      const givers = r?.givers || 0;
      const tot    = r?.total_cents || 0;
      trendRows.push({
        year: y,
        gifts, givers,
        total_cents: tot,
        avg_gift_cents:  gifts  > 0 ? Math.round(tot / gifts)  : 0,
        avg_giver_cents: givers > 0 ? Math.round(tot / givers) : 0,
      });
    }

    return json({
      year,
      top_givers: topGivers,
      lapsed,
      frequency:  buckets,
      trend:      trendRows,
    });
  }

  // ── Giving × Attendance overlay (R8) ────────────────────────────────
  // Weekly buckets: attendance (sum per week) and giving (sum per week).
  // Week = Sunday of that week (derived from service_date / effective gift date).
  // Finance-gated (matches reports/giving-*).
  if (seg === 'reports/giving-vs-attendance' && method === 'GET') {
    const from = url.searchParams.get('from') || '';
    const to   = url.searchParams.get('to')   || '';
    if (!from || !to) return json({ error: 'from and to required' }, 400);
    // Include special services too (not just service_type='sunday') so Christmas etc. land in the week
    const attRows = (await db.prepare(
      `SELECT date(service_date, '-' || strftime('%w', service_date) || ' days') AS week_start,
              SUM(attendance) AS total_att
       FROM worship_services
       WHERE attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY week_start
       ORDER BY week_start`
    ).bind(from, to).all()).results || [];
    const effDate = "COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date)";
    const giveRows = (await db.prepare(
      `SELECT date(${effDate}, '-' || strftime('%w', ${effDate}) || ' days') AS week_start,
              SUM(ge.amount) AS total_cents,
              COUNT(DISTINCT ge.person_id) AS givers
       FROM giving_entries ge
       JOIN giving_batches gb ON gb.id = ge.batch_id
       WHERE ${effDate} BETWEEN ? AND ?
       GROUP BY week_start
       ORDER BY week_start`
    ).bind(from, to).all()).results || [];
    const byWeek = {};
    for (const r of attRows) byWeek[r.week_start] = { week_start: r.week_start, attendance: r.total_att || 0, giving_cents: 0, givers: 0 };
    for (const r of giveRows) {
      if (!byWeek[r.week_start]) byWeek[r.week_start] = { week_start: r.week_start, attendance: 0, giving_cents: 0, givers: 0 };
      byWeek[r.week_start].giving_cents = r.total_cents || 0;
      byWeek[r.week_start].givers = r.givers || 0;
    }
    const weeks = Object.values(byWeek).sort((a,b) => a.week_start.localeCompare(b.week_start));
    return json({ from, to, weeks });
  }


  if (seg === 'reports/giving-summary' && method === 'GET') {
    const from = url.searchParams.get('from') || new Date().getFullYear() + '-01-01';
    const to   = url.searchParams.get('to')   || new Date().getFullYear() + '-12-31';
    const [rowsResult, giverResult, txnResult, methodResult] = await Promise.all([
      db.prepare(
        `SELECT f.name as fund_name, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
         FROM funds f LEFT JOIN giving_entries ge ON ge.fund_id=f.id
         LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
         WHERE f.active=1
           AND COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
         GROUP BY f.id ORDER BY f.sort_order, f.name`
      ).bind(from, to).all(),
      db.prepare(
        `SELECT COUNT(DISTINCT ge.person_id) as n
         FROM giving_entries ge
         LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
         WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
           AND ge.person_id IS NOT NULL`
      ).bind(from, to).first(),
      db.prepare(
        `SELECT COUNT(ge.id) as n
         FROM giving_entries ge
         LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
         WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?`
      ).bind(from, to).first(),
      db.prepare(
        `SELECT ge.method, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
         FROM giving_entries ge
         LEFT JOIN giving_batches gb ON ge.batch_id=gb.id
         WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
         GROUP BY ge.method ORDER BY total_cents DESC`
      ).bind(from, to).all(),
    ]);
    const rows = rowsResult.results || [];
    const grand = rows.reduce((s,r) => s + r.total_cents, 0);
    // R1: Giving by age group (joining on person's dob)
    const ageRows = (await db.prepare(
      `SELECT
         CASE
           WHEN p.dob = '' OR p.dob IS NULL THEN 'unknown'
           WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 18 THEN 'under_18'
           WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 30 THEN 'a18_29'
           WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 45 THEN 'a30_44'
           WHEN (julianday('now') - julianday(p.dob)) / 365.25 < 65 THEN 'a45_64'
           ELSE 'a65_plus'
         END AS age_group,
         COUNT(DISTINCT p.id) AS givers,
         COUNT(ge.id)         AS contributions,
         COALESCE(SUM(ge.amount), 0) AS total_cents
       FROM giving_entries ge
       LEFT JOIN giving_batches gb ON ge.batch_id = gb.id
       LEFT JOIN people p ON p.id = ge.person_id
       WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
       GROUP BY age_group`
    ).bind(from, to).all()).results || [];
    const ageMap = {};
    for (const r of ageRows) ageMap[r.age_group] = r;
    const ageBuckets = ['under_18','a18_29','a30_44','a45_64','a65_plus','unknown'].map(function(k) {
      const label = { under_18:'Under 18', a18_29:'18–29', a30_44:'30–44', a45_64:'45–64', a65_plus:'65+', unknown:'Unknown (no DOB)' }[k];
      const r = ageMap[k] || {};
      return { key: k, label, givers: r.givers || 0, contributions: r.contributions || 0, total_cents: r.total_cents || 0 };
    });
    return json({
      from, to, rows, grand_total_cents: grand,
      total_givers: giverResult?.n ?? 0,
      total_transactions: txnResult?.n ?? 0,
      by_method: methodResult.results || [],
      by_age_group: ageBuckets,
    });
  }

  // Standalone orphan cleanup: find DB entries whose breeze_id no longer exists in Breeze
  // for a given date range and remove them (same safety check as the sync orphan pass).
  if (seg === 'giving/reconcile-orphans' && method === 'POST') { try {
    const breeze = makeBreezeClient(env);
    if (!breeze) return json({ error: 'Breeze not configured' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const start = b.start || '';
    const end   = b.end   || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return json({ error: 'start and end (YYYY-MM-DD) required' }, 400);
    }
    const lateStartObj = new Date(start);
    lateStartObj.setDate(lateStartObj.getDate() - 45);
    const lateStart = lateStartObj.toISOString().slice(0, 10);

    const glRes = await breeze.givingList({ start: lateStart, end, details: 1, limit: 10000 });
    if (!glRes.ok) return json({ error: 'Breeze API error: ' + glRes.status }, 502);
    const glData = await glRes.json();
    const glByPaymentId = new Map();
    if (Array.isArray(glData)) {
      for (const p of glData) { if (p.id) glByPaymentId.set(String(p.id), true); }
    }

    const winRows = (await db.prepare(
      `SELECT ge.id, ge.breeze_id, ge.person_id, ge.contribution_date
       FROM giving_entries ge
       WHERE ge.contribution_date >= ? AND ge.contribution_date <= ? AND ge.breeze_id != ''`
    ).bind(lateStart, end).all()).results || [];

    const orphaned = winRows.filter(r => !glByPaymentId.has(r.breeze_id));
    const currentKeys = new Set(
      winRows.filter(r => glByPaymentId.has(r.breeze_id))
        .map(r => `${r.person_id}::${r.contribution_date}`)
    );
    const toDelete = orphaned.filter(r => currentKeys.has(`${r.person_id}::${r.contribution_date}`));

    let orphansRemoved = 0;
    if (toDelete.length > 0) {
      const deleteOps = [];
      for (let i = 0; i < toDelete.length; i += 90) {
        const chunk = toDelete.slice(i, i + 90);
        deleteOps.push(
          db.prepare(`DELETE FROM giving_entries WHERE id IN (${chunk.map(() => '?').join(',')})`)
            .bind(...chunk.map(r => r.id))
        );
      }
      for (let i = 0; i < deleteOps.length; i += 10) {
        const results = await db.batch(deleteOps.slice(i, i + 10));
        for (const r of results) orphansRemoved += r.meta?.changes || 0;
      }
    }
    return json({ ok: true, orphanCandidates: orphaned.length, orphansRemoved,
      breezePaymentsChecked: glByPaymentId.size, dbEntriesChecked: winRows.length });
  } catch (e) { return json({ error: 'Reconcile error: ' + e.message }, 500); } }

  // Diagnostic: list every DB giving_entry in a date range, classified by
  // whether its breeze_id still exists in Breeze's giving/list. Use this to
  // find the source of Giving-by-Fund discrepancies with Breeze. Read-only.
  if (seg === 'giving/reconcile-diagnose' && method === 'GET') { try {
    const breeze = makeBreezeClient(env);
    if (!breeze) return json({ error: 'Breeze not configured' }, 503);
    const from = url.searchParams.get('from') || '';
    const to   = url.searchParams.get('to')   || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return json({ error: 'from and to (YYYY-MM-DD) required' }, 400);
    }
    // Match the sync's 45-day grace window when fetching Breeze payments so
    // an early-year contribution logged within that grace isn't flagged.
    const lateStartObj = new Date(from);
    lateStartObj.setDate(lateStartObj.getDate() - 45);
    const lateStart = lateStartObj.toISOString().slice(0, 10);

    const glRes = await breeze.givingList({ start: lateStart, end: to, details: 1, limit: 10000 });
    if (!glRes.ok) return json({ error: 'Breeze API error: ' + glRes.status }, 502);
    const glData = await glRes.json();
    const glIds = new Set();
    const glPayments = [];
    if (Array.isArray(glData)) {
      for (const p of glData) {
        if (p.id != null) glIds.add(String(p.id));
        glPayments.push(p);
      }
    }

    // All DB rows whose effective gift date lands in [from, to], matching the
    // Giving-by-Fund report's date-coalesce logic exactly.
    const rows = (await db.prepare(
      `SELECT ge.id, ge.person_id, ge.fund_id, ge.amount, ge.breeze_id, ge.batch_id,
              ge.method, ge.check_number, ge.notes,
              ge.contribution_date AS raw_contribution_date,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) AS gift_date,
              gb.batch_date, gb.description AS batch_desc, gb.closed AS batch_closed,
              p.first_name, p.last_name, p.breeze_id AS person_breeze_id,
              f.name AS fund_name, f.breeze_id AS fund_breeze_id
       FROM giving_entries ge
       LEFT JOIN giving_batches gb ON ge.batch_id = gb.id
       LEFT JOIN people p         ON ge.person_id = p.id
       LEFT JOIN funds f          ON ge.fund_id   = f.id
       WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
       ORDER BY f.name, gift_date, ge.id`
    ).bind(from, to).all()).results || [];

    // Classify each row. Split-row suffixes (`12345-2`) come from the older
    // CSV importer — check their base pid against Breeze too.
    const classify = bid => {
      if (!bid) return { key: 'no_breeze_id', inBreeze: false };
      if (glIds.has(bid)) return { key: 'in_breeze', inBreeze: true };
      const m = bid.match(/^(\d+)-(\d+)$/);
      if (m) return glIds.has(m[1])
        ? { key: 'split_suffix_base_in_breeze', inBreeze: true, basePid: m[1] }
        : { key: 'split_suffix_orphan',         inBreeze: false, basePid: m[1] };
      return { key: 'orphan', inBreeze: false };
    };

    // Twin detection: an orphan with a sibling row sharing person+date+amount
    // (sometimes with different breeze_ids) is almost certainly a duplicate
    // left behind by a previous import format.
    const keyByPDA = {};
    for (const r of rows) {
      if (!r.person_id) continue;
      const k = `${r.person_id}|${r.gift_date}|${r.amount}`;
      (keyByPDA[k] = keyByPDA[k] || []).push(r.id);
    }

    const enriched = rows.map(r => {
      const c = classify(r.breeze_id || '');
      const twinKey = r.person_id ? `${r.person_id}|${r.gift_date}|${r.amount}` : '';
      const twinIds = twinKey ? (keyByPDA[twinKey] || []).filter(id => id !== r.id) : [];
      return {
        id: r.id,
        person_id: r.person_id,
        person_name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '(unlinked)',
        person_breeze_id: r.person_breeze_id || '',
        fund_id: r.fund_id,
        fund_name: r.fund_name || '(no fund)',
        fund_breeze_id: r.fund_breeze_id || '',
        amount_cents: r.amount,
        contribution_date: r.raw_contribution_date || '',
        gift_date: r.gift_date,
        batch_id: r.batch_id,
        batch_desc: r.batch_desc || '',
        batch_date: r.batch_date || '',
        batch_closed: !!r.batch_closed,
        breeze_id: r.breeze_id || '',
        method: r.method || '',
        check_number: r.check_number || '',
        notes: r.notes || '',
        classification: c.key,
        in_breeze_giving_list: c.inBreeze,
        base_payment_id: c.basePid || '',
        twin_entry_ids: twinIds,
      };
    });

    // Per-fund summary: highlight exactly which funds carry extras.
    const fundSummary = {};
    for (const r of enriched) {
      const k = r.fund_name;
      if (!fundSummary[k]) fundSummary[k] = {
        fund_id: r.fund_id, fund_name: r.fund_name, fund_breeze_id: r.fund_breeze_id,
        total_count: 0, total_cents: 0,
        matched_count: 0, matched_cents: 0,
        extras_count: 0, extras_cents: 0,
        by_class: {},
      };
      const s = fundSummary[k];
      s.total_count++; s.total_cents += r.amount_cents;
      if (r.in_breeze_giving_list) { s.matched_count++; s.matched_cents += r.amount_cents; }
      else { s.extras_count++; s.extras_cents += r.amount_cents; }
      s.by_class[r.classification] = (s.by_class[r.classification] || 0) + 1;
    }
    const fundSummaryList = Object.values(fundSummary)
      .sort((a, b) => b.extras_cents - a.extras_cents || b.total_cents - a.total_cents);

    const classification_counts = enriched.reduce((acc, r) => {
      acc[r.classification] = (acc[r.classification] || 0) + 1;
      return acc;
    }, {});

    const extras = enriched.filter(r => !r.in_breeze_giving_list);

    // Breeze-side view: which payments exist in giving/list but have 0 rows
    // in the DB? These are the inverse problem (missing imports, not extras).
    const dbBreezeIds = new Set(enriched.map(r => r.breeze_id).filter(Boolean));
    const missingFromDb = [];
    for (const p of glPayments) {
      const pid = String(p.id);
      if (dbBreezeIds.has(pid)) continue;
      // Exclude payments whose paid_on date is outside the [from,to] window
      const paid = (p.paid_on || p.date || '').slice(0, 10);
      if (!paid || paid < from || paid > to) continue;
      missingFromDb.push({
        breeze_id: pid,
        date: paid,
        amount: p.amount,
        person_id: p.person_id,
        person_name: [p.first_name, p.last_name].filter(Boolean).join(' '),
        fund_names: Array.isArray(p.funds) ? p.funds.map(f => f.name || f.fund_name).filter(Boolean) : [],
      });
    }

    return json({
      ok: true,
      from, to, lateStart,
      db_row_count: enriched.length,
      db_total_cents: enriched.reduce((s, r) => s + r.amount_cents, 0),
      breeze_payment_count: glIds.size,
      extras_count: extras.length,
      extras_total_cents: extras.reduce((s, r) => s + r.amount_cents, 0),
      missing_from_db_count: missingFromDb.length,
      classification_counts,
      fund_summary: fundSummaryList,
      extras,
      missing_from_db: missingFromDb.slice(0, 200),
    });
  } catch (e) { return json({ error: 'Diagnose error: ' + e.message }, 500); } }

  // Force-remove orphans: delete giving_entries whose breeze_id is not in
  // Breeze's giving/list for the window — without reconcile-orphans' safety
  // "current replacement exists for same person+date" check. Admin-only.
  // The caller must include the exact count and total cents returned by the
  // diagnose endpoint; the server recomputes and aborts if they disagree, so
  // the button can't run against stale data.
  if (seg === 'giving/force-remove-orphans' && method === 'POST') { try {
    if (!isAdmin) return json({ error: 'Access denied: force-remove requires admin' }, 403);
    const breeze = makeBreezeClient(env);
    if (!breeze) return json({ error: 'Breeze not configured' }, 503);
    let b = {}; try { b = await req.json(); } catch {}
    const start = b.start || '';
    const end   = b.end   || '';
    const confirmCount = Number.isInteger(b.confirm_count) ? b.confirm_count : NaN;
    const confirmCents = Number.isInteger(b.confirm_cents) ? b.confirm_cents : NaN;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      return json({ error: 'start and end (YYYY-MM-DD) required' }, 400);
    }
    if (!Number.isFinite(confirmCount) || !Number.isFinite(confirmCents)) {
      return json({ error: 'confirm_count and confirm_cents (integers) required' }, 400);
    }
    const lateStartObj = new Date(start);
    lateStartObj.setDate(lateStartObj.getDate() - 45);
    const lateStart = lateStartObj.toISOString().slice(0, 10);

    const glRes = await breeze.givingList({ start: lateStart, end, details: 1, limit: 10000 });
    if (!glRes.ok) return json({ error: 'Breeze API error: ' + glRes.status }, 502);
    const glData = await glRes.json();
    const glIds = new Set();
    if (Array.isArray(glData)) {
      for (const p of glData) if (p.id != null) glIds.add(String(p.id));
    }
    // Truncation safeguard: a tiny giving/list likely means the API call failed
    // or returned partial data — refuse rather than mass-delete in that case.
    const MIN_BREEZE_PAYMENTS = 100;
    if (glIds.size < MIN_BREEZE_PAYMENTS) {
      return json({ error: `Aborted: Breeze giving/list returned only ${glIds.size} payments (threshold ${MIN_BREEZE_PAYMENTS}) — refusing to mass-delete on a likely truncated response.` }, 409);
    }

    // Use the same date-coalesce logic as the diagnose endpoint so the count
    // we compute matches what the user confirmed.
    const rows = (await db.prepare(
      `SELECT ge.id, ge.amount, ge.breeze_id, ge.person_id, ge.fund_id,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) AS gift_date
       FROM giving_entries ge
       LEFT JOIN giving_batches gb ON ge.batch_id = gb.id
       WHERE COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) BETWEEN ? AND ?
         AND ge.breeze_id != ''`
    ).bind(start, end).all()).results || [];

    // Split-suffix `pid-N` rows: match if base pid is in Breeze.
    const isOrphan = bid => {
      if (!bid) return false;
      if (glIds.has(bid)) return false;
      const m = bid.match(/^(\d+)-(\d+)$/);
      if (m && glIds.has(m[1])) return false;
      return true;
    };
    const orphans = rows.filter(r => isOrphan(r.breeze_id));
    const actualCount = orphans.length;
    const actualCents = orphans.reduce((s, r) => s + (r.amount || 0), 0);

    if (actualCount !== confirmCount || actualCents !== confirmCents) {
      return json({
        error: 'Confirmation mismatch — data has changed since diagnose ran. Re-run Diagnose and try again.',
        expected: { count: confirmCount, cents: confirmCents },
        actual:   { count: actualCount,  cents: actualCents },
      }, 409);
    }
    if (actualCount === 0) {
      return json({ ok: true, removed: 0, removed_cents: 0 });
    }

    // Delete in chunks of 90 ids (D1 ~100 param limit).
    const deleteOps = [];
    for (let i = 0; i < orphans.length; i += 90) {
      const chunk = orphans.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      deleteOps.push(
        db.prepare(`DELETE FROM giving_entries WHERE id IN (${placeholders})`)
          .bind(...chunk.map(r => r.id))
      );
    }
    let removed = 0;
    for (let i = 0; i < deleteOps.length; i += 10) {
      const results = await db.batch(deleteOps.slice(i, i + 10));
      for (const r of results) removed += r.meta?.changes || 0;
    }
    await db.prepare(
      'DELETE FROM giving_batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM giving_entries)'
    ).run();

    // Record the action so this irreversible op is traceable. Store the list
    // of removed ids in new_value so the removal can be audited later.
    try {
      await db.prepare(
        `INSERT INTO audit_log(action,entity_type,entity_id,person_name,field,old_value,new_value) VALUES(?,?,?,?,?,?,?)`
      ).bind('force_remove_orphans','giving_entries', null,'', start + ' to ' + end,
             String(actualCents),
             JSON.stringify({ count: actualCount, ids: orphans.map(r => r.id).slice(0, 500) })).run();
    } catch {}

    return json({ ok: true, removed, removed_cents: actualCents, breezePaymentsChecked: glIds.size });
  } catch (e) { return json({ error: 'Force-remove error: ' + e.message }, 500); } }

  if (seg === 'reports/giving-trend' && method === 'GET') {
    if (!isFinance) return json({ error: 'Forbidden' }, 403);
    const yearsParam = url.searchParams.get('years') || String(new Date().getFullYear());
    const years = yearsParam.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y)).slice(0, 10);
    if (!years.length) return json({ error: 'No valid years' }, 400);
    const placeholders = years.map(() => '?').join(',');
    const rows = (await db.prepare(
      `SELECT substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4) as yr,
              substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),6,2) as mo,
              SUM(ge.amount) as total_cents
       FROM giving_entries ge
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4) IN (${placeholders})
       GROUP BY yr, mo ORDER BY yr, mo`
    ).bind(...years).all()).results || [];
    const monthly = {};
    years.forEach(y => { monthly[y] = []; });
    rows.forEach(r => {
      if (monthly[r.yr]) monthly[r.yr].push({ month: r.mo, total_cents: r.total_cents });
    });
    return json({ years, monthly });
  }

  if (seg === 'reports/giving-by-method' && method === 'GET') {
    const from = url.searchParams.get('from') || new Date().getFullYear() + '-01-01';
    const to   = url.searchParams.get('to')   || new Date().getFullYear() + '-12-31';
    const rows = (await db.prepare(
      `SELECT ge.method, COUNT(ge.id) as contributions, COALESCE(SUM(ge.amount),0) as total_cents
       FROM giving_entries ge
       WHERE COALESCE(NULLIF(ge.contribution_date,''), (SELECT batch_date FROM giving_batches WHERE id=ge.batch_id)) BETWEEN ? AND ?
       GROUP BY ge.method ORDER BY total_cents DESC`
    ).bind(from,to).all()).results || [];
    const grand = rows.reduce((s,r) => s + r.total_cents, 0);
    return json({ from, to, rows, grand_total_cents: grand });
  }

  if (seg === 'reports/giving-statement' && method === 'GET' && url.searchParams.get('list_givers') === '1') {
    const year = url.searchParams.get('year') || new Date().getFullYear();
    const givers = (await db.prepare(
      `SELECT p.id, p.first_name, p.last_name, p.email,
              SUM(ge.amount) as total_cents
       FROM people p
       JOIN giving_entries ge ON ge.person_id=p.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE p.active=1 AND p.email != ''
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       GROUP BY p.id ORDER BY p.last_name, p.first_name`
    ).bind(String(year)).all()).results || [];
    return json({ givers });
  }

  if (seg === 'reports/giving-statement' && method === 'GET') {
    const personId = url.searchParams.get('person_id');
    const year = url.searchParams.get('year') || new Date().getFullYear();
    if (!personId) return json({ error: 'person_id required' }, 400);
    const person = await db.prepare('SELECT * FROM people WHERE id=?').bind(personId).first();
    if (!person) return json({ error: 'Person not found' }, 404);
    const entries = (await db.prepare(
      `SELECT ge.amount, ge.method, ge.notes, f.name as fund_name,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as gift_date
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       WHERE ge.person_id=?
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       ORDER BY gift_date, ge.id`
    ).bind(personId, String(year)).all()).results || [];
    const total = entries.reduce((s,e) => s + e.amount, 0);
    if (url.searchParams.get('format') === 'csv') {
      let csv = 'Date,Fund,Amount,Method\n';
      for (const e of entries) {
        csv += `${e.gift_date},${e.fund_name},$${(e.amount/100).toFixed(2)},${e.method}\n`;
      }
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="giving-statement-${person.last_name}-${year}.csv"`
        }
      });
    }
    return json({ person, year, entries, total_cents: total });
  }

  if (seg === 'reports/giving-statement-household' && method === 'GET') {
    const householdId = url.searchParams.get('household_id');
    const year = url.searchParams.get('year') || new Date().getFullYear();
    if (!householdId) return json({ error: 'household_id required' }, 400);
    const household = await db.prepare('SELECT * FROM households WHERE id=?').bind(householdId).first();
    if (!household) return json({ error: 'Household not found' }, 404);
    const members = (await db.prepare(
      `SELECT id, first_name, last_name, email FROM people WHERE household_id=? AND active=1 ORDER BY family_role, last_name`
    ).bind(householdId).all()).results || [];
    const entries = (await db.prepare(
      `SELECT ge.amount, ge.method, f.name as fund_name,
              COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date) as gift_date,
              p.first_name, p.last_name
       FROM giving_entries ge
       JOIN funds f ON ge.fund_id=f.id
       JOIN giving_batches gb ON ge.batch_id=gb.id
       JOIN people p ON ge.person_id=p.id
       WHERE p.household_id=?
         AND substr(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date),1,4)=?
       ORDER BY gift_date, p.last_name, ge.id`
    ).bind(householdId, String(year)).all()).results || [];
    const total = entries.reduce((s,e) => s + e.amount, 0);
    return json({ household, members, year, entries, total_cents: total });
  }

  // ── Attendance ───────────────────────────────────────────────────
  if (seg === 'attendance' && method === 'GET') {
    const from = url.searchParams.get('from') || (new Date().getFullYear() + '-01-01');
    const to   = url.searchParams.get('to')   || (new Date().getFullYear() + '-12-31');
    const type = url.searchParams.get('type') || '';
    const order = (url.searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let sql = 'SELECT * FROM worship_services WHERE service_date BETWEEN ? AND ?';
    const binds = [from, to];
    if (type) { sql += ' AND service_type=?'; binds.push(type); }
    sql += ` ORDER BY service_date ${order}, service_time ASC`;
    const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
    const totalRow = await db.prepare('SELECT COUNT(*) as n FROM worship_services').first();
    return json({ services: rows, total_in_db: totalRow?.n ?? 0 });
  }

  if (seg === 'attendance' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(b.service_date||'',b.service_time||'',b.service_name||'',b.service_type||'sunday',
           parseInt(b.attendance)||0,parseInt(b.communion)||0,b.notes||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.match(/^attendance\/\d+$/) && method === 'PUT') {
    const id = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    // Merge with existing row so partial updates (attendance only) work
    const existing = await db.prepare('SELECT * FROM worship_services WHERE id=?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    await db.prepare(
      `UPDATE worship_services SET service_date=?,service_time=?,service_name=?,service_type=?,attendance=?,communion=?,notes=? WHERE id=?`
    ).bind(
      b.service_date ?? existing.service_date,
      b.service_time ?? existing.service_time,
      b.service_name ?? existing.service_name,
      b.service_type ?? existing.service_type,
      b.attendance !== undefined ? parseInt(b.attendance)||0 : existing.attendance,
      b.communion !== undefined ? parseInt(b.communion)||0 : existing.communion,
      b.notes !== undefined ? b.notes : existing.notes,
      id
    ).run();
    return json({ ok: true });
  }

  if (seg.match(/^attendance\/\d+$/) && method === 'DELETE') {
    const id = parseInt(seg.split('/')[1]);
    await db.prepare('DELETE FROM worship_services WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // Seed all Sundays for a year with 8:00 and 10:45 services (skips existing)
  if (seg === 'attendance/seed-year' && method === 'POST') {
    let b; try { b = await req.json(); } catch { b = {}; }
    const year = parseInt(b.year) || new Date().getFullYear();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    // Find all Sundays in the year
    const sundays = [];
    const d = new Date(year, 0, 1);
    // Advance to first Sunday
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    while (d.getFullYear() === year) {
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const dateStr = `${year}-${mm}-${dd}`;
      const name = `${months[d.getMonth()]} ${d.getDate()}`;
      sundays.push({ dateStr, name });
      d.setDate(d.getDate() + 7);
    }
    let inserted = 0, skipped = 0;
    for (const { dateStr, name } of sundays) {
      for (const time of ['08:00', '10:45']) {
        const exists = await db.prepare(
          'SELECT id FROM worship_services WHERE service_date=? AND service_time=?'
        ).bind(dateStr, time).first();
        if (exists) { skipped++; continue; }
        await db.prepare(
          `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
           VALUES (?,?,?,?,0,0,?)`
        ).bind(dateStr, time, name, 'sunday', '').run();
        inserted++;
      }
    }
    return json({ ok: true, year, sundays: sundays.length, inserted, skipped });
  }

  if (seg === 'attendance/bulk-sunday' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const date = b.service_date || '';
    const name = b.service_name || '';
    const ids = [];
    for (const [time, att, com] of [['08:00', parseInt(b.att_8)||0, parseInt(b.com_8)||0], ['10:45', parseInt(b.att_1045)||0, parseInt(b.com_1045)||0]]) {
      const r = await db.prepare(
        `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(date, time, name, 'sunday', att, com, b.notes||'').run();
      ids.push(r.meta?.last_row_id);
    }
    return json({ ok: true, ids });
  }

  if (seg === 'attendance/sunday-name' && method === 'GET') {
    const date = url.searchParams.get('date') || '';
    // Check scheduler_data for custom label
    try {
      const row = await db.prepare("SELECT value FROM scheduler_data WHERE key='ws_sun_labels'").first();
      if (row?.value) {
        const labels = JSON.parse(row.value);
        if (labels[date]) return json({ name: labels[date] });
      }
    } catch {}
    return json({ name: '' });
  }

  if (seg === 'reports/attendance-summary' && method === 'GET') {
    const yearsParam = url.searchParams.get('years') || String(new Date().getFullYear());
    const years = yearsParam.split(',').map(y => y.trim()).filter(Boolean).slice(0, 6);
    // For each year, get monthly Sunday combined totals
    const result = {};
    for (const yr of years) {
      const rows = (await db.prepare(
        `SELECT strftime('%m', service_date) as month,
                ROUND(SUM(attendance) * 1.0 / COUNT(DISTINCT service_date)) as total,
                COUNT(DISTINCT service_date) as sundays,
                SUM(attendance) as monthly_total,
                SUM(CASE WHEN service_time='08:00' THEN attendance ELSE 0 END) as att_8,
                SUM(CASE WHEN service_time='10:45' THEN attendance ELSE 0 END) as att_1045
         FROM worship_services
         WHERE service_type='sunday' AND attendance > 0 AND substr(service_date,1,4)=?
         GROUP BY month ORDER BY month`
      ).bind(yr).all()).results || [];
      result[yr] = rows;
    }
    // Also per-year totals
    const totals = {};
    for (const yr of years) {
      const t = await db.prepare(
        `SELECT SUM(attendance) as total, COUNT(DISTINCT service_date) as sundays
         FROM worship_services WHERE service_type='sunday' AND attendance > 0 AND substr(service_date,1,4)=?`
      ).bind(yr).first();
      totals[yr] = t || { total: 0, sundays: 0 };
    }
    return json({ years, monthly: result, totals });
  }

  if (seg === 'reports/attendance-by-time' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    if (yearsParam) {
      const years = yearsParam.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y)).slice(0, 10);
      const by_time_years = {};
      await Promise.all(years.map(async yr => {
        const rows = (await db.prepare(
          `SELECT service_time, service_type,
                  MAX(service_name) as service_name,
                  COUNT(*) as services, SUM(attendance) as total,
                  ROUND(AVG(attendance)) as avg_attendance
           FROM worship_services
           WHERE attendance > 0 AND service_date BETWEEN ? AND ?
           GROUP BY service_type, service_time ORDER BY service_type, service_time`
        ).bind(yr + '-01-01', yr + '-12-31').all()).results || [];
        by_time_years[yr] = rows;
      }));
      return json({ mode: 'multi-year', years, by_time_years });
    }
    const from = url.searchParams.get('from') || (new Date().getFullYear() + '-01-01');
    const to   = url.searchParams.get('to')   || (new Date().getFullYear() + '-12-31');
    const rows = (await db.prepare(
      `SELECT service_time, service_type,
              MAX(service_name) as service_name,
              COUNT(*) as services, SUM(attendance) as total,
              ROUND(AVG(attendance)) as avg_attendance
       FROM worship_services
       WHERE attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY service_type, service_time ORDER BY service_type, service_time`
    ).bind(from, to).all()).results || [];
    // Sunday combined totals per date
    const sundays = (await db.prepare(
      `SELECT service_date, SUM(attendance) as combined,
              MIN(CASE WHEN service_time='08:00' THEN attendance END) as att_8,
              MIN(CASE WHEN service_time='10:45' THEN attendance END) as att_1045
       FROM worship_services
       WHERE service_type='sunday' AND attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY service_date ORDER BY service_date ASC`
    ).bind(from, to).all()).results || [];
    return json({ mode: 'date-range', from, to, by_time: rows, sundays });
  }

  // ── Import / Config / Register / Export / Breeze Sync → api-import.js ──
  return await handleImportApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
}

// ── ChMS SEED DEFAULTS ──────────────────────────────────────────────
