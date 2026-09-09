import { describe, expect, it } from 'vitest';
import {
  buildSummaryV1,
  FINANCE_SUMMARY_CONTRACT,
  readSyntheticSummary,
} from '../apps/finance/summary-service.js';

const rows = [
  { results: [{ value: 'SYNTHETIC-NO-PRODUCTION-DATA' }] },
  { results: [{ actual_cents: 20000000, budget_cents: 21000000, income_actual_cents: 12000000, expense_actual_cents: 8000000, income_budget_cents: 12500000, expense_budget_cents: 8500000 }] },
  { results: [{ balance_cents: 60000000, assets_cents: 30000000, liabilities_cents: 10000000, equity_cents: 20000000 }] },
  { results: [{ room_count: 1, billed_cents: 4000000 }] },
];

function dbWith(results = rows) {
  return {
    prepare(sql) { return { sql }; },
    async batch(statements) {
      expect(statements).toHaveLength(4);
      expect(statements.every(({ sql }) => /^SELECT\b/.test(sql))).toBe(true);
      return results;
    },
  };
}

describe('Finance summary service boundary', () => {
  it('owns the synthetic read and closed contract assembly outside the HTTP shell', async () => {
    const summary = await readSyntheticSummary(dbWith());
    expect(buildSummaryV1({ version: 'test' }, summary)).toEqual({
      contract: FINANCE_SUMMARY_CONTRACT,
      dataClassification: 'synthetic',
      release: { version: 'test' },
      summary: {
        church: { actualCents: 20000000, budgetCents: 21000000 },
        balanceSheet: { balanceCents: 60000000 },
        childcare: { roomCount: 1, billedCents: 4000000 },
      },
    });
  });

  it('fails closed when the dedicated database lacks the synthetic marker', async () => {
    const invalid = structuredClone(rows);
    invalid[0].results[0].value = 'unexpected';
    await expect(readSyntheticSummary(dbWith(invalid))).rejects.toThrow('Synthetic fixture marker missing');
  });
});
