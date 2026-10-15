export function authErrorMessage(message) {
  const text = String(message || '')
  if (/invalid login credentials/i.test(text)) return 'Email atau password salah.'
  if (/email not confirmed/i.test(text)) return 'Email belum dikonfirmasi. Buka tautan konfirmasi di kotak masukmu, atau masuk lewat tombol "Masuk tanpa password".'
  if (/password should be at least|password is too short|at least 6 characters/i.test(text)) return 'Password minimal 6 karakter.'
  if (/user already registered/i.test(text)) return 'Email ini sudah terdaftar. Masuk saja, atau pakai "Masuk tanpa password".'
  if (/rate limit|too many requests|security purposes/i.test(text)) return 'Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi.'
  if (/token has expired or is invalid|invalid otp|expired or is invalid/i.test(text)) return 'Kode salah atau sudah kedaluwarsa. Tekan "Kirim ulang kode" buat minta kode baru.'
  return text || 'Gagal memproses. Coba lagi.'
}
