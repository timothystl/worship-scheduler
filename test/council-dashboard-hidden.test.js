import { describe, it, expect, beforeEach } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS } from '../src/html-chms.js';

// Andrew asked (2026-09-09) to hide the Home dashboard for council — its stat cards (giving
// totals, member counts, etc.) aren't part of council's reporting/oversight role. The sidebar
// link itself is hidden by CSS (.role-council .s-item[data-tab="home"] in html-head.js); this
// covers the real enforcement in showTab() (js-core.js), which redirects council away from
// 'home' to 'people' the same way it already does for member/volunteer/compensation — so a
// stale '#home' in the URL, or the logo click (which also calls showTab('home')), can't land
// council on the dashboard either.
//
// Minimal fake DOM: elements are plain objects with an id, a className string, a style object
// and a classList good enough for showTab's own bookkeeping (active-tab toggling) — the same
// shape finance-nav-permission-visibility.test.js and directory-permission-edit-visibility.test.js
// use, extended with dataset.tab and a classList since showTab reads/writes both.
function makeEl(id, className, dataTab) {
  const classes = new Set((className || '').split(/\s+/).filter(Boolean));
  const el = {
    id, style: {}, dataset: dataTab ? { tab: dataTab } : {},
    get className() { return Array.from(classes).join(' '); },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (on ? classes.add(c) : classes.delete(c))),
    },
  };
  return el;
}
function makeCtx() {
  const elements = [
    makeEl('tab-home', 'tab-panel'),
    makeEl('tab-people', 'tab-panel'),
    makeEl(null, 's-item', 'home'),
    makeEl(null, 's-item', 'people'),
    makeEl('topbar-title', ''),
    makeEl('p-grid', ''),
    makeEl('p-contact-list', ''),
  ];
  const document = {
    getElementById(id) { return elements.filter(e => e.id === id)[0] || null; },
    querySelectorAll(sel) {
      if (sel === '.s-item[data-tab]') return elements.filter(e => e.dataset && e.dataset.tab);
      if (sel === '.tab-panel') return elements.filter(e => (e.className || '').split(/\s+/).includes('tab-panel'));
      const cls = sel.replace(/^\./, '');
      return elements.filter(e => (e.className || '').split(/\s+/).includes(cls));
    },
    querySelector() { return null; },
    body: { classList: { add() {}, remove() {}, toggle() {} } },
    addEventListener() {}, createElement() { return makeEl(null, ''); },
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent, URLSearchParams,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in tests')),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    history: { pushState() {}, replaceState() {} },
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

function activeTabId() {
  return ctx.__elements.filter(e => (e.className || '').split(/\s+/).includes('tab-panel') && e.classList.contains('active'))[0]?.id;
}

describe('showTab() — council redirected away from the Home dashboard', () => {
  it('redirects home -> people for council', () => {
    ctx._userRole = 'council';
    ctx._userPermissions = { finance: false, staff: false, register: false, reports: true };
    ctx.showTab('home');
    expect(activeTabId()).toBe('tab-people');
  });

  it('leaves home alone for every other configurable/admin role', () => {
    for (const role of ['admin', 'finance', 'staff']) {
      ctx._userRole = role;
      ctx._userPermissions = { finance: true, staff: true, register: true, reports: true };
      ctx.showTab('home');
      expect(activeTabId(), role).toBe('tab-home');
    }
  });

  it('still lets council reach people directly (unaffected by the redirect)', () => {
    ctx._userRole = 'council';
    ctx._userPermissions = { finance: false, staff: false, register: false, reports: true };
    ctx.showTab('people');
    expect(activeTabId()).toBe('tab-people');
  });
});
