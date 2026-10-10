export function isPublicSupabaseKey(key) {
  if (typeof key !== 'string') return false
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  try {
    const parts = key.split('.')
    return parts.length === 3 && JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'
  } catch {
    return false
  }
}
