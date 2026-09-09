import { describe, it, expect } from 'vitest';
import {
  resolveRolePermissions, permissionsForRole, DEFAULT_ROLE_PERMISSIONS,
  ROLE_PERMISSION_ROLES, ROLE_PERMISSION_ITEM_KEYS, ROLE_PERMISSION_LEVELS,
  isAnonSafeGivingSeg,
} from '../src/api-utils.js';

describe('resolveRolePermissions', () => {
  it('returns the exact defaults when nothing is stored', () => {
    expect(resolveRolePermissions(null)).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('returns defaults for an empty string / undefined / malformed JSON', () => {
    expect(resolveRolePermissions('')).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveRolePermissions(undefined)).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveRolePermissions('{not valid json')).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('defaults preserve historical access exactly', () => {
    const d = DEFAULT_ROLE_PERMISSIONS;
    // finance = giving/tuition/finance/compensation/budget edit + reports view. Finance is
    // split three ways (finance/compensation/budget — see financeSegItems in api-chms.js) but
    // finance role's default is 'edit' on all three, so its effective access is unchanged.
    expect(d.finance).toEqual({ giving: 'edit', tuitionaid: 'edit', finance: 'edit', compensation: 'edit', budget: 'edit', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    // staff = attendance/follow-ups/register edit + reports view. Audit is admin-only (removed
    // from staff per the Preparation 5 governance decision, issue #844). All three Finance
    // items default 'none', same as before the split.
    expect(d.staff.attendance).toBe('edit');
    expect(d.staff.register).toBe('edit');
    expect(d.staff.audit).toBe('none');
    expect(d.staff.giving).toBe('none');
    expect(d.staff.finance).toBe('none');
    expect(d.staff.compensation).toBe('none');
    expect(d.staff.budget).toBe('none');
    // council = no register access at all (its edit access was removed per the same #844
    // decision: Council is a reporting/oversight tier, not an operational one), plus Reports to
    // read and giving only in aggregate. Unlike finance/staff, council's plain `finance` item
    // (the rest of the Finance workspace — Church Report, Balance Sheet, etc.) defaults to
    // 'none' — its Finance access is meant to be exactly the Compensation Planner, granted
    // through the independent `compensation` item ('edit' by default, so a council member can
    // save their own plan out of the box) and, if an admin turns it on, `budget` ('none' by
    // default).
    expect(d.council.register).toBe('none');
    expect(d.council.finance).toBe('none');
    expect(d.council.compensation).toBe('edit');
    expect(d.council.budget).toBe('none');
    expect(d.council.reports).toBe('view');
    expect(d.council.giving).toBe('anon');
    // member = nothing extra
    expect(d.member.reports).toBe('none');
    expect(d.member.compensation).toBe('none');
    expect(d.member.budget).toBe('none');
  });

  it('applies a partial override without disturbing other items/roles', () => {
    const perms = resolveRolePermissions(JSON.stringify({ council: { reports: 'none' } }));
    expect(perms.council.reports).toBe('none');
    // untouched council items keep their default
    expect(perms.council.register).toBe('none');
    expect(perms.council.giving).toBe('anon');
    // other roles unaffected
    expect(perms.finance).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(perms.staff).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
  });

  it('clamps read-only items (reports/audit) to view even if edit is requested', () => {
    const perms = resolveRolePermissions(JSON.stringify({ staff: { reports: 'edit', audit: 'edit' } }));
    expect(perms.staff.reports).toBe('view');
    expect(perms.staff.audit).toBe('view');
  });

  it('coerces an unknown level string to none', () => {
    const perms = resolveRolePermissions(JSON.stringify({ council: { giving: 'superuser' } }));
    expect(perms.council.giving).toBe('none');
  });

  it('member can never be granted edit and only the safe reports item is honored', () => {
    const perms = resolveRolePermissions(JSON.stringify({
      member: { reports: 'edit', giving: 'edit', attendance: 'view', register: 'edit' },
    }));
    expect(perms.member.reports).toBe('view');   // edit clamped to view
    expect(perms.member.giving).toBe('none');    // not a member-safe item
    expect(perms.member.attendance).toBe('none');
    expect(perms.member.register).toBe('none');
  });

  it('migrates a legacy boolean matrix forward, preserving effective access', () => {
    const legacy = {
      finance: { finance: true,  staff: false, register: false, reports: true },
      staff:   { finance: false, staff: true,  register: true,  reports: true },
      office:  { finance: false, staff: false, register: true,  reports: false },
    };
    const perms = resolveRolePermissions(JSON.stringify(legacy));
    expect(perms.finance).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    // audit is always 'none' out of the legacy migration now (Preparation 5 / #844 made it
    // admin-only outright, not staff-view), which is also today's staff default — so this
    // still lands on an exact match.
    expect(perms.staff).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
    // The legacy row is keyed `office`, the role it configures is now `council`, and its
    // booleans resolve to register-edit only — so it lands as the pre-rename office grant
    // (register 'edit', not today's 'none' default), NOT the new council default (which adds
    // reports/anon giving/compensation and has register at 'none').
    expect(perms.council.register).toBe('edit');
    expect(perms.council.giving).toBe('none');
    expect(perms.council.finance).toBe('none');
    // compensation/budget aren't part of the legacy shape at all, so they fall through to
    // council's own defaults untouched by the migration.
    expect(perms.council.compensation).toBe('edit');
    expect(perms.council.budget).toBe('none');
  });

  it('every role in the defaults has every item defined with a valid level', () => {
    for (const role of ROLE_PERMISSION_ROLES) {
      for (const item of ROLE_PERMISSION_ITEM_KEYS) {
        expect(ROLE_PERMISSION_LEVELS).toContain(DEFAULT_ROLE_PERMISSIONS[role][item]);
      }
    }
  });
});

describe('permissionsForRole', () => {
  const perms = resolveRolePermissions(null);

  it('admin always gets each item at its ceiling (edit where editable, view for read-only)', () => {
    const a = permissionsForRole(perms, 'admin');
    expect(a.giving).toBe('edit');
    expect(a.register).toBe('edit');
    expect(a.reports).toBe('view');   // read-only item
    expect(a.audit).toBe('view');
  });

  it('finance/staff/council/member get their resolved matrix entry', () => {
    expect(permissionsForRole(perms, 'finance')).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(permissionsForRole(perms, 'staff')).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
    expect(permissionsForRole(perms, 'council')).toEqual(DEFAULT_ROLE_PERMISSIONS.council);
    expect(permissionsForRole(perms, 'member')).toEqual(DEFAULT_ROLE_PERMISSIONS.member);
  });

  it('an unknown/garbage role string gets all-none rather than throwing', () => {
    const r = permissionsForRole(perms, 'not_a_real_role');
    for (const item of ROLE_PERMISSION_ITEM_KEYS) expect(r[item]).toBe('none');
  });

  it('reflects a granted override for a role that did not have it by default', () => {
    const granted = resolveRolePermissions(JSON.stringify({ council: { attendance: 'view' } }));
    expect(permissionsForRole(granted, 'council').attendance).toBe('view');
    // and edit for an item that was none by default
    const granted2 = resolveRolePermissions(JSON.stringify({ finance: { register: 'edit' } }));
    expect(permissionsForRole(granted2, 'finance').register).toBe('edit');
  });
});

// ── Anonymous giving ('anon') ────────────────────────────────────────────────
// The level the Council role runs on: aggregate giving figures, never a donor's identity.
describe("giving:'anon'", () => {
  it('is accepted on giving and normalized to none on every other item', () => {
    const every = {};
    for (const item of ROLE_PERMISSION_ITEM_KEYS) every[item] = 'anon';
    const perms = resolveRolePermissions(JSON.stringify({ staff: every }));
    expect(perms.staff.giving).toBe('anon');
    for (const item of ROLE_PERMISSION_ITEM_KEYS) {
      if (item !== 'giving') expect(perms.staff[item]).toBe('none');
    }
  });

  it('is never granted to a member, who gets no giving access at all', () => {
    const perms = resolveRolePermissions(JSON.stringify({ member: { giving: 'anon' } }));
    expect(perms.member.giving).toBe('none');
    expect(permissionsForRole(perms, 'member').giving).toBe('none');
  });

  it('leaves admin at full access — anon is never something admin resolves to', () => {
    const perms = resolveRolePermissions(JSON.stringify({ council: { giving: 'anon' } }));
    expect(permissionsForRole(perms, 'admin').giving).toBe('edit');
  });

  it('can be upgraded to full giving access by an admin, and back down', () => {
    const up = resolveRolePermissions(JSON.stringify({ council: { giving: 'view' } }));
    expect(permissionsForRole(up, 'council').giving).toBe('view');
    const down = resolveRolePermissions(JSON.stringify({ council: { giving: 'none' } }));
    expect(permissionsForRole(down, 'council').giving).toBe('none');
  });
});

describe('isAnonSafeGivingSeg', () => {
  it('allows the aggregate giving reports', () => {
    for (const seg of [
      'giving/stats', 'reports/giving-summary', 'reports/giving-by-method',
      'reports/giving-trend', 'reports/giving-multiyear', 'reports/giving-distribution',
      'reports/giving-vs-attendance', 'reports/giving-board',
    ]) expect(isAnonSafeGivingSeg(seg)).toBe(true);
  });

  it('refuses every endpoint that can name a donor', () => {
    for (const seg of [
      // per-donor reports
      'reports/giving-insights', 'reports/giving-yoy', 'reports/giving-plateaus',
      'reports/giving-bands', 'reports/giving-statement', 'reports/giving-statement-household',
      // the offerings workflow
      'giving', 'giving/batches', 'giving/batches/7', 'giving/batches/7/entries',
      'giving/entries/3', 'giving/transactions', 'giving/quick-entry',
      'giving/deposits', 'giving/deposits/2', 'giving/unassigned-gifts',
      'giving/offerings-summary', 'giving/deposit-options', 'giving/deposit-lines',
      // communications + forensics
      'giving/letters/status', 'giving/letters/mark', 'giving/nudges/status',
      'giving/receipts/queue', 'giving/reconcile-diagnose', 'giving/force-remove-orphans',
    ]) expect(isAnonSafeGivingSeg(seg)).toBe(false);
  });

  it('is an exact match, so a longer path cannot ride in on an allowed prefix', () => {
    expect(isAnonSafeGivingSeg('giving/stats/by-person')).toBe(false);
    expect(isAnonSafeGivingSeg('reports/giving-summary-detail')).toBe(false);
    expect(isAnonSafeGivingSeg('')).toBe(false);
    expect(isAnonSafeGivingSeg(undefined)).toBe(false);
  });
});
