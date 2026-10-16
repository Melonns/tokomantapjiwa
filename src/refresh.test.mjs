import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptDelay } from './refresh.mjs';

test('jeda penyegaran struk melambat bertingkat', () => {
  assert.equal(receiptDelay(0), 8000);
  assert.equal(receiptDelay(1), 15000);
  assert.equal(receiptDelay(2), 30000);
  assert.equal(receiptDelay(3), 30000);
  assert.equal(receiptDelay(99), 30000);
});

test('jeda penyegaran struk tahan masukan tidak wajar', () => {
  assert.equal(receiptDelay(-1), 8000);
  assert.equal(receiptDelay(undefined), 8000);
  assert.equal(receiptDelay(NaN), 8000);
  assert.equal(receiptDelay(1.7), 15000);
});
