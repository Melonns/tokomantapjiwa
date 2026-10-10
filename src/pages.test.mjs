import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');

test('game and checkout are routed as separate pages', () => {
  assert.match(source, /#game\//);
  assert.match(source, /#beli\//);
  assert.match(source, /routeFromHash\(\)/);
  assert.match(source, /view === 'game' \?/);
  assert.match(source, /view === 'checkout' \?/);
});

test('choosing a game or voucher navigates to a page instead of stacking on home', () => {
  assert.match(source, /window\.location\.hash = `#game\/\$\{encodeURIComponent/);
  assert.match(source, /window\.location\.hash = `#beli\/\$\{encodeURIComponent/);
  assert.doesNotMatch(source, /setSelected\(/);
  assert.doesNotMatch(source, /category === 'Game' && game/);
});
