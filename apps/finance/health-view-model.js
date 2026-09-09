export function buildFinancialHealthView(summary, giving) {
  const incomeActualCents = Number(summary.church.income_actual_cents || 0);
  const expenseActualCents = Number(summary.church.expense_actual_cents || 0);
  const incomeBudgetCents = Number(summary.church.income_budget_cents || 0);
  const expenseBudgetCents = Number(summary.church.expense_budget_cents || 0);
  const actualNetCents = incomeActualCents - expenseActualCents;
  const budgetNetCents = incomeBudgetCents - expenseBudgetCents;

  return {
    operating: {
      incomeActualCents,
      expenseActualCents,
      actualNetCents,
      budgetNetCents,
      varianceCents: actualNetCents - budgetNetCents,
    },
    position: {
      assetsCents: Number(summary.balanceSheet.assets_cents || 0),
      liabilitiesCents: Number(summary.balanceSheet.liabilities_cents || 0),
      netAssetsCents: Number(summary.balanceSheet.equity_cents || 0),
    },
    giving: {
      grossCents: Number(giving.totals.grossCents || 0),
      refundCents: Number(giving.totals.refundCents || 0),
      netCents: Number(giving.totals.netCents || 0),
      sourceRecordCount: Number(giving.reconciliation.sourceRecordCount || 0),
      reconciled: giving.reconciliation.totalsMatch === true,
    },
    decisions: [
      { stream: 'Donor income', authority: 'Full control', action: 'Set the ask and stewardship plan' },
      { stream: 'Earned income', authority: 'Reported, not managed', action: 'Review operating performance' },
      { stream: 'Passive income', authority: 'Timing decision', action: 'Decide distribution timing' },
    ],
  };
}
