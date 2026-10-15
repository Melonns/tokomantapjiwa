// ponytail: Draf "menunggu kode" disimpan di localStorage; refresh atau koneksi terputus pada langkah kode tidak memaksa pengisian formulir dari awal.
export const PENDING_CODE_KEY = 'melonbyte-pending-code'
export const PENDING_CODE_TTL_MS = 60 * 60 * 1000
export const PENDING_CODE_RESEND_SECONDS = 60

export function writePendingCode(storage, value) {
  try {
    storage.setItem(PENDING_CODE_KEY, JSON.stringify({ email: value.email, purpose: value.purpose, sentAt: value.sentAt }))
  } catch { /* localStorage bisa diblokir; form tetap jalan di memori tab */ }
  return value
}

export function readPendingCode(storage, now) {
  try {
    const value = JSON.parse(storage.getItem(PENDING_CODE_KEY) || 'null')
    const email = typeof value?.email === 'string' ? value.email.trim() : ''
    const purpose = value?.purpose === 'signup' || value?.purpose === 'login' ? value.purpose : ''
    const sentAt = Number(value?.sentAt)
    if (!email || !purpose || !Number.isFinite(sentAt) || sentAt <= 0) return null
    const age = now - sentAt
    if (age < 0 || age >= PENDING_CODE_TTL_MS) return null
    return { email, purpose, sentAt, resendWait: Math.max(0, PENDING_CODE_RESEND_SECONDS - Math.floor(age / 1000)) }
  } catch { return null }
}

export function clearPendingCode(storage) {
  try { storage.removeItem(PENDING_CODE_KEY) } catch { /* localStorage bisa diblokir */ }
}
