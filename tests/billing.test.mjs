import assert from 'node:assert/strict';
import test from 'node:test';
import { productBillingPreflightIssue, wasPushedRecordSaved } from '../dist/billing.js';

test('a charged dataset row was saved', () => {
  assert.equal(wasPushedRecordSaved({ chargedCount: 1, eventChargeLimitReached: false }), true);
});

test('a free-user dataset row was saved when no limit was reached', () => {
  assert.equal(wasPushedRecordSaved({ chargedCount: 0, eventChargeLimitReached: false }), true);
});

test('a zero-charge row at the spending limit was not saved', () => {
  assert.equal(wasPushedRecordSaved({ chargedCount: 0, eventChargeLimitReached: true }), false);
});

test('PPE billing requires a positive product event price', () => {
  assert.match(productBillingPreflightIssue({
    isPayPerEvent: true,
    eventPriceUsd: 0,
    chargeableProductCount: 1,
  }), /missing|positive price/i);
});

test('PPE billing stops before scraping when no product fits the run limit', () => {
  assert.match(productBillingPreflightIssue({
    isPayPerEvent: true,
    eventPriceUsd: 0.002,
    chargeableProductCount: 0,
  }), /maximum cost per run/i);
});

test('PPE billing accepts a chargeable product and local non-PPE runs', () => {
  assert.equal(productBillingPreflightIssue({
    isPayPerEvent: true,
    eventPriceUsd: 0.002,
    chargeableProductCount: 1,
  }), null);
  assert.equal(productBillingPreflightIssue({
    isPayPerEvent: false,
    chargeableProductCount: 0,
  }), null);
});
