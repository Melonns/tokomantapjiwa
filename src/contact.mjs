export function parseContact(input) {
  const value = input.trim()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { email: value }
  if (/^0[1-9]\d{7,12}$/.test(value)) return { phone: `+62${value.slice(1)}` }
  if (/^62[1-9]\d{7,12}$/.test(value)) return { phone: `+${value}` }
  if (/^\+[1-9]\d{7,14}$/.test(value) && !value.startsWith('+620')) return { phone: value }
  throw new Error('Masukkan alamat email yang valid atau nomor HP tanpa spasi (08..., 62..., atau +62...).')
}

export function parseRegistration(emailInput, phoneInput, usernameInput) {
  const { email } = parseContact(emailInput)
  if (!email) throw new Error('Masukkan alamat email yang valid.')
  const { phone } = parseContact(phoneInput)
  if (!phone) throw new Error('Masukkan nomor HP yang valid.')
  const username = usernameInput.trim()
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw new Error('Username harus 3–24 karakter: huruf, angka, atau garis bawah.')
  return { email, requested_phone: phone, username }
}

export function tryParseContact(input) {
  try { return parseContact(input) } catch { return {} }
}
