import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const schema = read('../contracts/person-reference-v1.schema.json');
const active = read('../contracts/examples/person-reference-v1.synthetic.json');
const merged = read('../contracts/examples/person-reference-merged-v1.synthetic.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function changed(source, mutator) {
  const value = structuredClone(source);
  mutator(value);
  return value;
}

function collectPropertyNames(value, names = []) {
  if (!value || typeof value !== 'object') return names;
  if (value.properties) names.push(...Object.keys(value.properties));
  Object.values(value).forEach((child) => collectPropertyNames(child, names));
  return names;
}

describe('Connect person reference contract v1', () => {
  it('is closed, pseudonymous, audience-bound, and never authorization', () => {
    expect(schema.$id).toBe('urn:timothy:connect:person-reference:v1');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.contract.const).toBe('connect.person-reference.v1');
    expect(schema.properties.dataClassification.const).toBe('restricted-pseudonymous');
    expect(schema.properties.sourceProduct.const).toBe('connect');
    expect(schema.properties.consumerProduct.enum).toEqual(['website', 'finance', 'mymdo']);
    expect(schema.properties.authorizationGranted.const).toBe(false);
  });

  it.each([['active', active], ['merged', merged]])('validates the synthetic %s reference', (_name, value) => {
    expect(value.personRef).toContain('SYNTHETIC');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });

  it('contains no direct identity, demographic, membership, or Giving fields', () => {
    const names = collectPropertyNames(schema).join(' ');
    expect(names).not.toMatch(/person_id|personId|name|email|phone|address|birth|dob|gender|household|member|giving|gift|donor|role|permission/i);
  });

  it.each([
    ['unknown major version', changed(active, (v) => { v.contract = 'connect.person-reference.v2'; })],
    ['raw Connect person id', changed(active, (v) => { v.person_id = 42; })],
    ['name', changed(active, (v) => { v.name = 'Not allowed'; })],
    ['unapproved consumer', changed(active, (v) => { v.consumerProduct = 'delivery-adapter'; })],
    ['short guessable reference', changed(active, (v) => { v.personRef = 'pr_42'; })],
    ['authorization claim', changed(active, (v) => { v.authorizationGranted = true; })],
    ['replacement on active reference', changed(active, (v) => { v.replacementPersonRef = merged.replacementPersonRef; })],
    ['merged without replacement', changed(merged, (v) => { delete v.replacementPersonRef; })],
  ])('fails closed on %s', (_label, value) => {
    expect(validate(value)).toBe(false);
  });

  it('binds equivalent people separately for each consumer audience', () => {
    const finance = structuredClone(active);
    const mymdo = changed(active, (v) => {
      v.consumerProduct = 'mymdo';
      v.personRef = 'pr_SYNTHETIC_MYMDO_AUDIENCE_00000000001';
    });
    expect(validate(finance)).toBe(true);
    expect(validate(mymdo)).toBe(true);
    expect(finance.personRef).not.toBe(mymdo.personRef);
  });
});
