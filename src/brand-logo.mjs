// Logo merek disimpan sebagai SVG di public/logo supaya tetap tajam di ukuran layar apa pun.
// Sumber: Simple Icons, Arcticons, dan Wikimedia Commons. Merek tanpa berkas di sini memakai
// inisial bergradasi bawaan GameCover.
// Logo satu warna ditampilkan putih di atas kotak bergradasi warna merek; logo berwarna asli
// ditampilkan apa adanya di atas kotak terang.
const TERANG = '#f4f7ef'
const berwarna = (src) => ({ src, bg: TERANG, invert: false })
const putih = (src, bg) => ({ src, bg, invert: true })
const ikon = (src) => ({ src, bg: TERANG, invert: false, cover: true })

const LOGOS = {
  'mobile legends': ikon('/logo/game/mobile-legends.jpg'),
  'free fire': ikon('/logo/game/free-fire.jpg'),
  'genshin impact': ikon('/logo/game/genshin-impact.jpg'),
  'honkai star rail': ikon('/logo/game/honkai-star-rail.jpg'),
  valorant: berwarna('/logo/valorant.svg'),
  'go pay': berwarna('/logo/gopay.svg'),
  gopay: berwarna('/logo/gopay.svg'),
  'shopee pay': berwarna('/logo/shopeepay.svg'),
  shopeepay: berwarna('/logo/shopeepay.svg'),
  dana: berwarna('/logo/dana.svg'),
  ovo: berwarna('/logo/ovo.svg'),
  telkomsel: berwarna('/logo/telkomsel.svg'),
  indosat: berwarna('/logo/indosat.svg'),
  xl: berwarna('/logo/xl.svg'),
  axis: berwarna('/logo/axis.svg'),
  smartfren: berwarna('/logo/smartfren.svg'),
  'by.u': putih('/logo/byu.svg', 'linear-gradient(135deg,#22a8e0,#0b5c8a)'),
  byu: putih('/logo/byu.svg', 'linear-gradient(135deg,#22a8e0,#0b5c8a)'),
  pln: putih('/logo/pln.svg', 'linear-gradient(135deg,#d99a00,#8a5c00)'),
  'pertamina gas': berwarna('/logo/pertamina.svg'),
  pertamina: berwarna('/logo/pertamina.svg'),
}

export function brandLogo(name) {
  const kunci = String(name || '').trim().toLowerCase()
  if (!kunci) return null
  if (LOGOS[kunci]) return LOGOS[kunci]
  const cocok = Object.keys(LOGOS).find((k) => kunci.startsWith(k))
  return cocok ? LOGOS[cocok] : null
}

// Warna merek dipakai sebagai cahaya latar kartu poster, supaya kartu tidak tampak gelap mati
// saat logonya berlatarkan transparan.
const WARNA = {
  'mobile legends': '#2a3f8f',
  'free fire': '#ff6a00',
  'genshin impact': '#4b7bb5',
  'honkai star rail': '#5b3fa8',
  valorant: '#ff4655',
  'go pay': '#00aed6',
  gopay: '#00aed6',
  'shopee pay': '#ee4d2d',
  shopeepay: '#ee4d2d',
  dana: '#118eea',
  ovo: '#4c3494',
  telkomsel: '#ed0226',
  indosat: '#ffc800',
  xl: '#0067b1',
  axis: '#8a2be2',
  smartfren: '#e0007a',
  'by.u': '#22a8e0',
  byu: '#22a8e0',
  pln: '#f5a623',
  'pertamina gas': '#00a651',
  pertamina: '#00a651',
}

export function brandWarna(name) {
  const kunci = String(name || '').trim().toLowerCase()
  if (!kunci) return null
  if (WARNA[kunci]) return WARNA[kunci]
  const cocok = Object.keys(WARNA).find((k) => kunci.startsWith(k))
  return cocok ? WARNA[cocok] : null
}

// Campur warna merek dengan hitam kehijauan supaya jadi cahaya latar yang teduh.
// Dihitung di JavaScript, bukan CSS color-mix, agar tetap jalan di browser lama.
export function brandGelap(name, rasio = 0.68) {
  const hex = brandWarna(name)
  if (!hex) return null
  const dasar = [0x10, 0x1a, 0x0d]
  const warna = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const hasil = warna.map((nilai, i) => Math.round(nilai * rasio + dasar[i] * (1 - rasio)))
  return '#' + hasil.map((nilai) => nilai.toString(16).padStart(2, '0')).join('')
}
