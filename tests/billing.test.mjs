import assert from 'node:assert/strict';
import test from 'node:test';
import { wasPushedRecordSaved } from '../dist/billing.js';

test('a charged dataset row was saved', () => {
  assert.equal(wasPushedRecordSaved({ chargedCount: 1, eventChargeLimitReached: false }), true);
});

test('a free-user dataset row was saved when no limit was reached', () => {
  assert.equal(wasPushedRecordSaved({ chargedCount: 0, eventChargeLimitReached: false }), true);
});

test('a zero-charge row at the spending limit was not saved', () => {
  assert.equal(wasPushedRecordSaved({ chargedCount: 0, eventChargeLimitReached: true }), false);
});
