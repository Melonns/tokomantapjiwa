import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('./index.css', import.meta.url), 'utf8');
const main = await readFile(new URL('./main.jsx', import.meta.url), 'utf8');

test('font katalog dipasang lokal agar tampil sama di desktop dan HP', () => {
  assert.match(css, /font-family: 'Fira Sans'/);
  assert.match(css, /@media \(max-width: 620px\) \{ :root \{ font-weight: 500; \} \}/);
  for (const weight of [400, 500, 600, 700, 800, 900]) {
    assert.match(main, new RegExp(`@fontsource/fira-sans/latin-${weight}\\.css`));
  }
});
