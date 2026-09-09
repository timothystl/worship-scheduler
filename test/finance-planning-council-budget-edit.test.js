import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { CHMS_APP_CORE_JS, CHMS_APP_EXT_JS, CHMS_APP_FINANCE_JS } from '../src/html-chms.js';

// Andrew reported (2026-09-09): "i gave council budget edit access but still cant edit" — this
// exercises finRenderPlanning() (js-finance.js) end to end for council with budget:'edit', the
// same harness technique as finance-planning-chart-of-accounts.test.js.
function loadBundle(els) {
  const store = els || {};
  const el = () => ({
    innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, focus() {}, setSelectionRange() {},
  });
  const document = {
    getElementById(id) { return store[id] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement: el, addEventListener() {}, body: el(), documentElement: el(), activeElement: null,
  };
  const ctx = {
    document, console, setTimeout, clearTimeout, Math, JSON, Date, parseFloat, parseInt, isFinite,
    Number, String, Object, Array, encodeURIComponent, decodeURIComponent,
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: () => Promise.resolve({ status: 200, ok: true, json: async () => ({ ok: true }) }),
    navigator: {}, location: { href: '', hash: '' },
    addEventListener() {}, removeEventListener() {}, scrollTo() {}, requestAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    confirm: () => true, alert() {}, print() {},
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(CHMS_APP_CORE_JS, ctx, { filename: 'app-core.js' });
  vm.runInContext(CHMS_APP_EXT_JS, ctx, { filename: 'app-ext.js' });
  vm.runInContext(CHMS_APP_FINANCE_JS, ctx, { filename: 'app-finance.js' });
  return ctx;
}

function node(path, label, classification, depth, actualCents, budgetCents) {
  return {
    path, label, classification, depth,
    ownActualCents: actualCents, ownBudgetCents: budgetCents ?? null,
    totalActualCents: actualCents, totalBudgetCents: budgetCents || 0,
    hasBudgetInfo: budgetCents != null,
    children: [],
  };
}
function fixtureTree() {
  return [node('Expenses:52010 Utilities', '52010 Utilities', 'Expenses', 0, 400000, 420000)];
}
function baseSetup(fin, tree) {
  fin._finPlanBaseTree = tree;
  fin._finPlanBaseYear = 2026;
  fin._finPlanTargetYear = 2027;
  fin._finPlanBaseNet = { actualCents: 0, budgetCents: 0 };
  fin._finPlanRows = [];
  fin._finPlanEdits = {};
  fin._finPlanBaseProjEdits = {};
  fin._finPlanBaseProjOverrides = {};
  fin._finPlanActualEdits = {};
  fin._finPlanExcluded = {};
  fin._finPlanPicking = false;
  fin._finPlanCols = { bud: true, act: true, proj: true, plan: true, delta: true };
  fin._finPlanBoardCats = { revenue: {}, expense: {}, revenueLabels: {}, expenseLabels: {} };
}

const rowsOf = (html) => html.split('<tr').slice(1).map(r => '<tr' + r);
const textOf = (row) => row.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

describe('Planning table — council with budget:\'edit\' can hand-correct the Plan column', () => {
  it('renders an editable Plan input for council once permEdit(\'budget\') is true', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._userRole = 'council';
    fin.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'edit', directory: 'view', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    fin.finRenderPlanning();
    const account = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('52010 Utilities'));
    expect(account, root.innerHTML).toContain('finPlanEditCell');
    expect(account).toContain('<input');
  });

  it('shows a plain figure, not an input, for council at the default budget:\'view\'', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._userRole = 'council';
    fin.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'view', directory: 'view', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    fin.finRenderPlanning();
    const account = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('52010 Utilities'));
    expect(account).not.toContain('finPlanEditCell');
  });

  it('shows the Save Changes button and status line for council once granted budget:\'edit\', without Generate All', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._userRole = 'council';
    fin.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'edit', directory: 'view', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    fin.finRenderPlanning();
    expect(root.innerHTML).toContain('finPlanSaveAll()');
    expect(root.innerHTML).toContain('fin-plan-msg');
    expect(root.innerHTML).not.toContain('finPlanGenerateAll()');
    expect(root.innerHTML).not.toContain('finPlanCommit()');
  });

  it('never shows the Plan input or Save button for council with budget:\'none\'', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._userRole = 'council';
    fin.applyPermissionUI({ giving: 'anon', tuitionaid: 'none', finance: 'none', compensation: 'edit', budget: 'none', directory: 'view', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    fin.finRenderPlanning();
    expect(root.innerHTML).not.toContain('finPlanEditCell');
    expect(root.innerHTML).not.toContain('finPlanSaveAll()');
  });

  it('still shows admin the full Plan input + Generate All / Commit controls, unaffected', () => {
    const root = { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } };
    const fin = loadBundle({ 'fin-plan-root': root });
    baseSetup(fin, fixtureTree());
    fin._userRole = 'admin';
    fin.finRenderPlanning();
    const account = rowsOf(root.innerHTML).find(r => textOf(r).startsWith('52010 Utilities'));
    expect(account).toContain('finPlanEditCell');
    expect(root.innerHTML).toContain('finPlanGenerateAll()');
  });
});
