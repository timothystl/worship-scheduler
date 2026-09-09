import { runBudgetedReadBatch } from './query-budget.js';

export const FINANCE_SUMMARY_CONTRACT = 'finance.summary.v1';

export async function readSyntheticSummary(db) {
  const statements = [
    "SELECT value FROM finance_settings WHERE key='fixture_label'",
    'SELECT COALESCE(SUM(own_actual_cents),0) AS actual_cents, COALESCE(SUM(own_budget_cents),0) AS budget_cents FROM finance_church_entries',
    'SELECT COALESCE(SUM(own_balance_cents),0) AS balance_cents FROM finance_church_balances',
    'SELECT COUNT(*) AS room_count, COALESCE(SUM(billed_cents),0) AS billed_cents FROM finance_daycare_rooms',
  ];
  const { results } = await runBudgetedReadBatch(db, 'summary', statements);
  const first = (index) => results[index]?.results?.[0] || {};
  if (first(0).value !== 'SYNTHETIC-NO-PRODUCTION-DATA') {
    throw new Error('Synthetic fixture marker missing');
  }
  return { church: first(1), balanceSheet: first(2), childcare: first(3) };
}

export function buildSummaryV1(metadata, summary) {
  return {
    contract: FINANCE_SUMMARY_CONTRACT,
    dataClassification: 'synthetic',
    release: metadata,
    summary: {
      church: {
        actualCents: Number(summary.church.actual_cents || 0),
        budgetCents: Number(summary.church.budget_cents || 0),
      },
      balanceSheet: { balanceCents: Number(summary.balanceSheet.balance_cents || 0) },
      childcare: {
        roomCount: Number(summary.childcare.room_count || 0),
        billedCents: Number(summary.childcare.billed_cents || 0),
      },
    },
  };
}
