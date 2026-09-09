import { describe, expect, it } from 'vitest';
import { buildFinancialHealthView } from '../apps/finance/health-view-model.js';

describe('isolated Financial Health view model', () => {
  it('derives the existing decision-oriented concepts from synthetic aggregates', () => {
    const view = buildFinancialHealthView({
      church: {
        income_actual_cents: 12000000, expense_actual_cents: 8000000,
        income_budget_cents: 12500000, expense_budget_cents: 8500000,
      },
      balanceSheet: { assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 },
    }, {
      totals: { grossCents: 150000, refundCents: 5000, netCents: 145000 },
      reconciliation: { sourceRecordCount: 6, totalsMatch: true },
    });

    expect(view.operating).toEqual({
      incomeActualCents: 12000000, expenseActualCents: 8000000,
      actualNetCents: 4000000, budgetNetCents: 4000000, varianceCents: 0,
    });
    expect(view.position).toEqual({ assetsCents: 30000000, liabilitiesCents: 10000000, netAssetsCents: 20000000 });
    expect(view.giving).toMatchObject({ grossCents: 150000, refundCents: 5000, netCents: 145000, sourceRecordCount: 6, reconciled: true });
    expect(view.decisions.map(({ authority }) => authority)).toEqual([
      'Full control', 'Reported, not managed', 'Timing decision',
    ]);
  });
});
