import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptDelay } from './refresh.mjs';

test('jeda penyegaran struk melambat bertingkat', () => {
  assert.equal(receiptDelay(0), 3000);
  assert.equal(receiptDelay(1), 5000);
  assert.equal(receiptDelay(2), 8000);
  assert.equal(receiptDelay(3), 8000);
  assert.equal(receiptDelay(99), 8000);
});

test('jeda penyegaran struk tahan masukan tidak wajar', () => {
  assert.equal(receiptDelay(-1), 3000);
  assert.equal(receiptDelay(undefined), 3000);
  assert.equal(receiptDelay(NaN), 3000);
  assert.equal(receiptDelay(1.7), 5000);
});
