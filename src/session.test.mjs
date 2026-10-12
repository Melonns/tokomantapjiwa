import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SESSION_TTL_MS, clearSessionStart, readSessionStart, seedSessionStart, sessionExpired, writeSessionStart } from './session.mjs';

const fakeStorage = () => ({ store: new Map(), getItem(key) { return this.store.has(key) ? this.store.get(key) : null; }, setItem(key, value) { this.store.set(key, String(value)); }, removeItem(key) { this.store.delete(key); } });

test('umur sesi tersimpan per perangkat dan kedaluwarsa tepat 24 jam', () => {
  const storage = fakeStorage();
  const now = Date.parse('2026-10-12T10:00:00Z');
  assert.equal(readSessionStart(storage), null);
  writeSessionStart(storage, now);
  assert.equal(readSessionStart(storage), now);
  assert.equal(sessionExpired(readSessionStart(storage), now + SESSION_TTL_MS - 1), false);
  assert.equal(sessionExpired(readSessionStart(storage), now + SESSION_TTL_MS), true);
  clearSessionStart(storage);
  assert.equal(readSessionStart(storage), null);
});

test('waktu mulai memakai last_sign_in_at bila catatan lokal belum ada', () => {
  const signedIn = Date.parse('2026-10-12T01:00:00Z');
  const now = signedIn + 60000;
  assert.equal(seedSessionStart(fakeStorage(), { last_sign_in_at: new Date(signedIn).toISOString() }, now), signedIn);
  assert.equal(seedSessionStart(fakeStorage(), { last_sign_in_at: 'bukan tanggal' }, now), now);
  assert.equal(seedSessionStart(fakeStorage(), { last_sign_in_at: new Date(now + 60000).toISOString() }, now), now);
});

test('App.jsx memotong sesi 24 jam: cek saat restore, timer berkala, dan logout scope local', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  assert.match(source, /sessionExpired\(startedAt, Date\.now\(\)\)/);
  assert.match(source, /setInterval\(verifySessionAge, 60000\)/);
  assert.match(source, /async function cutSession\(\)/);
  assert.match(source, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(source, /clearSessionStart\(window\.localStorage\)/);
  assert.match(source, /writeSessionStart\(window\.localStorage, Date\.now\(\)\)/);
});
