import { runBudgetedReadBatch } from './query-budget.js';

const CLASSIFICATIONS = new Set(['Income', 'Expenses']);

export async function readSyntheticChurchReport(db) {
  const sql = "SELECT fiscal_year, classification, account_name, own_actual_cents, own_budget_cents FROM finance_church_entries WHERE source='synthetic_fixture' ORDER BY classification, account_name";
  const { results } = await runBudgetedReadBatch(db, 'churchReport', [sql]);
  const rows = results[0]?.results;
  if (!Array.isArray(rows) || rows.length === 0 || rows.some((row) =>
    !Number.isInteger(row.fiscal_year)
    || !CLASSIFICATIONS.has(row.classification)
    || typeof row.account_name !== 'string'
    || !Number.isInteger(row.own_actual_cents)
    || !Number.isInteger(row.own_budget_cents)
  )) throw new Error('Synthetic Church Report rows invalid');
  return rows.map((row) => ({ ...row }));
}

export function buildChurchReportView(rows) {
  const income = rows.filter((row) => row.classification === 'Income');
  const expenses = rows.filter((row) => row.classification === 'Expenses');
  const sum = (items, key) => items.reduce((total, row) => total + row[key], 0);
  const incomeActualCents = sum(income, 'own_actual_cents');
  const expenseActualCents = sum(expenses, 'own_actual_cents');
  const incomeBudgetCents = sum(income, 'own_budget_cents');
  const expenseBudgetCents = sum(expenses, 'own_budget_cents');
  return {
    fiscalYear: rows[0]?.fiscal_year || null,
    income,
    expenses,
    totals: {
      incomeActualCents,
      expenseActualCents,
      actualNetCents: incomeActualCents - expenseActualCents,
      budgetNetCents: incomeBudgetCents - expenseBudgetCents,
    },
  };
}
