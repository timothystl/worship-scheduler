import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS } from '../src/html-chms.js';

// Cover for the 'directory' permission item (People/Households/Organizations editing): every
// add/edit control for a person, household or organization in html-tabs.js carries the bare
// .require-edit class (confirmed by grep — no unrelated usage exists), so applyPermissionUI()
// now toggles that class's visibility from permEdit('directory') instead of leaving it always on.
// Directory READS are unconditional for every non-member role and are not touched by this.
//
// Minimal fake DOM, matching the pattern in finance-nav-permission-visibility.test.js: elements
// are plain objects with an id, a className string and a style object.
function makeEl(id, className) {
  return { id, className: className || '', style: {} };
}
function makeCtx() {
  const elements = [
    makeEl('add-person-btn', 'btn require-edit'),
    makeEl('new-household-btn', 'btn require-edit'),
    makeEl('new-org-btn', 'btn require-edit'),
  ];
  const document = {
    getElementById(id) { return elements.filter(e => e.id === id)[0] || null; },
    querySelectorAll(sel) {
      const cls = sel.replace(/^\./, '');
      return elements.filter(e => (e.className || '').split(/\s+/).includes(cls));
    },
    querySelector() { return null; },
    body: { classList: { add() {}, remove() {}, toggle() {} } },
    addEventListener() {}, createElement() { return makeEl(null, ''); },
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  ctx.__elements = elements;
  return ctx;
}

let ctx;
beforeEach(() => { ctx = makeCtx(); });

function editEls() { return ctx.__elements.filter(e => (e.className || '').includes('require-edit')); }

describe('applyPermissionUI — Directory (People/Households/Organizations) edit controls', () => {
  it('hides Add Person / New Household / New Organization for council (default: directory view-only)', () => {
    ctx._userRole = 'council';
    ctx.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'none', directory: 'view', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    editEls().forEach(el => expect(el.style.display).toBe('none'));
  });

  it('shows them for finance (default: directory edit)', () => {
    ctx._userRole = 'finance';
    ctx.applyPermissionUI({ giving: 'edit', tuitionaid: 'edit', finance: 'edit', compensation: 'edit', budget: 'edit', directory: 'edit', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    editEls().forEach(el => expect(el.style.display).not.toBe('none'));
  });

  it('shows them for staff (default: directory edit)', () => {
    ctx._userRole = 'staff';
    ctx.applyPermissionUI({ giving: 'none', tuitionaid: 'none', finance: 'none', compensation: 'none', budget: 'none', directory: 'edit', attendance: 'edit', followups: 'edit', audit: 'none', register: 'edit', reports: 'view' });
    editEls().forEach(el => expect(el.style.display).not.toBe('none'));
  });

  it('hides them for member (default: directory none)', () => {
    ctx._userRole = 'member';
    ctx.applyPermissionUI({ giving: 'none', tuitionaid: 'none', finance: 'none', compensation: 'none', budget: 'none', directory: 'none', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'none' });
    editEls().forEach(el => expect(el.style.display).toBe('none'));
  });

  it('follows an admin override narrowing council to view-only', () => {
    ctx._userRole = 'council';
    ctx.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'none', directory: 'view', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    editEls().forEach(el => expect(el.style.display).toBe('none'));
  });

  it('follows an admin override widening council to edit', () => {
    ctx._userRole = 'council';
    ctx.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'none', directory: 'edit', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    editEls().forEach(el => expect(el.style.display).not.toBe('none'));
  });
});
