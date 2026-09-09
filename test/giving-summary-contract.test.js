import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = JSON.parse(fs.readFileSync(new URL('../contracts/giving-summary-v1.schema.json', import.meta.url), 'utf8'));
const example = JSON.parse(fs.readFileSync(new URL('../contracts/examples/giving-summary-v1.synthetic.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function collectPropertyNames(value, names = []) {
  if (!value || typeof value !== 'object') return names;
  if (value.properties) names.push(...Object.keys(value.properties));
  for (const child of Object.values(value)) collectPropertyNames(child, names);
  return names;
}

describe('Connect to Finance Giving summary contract v1', () => {
  it('is a closed, versioned aggregate-only interface', () => {
    expect(schema.$id).toBe('urn:timothy:connect:giving-summary:v1');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.contract.const).toBe('connect.giving-summary.v1');
    expect(schema.properties.dataClassification.const).toBe('aggregate');
    expect(schema.properties.sourceProduct.const).toBe('connect');
    expect(schema.properties.consumerProduct.const).toBe('finance');
    expect(schema.$defs.fund.additionalProperties).toBe(false);
  });

  it('contains no donor, person, gift-row, address, or contact identifier field', () => {
    const names = collectPropertyNames(schema).join(' ');
    expect(names).not.toMatch(/donor|person|individual|giftId|householdId|email|phone|address/i);
  });

  it('uses integer cents and reconciles the synthetic example', () => {
    const sum = (key) => example.funds.reduce((total, fund) => total + fund.amounts[key], 0);
    expect(example.contract).toBe('connect.giving-summary.v1');
    expect(example.dataClassification).toBe('aggregate');
    expect(example.reconciliation.fundCount).toBe(example.funds.length);
    expect(sum('grossCents')).toBe(example.totals.grossCents);
    expect(sum('refundCents')).toBe(example.totals.refundCents);
    expect(sum('netCents')).toBe(example.totals.netCents);
    expect(example.totals.grossCents - example.totals.refundCents).toBe(example.totals.netCents);
  });

  it('validates the synthetic example against the published schema', () => {
    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
  });
});
