// ponytail: Sesi akun dipotong maksimal 24 jam sejak login; waktu mulai disimpan per perangkat di localStorage.
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000
export const SESSION_START_KEY = 'melonbyte-session-start'

export function readSessionStart(storage) {
  try {
    const value = Number(storage.getItem(SESSION_START_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

export function writeSessionStart(storage, startedAt) {
  try { storage.setItem(SESSION_START_KEY, String(startedAt)) } catch { /* localStorage bisa diblokir; hitungan tetap jalan di memori tab */ }
  return startedAt
}

export function seedSessionStart(storage, user, now) {
  const existing = readSessionStart(storage)
  if (existing) return existing
  const signedIn = Date.parse(user?.last_sign_in_at || '')
  const startedAt = Number.isFinite(signedIn) && signedIn > 0 && signedIn <= now ? signedIn : now
  return writeSessionStart(storage, startedAt)
}

export function clearSessionStart(storage) {
  try { storage.removeItem(SESSION_START_KEY) } catch { /* localStorage bisa diblokir */ }
}

export function sessionExpired(startedAt, now) {
  return Number.isFinite(startedAt) && startedAt > 0 && now - startedAt >= SESSION_TTL_MS
}
