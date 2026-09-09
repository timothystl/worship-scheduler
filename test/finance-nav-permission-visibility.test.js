import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS } from '../src/html-chms.js';

// Regression cover for a bug shipped alongside the Compensation/Budget permission split: the
// "Financial Reports" sidebar link itself (.require-financeov in html-head.js) was gated purely
// on the 'finance' item, so a council member holding only 'compensation' (the default — see
// api-utils.js) could never even see the link to click into the tab, despite having real access
// underneath. applyPermissionUI() now treats it (and the Finance section header) as visible if
// ANY of finance/compensation/budget is granted, matching financeSegItems' server-side reasoning.
//
// Minimal fake DOM: elements are plain objects with an id, a className string and a style object;
// querySelectorAll('.foo') filters by class, getElementById by id — enough for applyPermissionUI,
// which never does anything more elaborate than that.
function makeEl(id, className) {
  return { id, className: className || '', style: {} };
}
function makeCtx() {
  const elements = [
    makeEl('s-hdr-finance', 's-section-hdr require-finance'),
    makeEl(null, 's-item require-financeov'),
    makeEl(null, 's-item require-finance'),
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

function financeovEl() { return ctx.__elements.filter(e => (e.className || '').includes('require-financeov'))[0]; }
function financeHdr() { return ctx.__elements.filter(e => e.id === 's-hdr-finance')[0]; }

describe('applyPermissionUI — the Financial Reports sidebar link', () => {
  it('shows it for council\'s actual default (finance:none, compensation:edit, budget:none)', () => {
    ctx._userRole = 'council';
    ctx.applyPermissionUI({ finance: 'none', compensation: 'edit', budget: 'none', giving: 'anon', tuitionaid: 'none', attendance: 'none', register: 'none', reports: 'view' });
    expect(financeovEl().style.display).not.toBe('none');
    expect(financeHdr().style.display).not.toBe('none');
  });

  it('shows it when only budget is granted, with compensation and finance both none', () => {
    ctx._userRole = 'council';
    ctx.applyPermissionUI({ finance: 'none', compensation: 'none', budget: 'view', giving: 'none', tuitionaid: 'none', attendance: 'none', register: 'none', reports: 'none' });
    expect(financeovEl().style.display).not.toBe('none');
  });

  it('hides it when none of the three Finance items are granted', () => {
    ctx._userRole = 'staff';
    ctx.applyPermissionUI({ finance: 'none', compensation: 'none', budget: 'none', giving: 'none', tuitionaid: 'none', attendance: 'edit', register: 'edit', reports: 'view' });
    expect(financeovEl().style.display).toBe('none');
    // The Finance header itself has nothing under it either (no giving/tuitionaid/finance-family
    // access), so it should also be hidden.
    expect(financeHdr().style.display).toBe('none');
  });

  it('shows the header (but not necessarily the Financial Reports link) purely from Giving access', () => {
    ctx._userRole = 'finance';
    ctx.applyPermissionUI({ finance: 'none', compensation: 'none', budget: 'none', giving: 'edit', tuitionaid: 'none', attendance: 'none', register: 'none', reports: 'none' });
    expect(financeHdr().style.display).not.toBe('none');
    expect(financeovEl().style.display).toBe('none');
  });

  it('always shows it for admin regardless of the (irrelevant) permissions object', () => {
    ctx._userRole = 'admin';
    ctx.applyPermissionUI({ finance: 'none', compensation: 'none', budget: 'none' });
    expect(financeovEl().style.display).not.toBe('none');
  });
});
