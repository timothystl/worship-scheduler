import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const schema = read('../contracts/message-delivery-v1.schema.json');
const resultSchema = read('../contracts/message-delivery-result-v1.schema.json');
const examples = {
  email: read('../contracts/examples/message-delivery-email-v1.synthetic.json'),
  sms: read('../contracts/examples/message-delivery-sms-v1.synthetic.json'),
  push: read('../contracts/examples/message-delivery-push-v1.synthetic.json'),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const validateResult = ajv.compile(resultSchema);
const resultExamples = {
  accepted: read('../contracts/examples/message-delivery-result-v1.synthetic.json'),
  temporaryFailure: read('../contracts/examples/message-delivery-failure-v1.synthetic.json'),
};

function changed(channel, mutator) {
  const value = structuredClone(examples[channel]);
  mutator(value);
  return value;
}

function propertyNames(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (value.properties) result.push(...Object.keys(value.properties));
  Object.values(value).forEach((child) => propertyNames(child, result));
  return result;
}

describe('Connect message delivery contract v1', () => {
  it('is a closed, classified, versioned adapter boundary', () => {
    expect(schema.$id).toBe('urn:timothy:connect:message-delivery:v1');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.contract.const).toBe('connect.message-delivery.v1');
    expect(schema.properties.dataClassification.const).toBe('restricted-contact');
    expect(schema.properties.sourceProduct.const).toBe('connect');
    expect(schema.properties.consumerProduct.const).toBe('delivery-adapter');
    expect(Object.values(schema.$defs).every((definition) => definition.additionalProperties === false)).toBe(true);
  });

  it.each(Object.entries(examples))('validates the synthetic %s example', (channel, value) => {
    expect(value.delivery.channel).toBe(channel);
    expect(value.messageId).toContain('SYNTHETIC');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
  });

  it('does not contain provider credentials or unrelated sensitive-domain fields', () => {
    const names = propertyNames(schema).join(' ');
    expect(names).not.toMatch(/apiKey|secret|token|providerMessageId|donor|giving|gift|payroll|wage|child|family|payment|bank|card/i);
  });

  it.each([
    ['unknown version', changed('email', (v) => { v.contract = 'connect.message-delivery.v2'; })],
    ['unknown root field', changed('email', (v) => { v.providerApiKey = 'not-allowed'; })],
    ['email field on SMS', changed('sms', (v) => { v.delivery.subject = 'not-allowed'; })],
    ['external push URL', changed('push', (v) => { v.delivery.url = 'https://example.invalid'; })],
    ['unclassified payload', changed('email', (v) => { v.dataClassification = 'public'; })],
    ['missing authorization', changed('email', (v) => { delete v.authorization; })],
    ['unsupported authorization basis', changed('email', (v) => { v.authorization.basis = 'assumed'; })],
  ])('fails closed on %s', (_label, value) => {
    expect(validate(value)).toBe(false);
  });

  it('makes channel payloads mutually exclusive', () => {
    const email = changed('email', (v) => { v.delivery.channel = 'sms'; });
    expect(validate(email)).toBe(false);
    const sms = changed('sms', (v) => { v.delivery.channel = 'push'; });
    expect(validate(sms)).toBe(false);
  });

  it.each(Object.entries(resultExamples))('validates the bounded %s adapter result', (_name, value) => {
    expect(validateResult(value), JSON.stringify(validateResult.errors)).toBe(true);
  });

  it('requires retry timing for a temporary failure', () => {
    const value = structuredClone(resultExamples.temporaryFailure);
    delete value.retryAfter;
    expect(validateResult(value)).toBe(false);
  });

  it('dead-letters permanent failures and never returns raw provider data', () => {
    const value = structuredClone(resultExamples.temporaryFailure);
    value.outcome = 'permanent-failure';
    value.retryDisposition = 'dead-letter';
    delete value.retryAfter;
    expect(validateResult(value), JSON.stringify(validateResult.errors)).toBe(true);
    value.providerResponse = { raw: 'not allowed' };
    expect(validateResult(value)).toBe(false);
  });
});
