import { Fragment, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { parseContact, parseRegistration, tryParseContact } from './contact.mjs'
import { matchesCatalog } from './catalog.mjs'
import { brandGelap, brandLogo, brandWarna } from './brand-logo.mjs'
import { groupByKind, namaSingkat } from './katalog.mjs'
import { authReturnFromUrl, restoreSession } from './auth.mjs'
import { clearSessionStart, readSessionStart, seedSessionStart, sessionExpired, writeSessionStart } from './session.mjs'
import { authErrorMessage } from './auth-errors.mjs'
import { clearPendingCode, readPendingCode, writePendingCode } from './pending-code.mjs'
import { isPublicSupabaseKey } from './public-key.mjs'
import { availablePaymentMethods, marginBand, priceHealth, suggestPrice, VA_MIN_ORDER } from './pricing.mjs'
import { buildCatalogCsv, parseCatalogCsv } from './catalog-csv.mjs'
import { LEGAL_LINKS, LEGAL_PAGES, contactChannels } from './legal.mjs'
import { OUTAGE_NOTE, allOutage, isOutage } from './outage.mjs'
import { labelTanggalJam, tanggalWib } from './waktu.mjs'
import { receiptDelay } from './refresh.mjs'
import './store.css'

const authConfigError = import.meta.env.VITE_SUPABASE_AUTH_ERROR || (import.meta.env.VITE_SUPABASE_ANON_KEY && !isPublicSupabaseKey(import.meta.env.VITE_SUPABASE_ANON_KEY))
const supabase = !authConfigError && import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: false } })
  : null
const authReturn = supabase ? authReturnFromUrl(window.location.href) : null
const restoredSession = supabase ? restoreSession(supabase.auth, window.location, window.history)
  .then((session) => ({ session, error: null }), (error) => ({ session: null, error })) : Promise.resolve({ session: null, error: null })
if (import.meta.hot) import.meta.hot.dispose(() => supabase?.auth.stopAutoRefresh())
const rupiah = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
const STATUS_LABELS = { pending: 'Menunggu pembayaran', payment_paid: 'Pembayaran diterima', fulfillment_pending: 'Sedang diproses', fulfilled: 'Selesai', fulfillment_failed: 'Gagal diproses', manual_review: 'Sedang diperiksa admin', payment_failed: 'Pembayaran gagal', refunded: 'Dana dikembalikan' }
const STATUS_HINTS = {
  pending: 'Selesaikan pembayaran sebelum waktu habis.',
  payment_paid: 'Pesanan diproses otomatis.',
  fulfillment_pending: 'Periksa kembali beberapa saat nanti.',
  fulfilled: 'Terima kasih atas pembelian Anda.',
  fulfillment_failed: 'Admin akan memeriksa dan memproses ulang pesanan.',
  refunded: 'Dana dikembalikan ke metode pembayaran awal. Konfirmasi dikirim melalui email.',
  manual_review: 'Admin sedang memeriksa pesanan.',
  payment_failed: 'Pembayaran gagal atau kedaluwarsa. Buat pesanan baru untuk mencoba kembali.',
}
const ACTIVE_STATUSES = ['pending', 'payment_paid', 'fulfillment_pending']
const statusLabel = (status) => STATUS_LABELS[status] || status
const statusHint = (status) => STATUS_HINTS[status] || ''

// ponytail: Kanal bayar Core API Midtrans; id wajib sama dengan PAYMENT_METHODS di server/app.mjs.
// Halaman invoice ini sendiri yang menampilkan QR/VA, tanpa pengalihan ke situs Midtrans.
const PAYMENT_METHODS = [
  { id: 'qris', group: 'QRIS', label: 'QRIS', note: 'Pindai dari aplikasi bank atau e-wallet mana pun' },
  { id: 'bca_va', group: 'Transfer bank / Virtual Account', label: 'BCA Virtual Account', note: 'Nomor VA BCA', minOrder: VA_MIN_ORDER },
  { id: 'bni_va', group: 'Transfer bank / Virtual Account', label: 'BNI Virtual Account', note: 'Nomor VA BNI', minOrder: VA_MIN_ORDER },
  { id: 'bri_va', group: 'Transfer bank / Virtual Account', label: 'BRI Virtual Account', note: 'Nomor VA BRI', minOrder: VA_MIN_ORDER },
  { id: 'permata_va', group: 'Transfer bank / Virtual Account', label: 'Permata Virtual Account', note: 'Nomor VA Permata', minOrder: VA_MIN_ORDER },
  { id: 'mandiri_bill', group: 'Transfer bank / Virtual Account', label: 'Mandiri Bill Payment', note: 'Kode bayar Mandiri', minOrder: VA_MIN_ORDER },
  { id: 'gopay', group: 'E-wallet', label: 'GoPay', note: 'Bayar melalui aplikasi Gojek' },
  { id: 'shopeepay', group: 'E-wallet', label: 'ShopeePay', note: 'Bayar melalui aplikasi Shopee' },
]
// ponytail: nama bank untuk label nomor VA di halaman invoice.
const VA_BANKS = { bca: 'BCA', bni: 'BNI', bri: 'BRI', permata: 'Permata' }

// ponytail: Token server Hoyo mengikuti petunjuk seller "[UID]|[Server]" di deskripsi SKU.
const uidServerOptions = [
  { value: 'os_asia', label: 'Asia' },
  { value: 'os_usa', label: 'Amerika' },
  { value: 'os_euro', label: 'Eropa' },
  { value: 'os_cht', label: 'TW, HK, MO' },
]

// ponytail: Tipe katalog storefront. Kategori mengikuti kolom category dari data supplier (mirror);
// Tab dan salinan teks didefinisikan di sini agar mudah diubah saat kategori baru ditambahkan.
const CATALOG_TYPES = [
  { id: 'game', label: 'Game', categories: ['Games'], targetTitle: 'Data akun tujuan', targetLabel: 'User ID', targetHint: 'User ID berupa angka. Jangan memasukkan kata sandi game.', targetPlaceholder: 'ID akun game' },
  { id: 'pulsa', label: 'Pulsa & Data', categories: ['Pulsa', 'Data', 'Masa Aktif', 'Paket SMS & Telpon', 'Aktivasi Voucher', 'Aktivasi Perdana'], targetTitle: 'Nomor tujuan', targetLabel: 'Nomor HP', targetHint: 'Nomor HP tujuan yang aktif. Jangan masukkan PIN atau kode OTP.', targetPlaceholder: '08xxxxxxxxxx' },
  { id: 'ewallet', label: 'E-Money', categories: ['E-Money'], targetTitle: 'Nomor akun tujuan', targetLabel: 'Nomor HP', targetHint: 'Nomor HP yang terdaftar pada akun e-money tujuan.', targetPlaceholder: '08xxxxxxxxxx' },
  { id: 'hiburan', label: 'Hiburan', categories: ['TV'], targetTitle: 'Nomor pelanggan', targetLabel: 'Nomor pelanggan', targetHint: 'Nomor pelanggan atau smart card layanan TV berlangganan.', targetPlaceholder: 'Nomor smart card' },
  { id: 'tagihan', label: 'Tagihan', categories: ['PLN'], targetTitle: 'Nomor pelanggan', targetLabel: 'Nomor meter / ID pelanggan', targetHint: 'Nomor meter atau ID pelanggan dari tagihan.', targetPlaceholder: 'Nomor meter' },
]
const OTHER_CATALOG_TYPE = { id: 'lainnya', label: 'Lainnya', categories: [], targetTitle: 'ID tujuan', targetLabel: 'ID tujuan', targetHint: 'Isi ID atau nomor tujuan sesuai layanan.', targetPlaceholder: 'ID tujuan' }
// Blueprint untuk kategori baru: cukup muncul di katalog, tanpa menambah tab satu per satu.
const GENERIC_CATALOG_BLUEPRINT = { targetTitle: 'Tujuan pesanan', targetLabel: 'Nomor / ID tujuan', targetHint: 'Isi nomor atau ID tujuan sesuai layanan. Jangan masukkan kata sandi.', targetPlaceholder: 'Nomor / ID tujuan' }
const genericCatalogType = (category) => ({ id: `kategori:${category}`, label: category, categories: [category], ...GENERIC_CATALOG_BLUEPRINT })
const catalogTypesFor = (products = []) => {
  const known = new Set(CATALOG_TYPES.flatMap((type) => type.categories))
  const extras = [...new Set(products.map((item) => String(item.category || '').trim()).filter((category) => category && !known.has(category)))]
    .sort((a, b) => a.localeCompare(b, 'id')).map(genericCatalogType)
  const types = [...CATALOG_TYPES, ...extras]
  if (products.some((item) => !String(item.category || '').trim())) types.push(OTHER_CATALOG_TYPE)
  return types
}
const catalogTypeOf = (item, types = CATALOG_TYPES) => {
  const category = String(item && item.category || '').trim()
  if (!category) return OTHER_CATALOG_TYPE
  return types.find((type) => type.categories.includes(category)) || genericCatalogType(category)
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Server tidak dapat dihubungi. Coba lagi nanti.')
  return payload
}

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Sesi login berakhir. Masuk kembali untuk melanjutkan.')
  return { Authorization: `Bearer ${data.session.access_token}` }
}

function currentPath() {
  return window.location.pathname.replace(/\/+$/, '') || '/'
}

function migrateLegacyHash() {
  const hash = window.location.hash
  if (!hash || hash === '#' || hash === '#main') return
  if (!/^#(katalog|daftar|akun|syarat|privasi|kontak|admin(?:$|\/)|game\/|beli\/|struk\/)/.test(hash)) return
  window.history.replaceState(null, '', hash === '#katalog' ? '/katalog' : `/${hash.slice(1)}`)
}

if (typeof window !== 'undefined') migrateLegacyHash()

function routeFromPath() {
  const path = currentPath()
  if (path === '/daftar') return { view: 'register', game: null, checkoutId: '' }
  if (path === '/akun') return { view: 'account', game: null, checkoutId: '' }
  if (path === '/admin/voucher') return { view: 'admin', adminPage: 'vouchers', game: null, checkoutId: '' }
  if (path === '/admin/ringkasan') return { view: 'admin', adminPage: 'summary', game: null, checkoutId: '' }
  if (path === '/syarat') return { view: 'terms', game: null, checkoutId: '' }
  if (path === '/privasi') return { view: 'privacy', game: null, checkoutId: '' }
  if (path === '/kontak') return { view: 'contact', game: null, checkoutId: '' }
  if (path === '/admin/refund') return { view: 'admin', adminPage: 'refunds', game: null, checkoutId: '' }
  if (path === '/admin' || path === '/admin/produk') return { view: 'admin', adminPage: path === '/admin/produk' ? 'products' : 'transactions', game: null, checkoutId: '' }
  if (path.startsWith('/game/')) return { view: 'game', game: decodeHash(path.slice(6)), checkoutId: '' }
  if (path.startsWith('/beli/')) return { view: 'checkout', game: null, checkoutId: decodeHash(path.slice(6)) }
  if (path.startsWith('/struk/')) return { view: 'receipt', game: null, checkoutId: '', orderId: decodeHash(path.slice(7)) }
  if (path === '/' || path === '/katalog') return { view: 'home', game: null, checkoutId: '' }
  return { view: 'notfound', game: null, checkoutId: '' }
}

function go(path) {
  if (path === window.location.pathname + window.location.search + window.location.hash) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new Event('melon:navigate'))
}

const PAGE_META = {
  '/': ['Melonbyte | Top up Game, Pulsa, E-Money, dan Tagihan', 'Top up game, pulsa, e-money, dan tagihan dengan harga final. Pembayaran QRIS atau Virtual Account, status pesanan diperbarui otomatis.'],
  '/katalog': ['Katalog layanan | Melonbyte', 'Daftar game, pulsa, e-money, dan tagihan yang tersedia di Melonbyte.'],
  '/akun': ['Akun | Melonbyte', 'Kelola profil, riwayat pesanan, dan keamanan akun Melonbyte.'],
  '/daftar': ['Daftar | Melonbyte', 'Buat akun Melonbyte untuk memesan top up game, pulsa, e-money, dan tagihan.'],
  '/syarat': ['Syarat dan ketentuan | Melonbyte', 'Syarat dan ketentuan layanan Melonbyte.'],
  '/privasi': ['Kebijakan privasi | Melonbyte', 'Kebijakan privasi dan pengelolaan data pengguna Melonbyte.'],
  '/kontak': ['Kontak | Melonbyte', 'Hubungi dukungan Melonbyte.'],
}
const PRIVATE_VIEWS = new Set(['admin', 'account', 'register', 'receipt', 'checkout'])

function applyPageMeta(route, path) {
  const meta = PAGE_META[path] || (route.view === 'game' ? [`Top up ${route.game} | Melonbyte`, `Beli ${route.game} di Melonbyte. Harga final, proses otomatis.`] : null)
  if (meta) {
    document.title = meta[0]
    const description = document.querySelector('meta[name="description"]')
    if (description) description.setAttribute('content', meta[1])
    const canonical = document.querySelector('link[rel="canonical"]')
    if (canonical) canonical.setAttribute('href', window.location.origin + (path === '/katalog' ? '/' : path))
  }
  let robots = document.querySelector('meta[name="robots"]')
  if (!robots) {
    robots = document.createElement('meta')
    robots.setAttribute('name', 'robots')
    document.head.appendChild(robots)
  }
  robots.setAttribute('content', PRIVATE_VIEWS.has(route.view) ? 'noindex' : 'index, follow')
}

function decodeHash(value) {
  try { return decodeURIComponent(value) } catch { return value }
}
const COVER_PALETTES = [['#b8ef72', '#5c9a3c'], ['#7cd3e0', '#2f7d92'], ['#f0c267', '#a9742a'], ['#b9a0ee', '#5f48a8'], ['#ef9a94', '#a44a4a'], ['#93b6f0', '#43639f']]
const COVER_OVERRIDES = { 'mobile legends': 5 }

function coverSeed(name) {
  let h = 2166136261
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function GameCover({ name }) {
  const logo = brandLogo(name)
  if (logo) {
    return (
      <span className={`game-cover game-cover-logo${logo.cover ? ' game-cover-foto' : ''}`} style={{ background: logo.bg }} aria-hidden="true">
        <img src={logo.src} alt="" width="44" height="44" loading="lazy" decoding="async" style={logo.cover ? { objectFit: 'cover' } : logo.invert ? { filter: 'brightness(0) invert(1)' } : undefined} />
      </span>
    )
  }
  const seed = coverSeed(name)
  const [from, to] = COVER_PALETTES[COVER_OVERRIDES[name.toLowerCase()] ?? seed % COVER_PALETTES.length]
  const gid = `cov-${seed.toString(36)}`
  return (
    <span className="game-cover" aria-hidden="true">
      <svg viewBox="0 0 64 64" focusable="false">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <rect width="64" height="64" fill={`url(#${gid})`} />
        <ellipse cx="54" cy="6" rx="28" ry="10" fill="#ffffff" opacity=".18" transform={`rotate(${(seed % 5) * 26 - 52} 54 6)`} />
        <circle cx="10" cy="56" r="10" fill="#0b110e" opacity=".16" />
        <text x="32" y="41.5" textAnchor="middle" fontSize="21" fontWeight="900" fill="#0f1a10">{name.slice(0, 2).toUpperCase()}</text>
      </svg>
    </span>
  )
}

// ponytail: halaman legal memakai satu komponen; isinya dari src/legal.mjs, sehingga teks dapat diperbarui tanpa menyentuh JSX.
function LegalPage({ view, info, state }) {
  const page = LEGAL_PAGES[view]
  if (!page) return null
  const channels = contactChannels(info)
  return (
    <section className="legal-page wrap" aria-labelledby="legal-title">
      <div className="legal-head">
        <p className="eyebrow"><span className="eyebrow-line" /> MELONBYTE / INFORMASI</p>
        <h1 id="legal-title">{page.title}</h1>
        <p>{page.intro}</p>
        {page.updated && <small className="legal-updated">Terakhir diperbarui {page.updated}</small>}
      </div>
      <div className="legal-body">
        {page.sections.map((section) => (
          <section key={section.title} className={section.danger ? 'legal-block legal-danger' : 'legal-block'}>
            <h2>{section.title}</h2>
            {section.body ? <p>{section.body}</p> : null}
            {section.items ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : null}
          </section>
        ))}
        {view === 'contact' && <section className="legal-block" aria-labelledby="contact-title">
          <h2 id="contact-title">Hubungi kami</h2>
          {state !== 'ready' ? <p role="status">Memuat kontak...</p> : channels.length === 0 ? <p role="status">Kontak belum diatur di server ini.</p> : <ul className="contact-list">{channels.map((channel) => <li key={channel.id}><strong>{channel.label}</strong><a href={channel.href}>{channel.value}</a></li>)}</ul>}
          <p className="field-hint">Sebutkan nomor pesanan (format #xxxxxxxx) agar penanganan lebih cepat. Kami tidak pernah meminta kata sandi, OTP, atau data kartu.</p>
        </section>}
      </div>
      <p className="legal-back"><a className="secondary-button" href="/katalog">Kembali ke katalog</a><a className="secondary-button" href="/akun">Buka akun</a></p>
    </section>
  )
}

function IkonGembok() {
  return <svg className="field-lock" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" fill="currentColor" /></svg>
}

function IkonCentang() {
  return <svg className="pilih-server-centang" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

// ponytail: daftar server memakai tombol sendiri, bukan select bawaan, supaya bentuknya sama dengan kolom lain
// dan tetap bisa dioperasikan dengan panah, Enter, Escape, Home, dan End.
function PilihanServer({ nilai, onPilih }) {
  const [buka, setBuka] = useState(false)
  const [sorot, setSorot] = useState(0)
  const bukaRef = useRef(false)
  const sorotRef = useRef(0)
  const kotakRef = useRef(null)
  const tombolRef = useRef(null)
  const daftarRef = useRef(null)
  const terpilih = uidServerOptions.find((option) => option.value === nilai)

  function ubahBuka(nilai) {
    bukaRef.current = nilai
    setBuka(nilai)
  }

  function ubahSorot(posisi) {
    sorotRef.current = posisi
    setSorot(posisi)
  }

  useEffect(() => {
    if (!buka) return undefined
    function tutup(event) {
      if (kotakRef.current && !kotakRef.current.contains(event.target)) ubahBuka(false)
    }
    document.addEventListener('pointerdown', tutup)
    return () => document.removeEventListener('pointerdown', tutup)
  }, [buka])

  useEffect(() => {
    if (!buka) return
    const aktif = daftarRef.current && daftarRef.current.querySelector('[data-sorot="true"]')
    if (aktif) aktif.scrollIntoView({ block: 'nearest' })
  }, [buka, sorot])

  function bukaDaftar() {
    const posisi = uidServerOptions.findIndex((option) => option.value === nilai)
    ubahSorot(posisi < 0 ? 0 : posisi)
    ubahBuka(true)
  }

  function pilih(option) {
    onPilih(option.value)
    ubahBuka(false)
    if (tombolRef.current) tombolRef.current.focus()
  }

  function tekan(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!bukaRef.current) { bukaDaftar(); return }
      const arah = event.key === 'ArrowDown' ? 1 : -1
      ubahSorot((sorotRef.current + arah + uidServerOptions.length) % uidServerOptions.length)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!bukaRef.current) return
      event.preventDefault()
      ubahSorot(event.key === 'Home' ? 0 : uidServerOptions.length - 1)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!bukaRef.current) { bukaDaftar(); return }
      pilih(uidServerOptions[sorotRef.current])
      return
    }
    if (event.key === 'Escape' && bukaRef.current) {
      event.preventDefault()
      ubahBuka(false)
      return
    }
    if (event.key === 'Tab') ubahBuka(false)
  }

  return (
    <div className="pilih-server" ref={kotakRef}>
      <button type="button" id="pilih-server" ref={tombolRef} className={`pilih-server-tombol${buka ? ' buka' : ''}${terpilih ? '' : ' kosong'}`} aria-haspopup="listbox" aria-expanded={buka} aria-controls="pilih-server-daftar" onClick={() => (buka ? ubahBuka(false) : bukaDaftar())} onKeyDown={tekan}>
        <span>{terpilih ? terpilih.label : 'Pilih server'}</span>
        <svg className="pilih-server-panah" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {buka && <ul className="pilih-server-daftar" id="pilih-server-daftar" role="listbox" aria-labelledby="pilih-server" ref={daftarRef}>
        {uidServerOptions.map((option, index) => (
          <li key={option.value} role="option" aria-selected={option.value === nilai} data-sorot={index === sorot} className={`pilih-server-opsi${option.value === nilai ? ' aktif' : ''}`} onMouseEnter={() => ubahSorot(index)} onClick={() => pilih(option)}>
            <span>{option.label}</span>
            {option.value === nilai ? <IkonCentang /> : null}
          </li>
        ))}
      </ul>}
    </div>
  )
}


function App() {
  const [products, setProducts] = useState([])
  const [hargaView, setHargaView] = useState('admin')
  const [checkoutAvailable, setCheckoutAvailable] = useState(false)
  const [checkAvailable, setCheckAvailable] = useState(false)
  const [checkState, setCheckState] = useState('idle')
  const [checkResult, setCheckResult] = useState(null)
  const [checkError, setCheckError] = useState('')
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogError, setCatalogError] = useState('')
  const [game, setGame] = useState(() => routeFromPath().game)
  const [category, setCategory] = useState('game')
  const [view, setView] = useState(() => routeFromPath().view)
  const [adminPage, setAdminPage] = useState(() => routeFromPath().adminPage || 'transactions')
  const [voucher, setVoucher] = useState(null)
  const [voucherBusy, setVoucherBusy] = useState(false)
  const [voucherNotice, setVoucherNotice] = useState('')
  const [adminVouchers, setAdminVouchers] = useState([])
  const [voucherDraft, setVoucherDraft] = useState({ code: '', value: '1000', minOrder: '10000', quota: '50', perUser: '1', newBuyersOnly: false, days: '30' })
  const [voucherAdminNotice, setVoucherAdminNotice] = useState('')
  const [checkoutId, setCheckoutId] = useState(() => routeFromPath().checkoutId)

  const [catalogSearch, setCatalogSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBoxRef = useRef(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [userId, setUserId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [checkoutState, setCheckoutState] = useState('idle')
  const [checkoutError, setCheckoutError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].id)
  // ponytail: kanal flat (VA/Mandiri) disembunyikan di pesanan kecil supaya fee-nya tidak memakan margin.
  function activePaymentMethod(price) {
    const list = availablePaymentMethods(PAYMENT_METHODS, price)
    return list.some((method) => method.id === paymentMethod) ? paymentMethod : list[0].id
  }
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [termsOk, setTermsOk] = useState(true)
  const [copied, setCopied] = useState('')
  const [clock, setClock] = useState(() => Date.now())
  const [promoCode, setPromoCode] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [session, setSession] = useState(null)
  // ponytail: kontak pesanan terisi dari profil saat pertama kali dibuka, lalu bebas diubah pembeli.
  useEffect(() => {
    if (!session?.user) return
    const profilEmail = session.user.email || ''
    const profilPhone = session.user.phone || session.user.user_metadata?.requested_phone || ''
    setContactEmail((current) => current || profilEmail)
    setContactPhone((current) => current || profilPhone)
  }, [session])
  const [contact, setContact] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPhone, setRegisterPhone] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerUsername, setRegisterUsername] = useState('')
  const [profileState, setProfileState] = useState('idle')
  const [phoneMessage, setPhoneMessage] = useState('')
  const [loginState, setLoginState] = useState('idle')
  const [loginMessage, setLoginMessage] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeFor, setEmailCodeFor] = useState('')
  const [emailCodePurpose, setEmailCodePurpose] = useState('')
  const [resendWait, setResendWait] = useState(0)
  const [twoStepState, setTwoStepState] = useState('idle')
  const [twoStepMessage, setTwoStepMessage] = useState('')
  const [twoStepCode, setTwoStepCode] = useState('')
  const [twoStepNext, setTwoStepNext] = useState(null)
  const [orders, setOrders] = useState([])
  const [ordersState, setOrdersState] = useState('idle')
  const [ordersError, setOrdersError] = useState('')
  const [ordersRetry, setOrdersRetry] = useState(0)
  const [receiptId, setReceiptId] = useState(() => routeFromPath().orderId || '')
  const [receipt, setReceipt] = useState(null)
  const [receiptState, setReceiptState] = useState('idle')
  const [receiptError, setReceiptError] = useState('')
  const [receiptRetry, setReceiptRetry] = useState(0)
  const [ratingRingkas, setRatingRingkas] = useState(null)
  const [ratingScore, setRatingScore] = useState(0)
  const [ratingNote, setRatingNote] = useState('')
  const [ratingState, setRatingState] = useState('idle')
  const [ratingError, setRatingError] = useState('')
  const [role, setRole] = useState('buyer')
  const [roleToken, setRoleToken] = useState('')
  const [adminOrders, setAdminOrders] = useState([])
  const [adminState, setAdminState] = useState('idle')
  const [adminError, setAdminError] = useState('')
  const [adminRetry, setAdminRetry] = useState(0)
  const [adminSales, setAdminSales] = useState(null)
  const [adminSalesState, setAdminSalesState] = useState('idle')
  const [adminSalesError, setAdminSalesError] = useState('')
  const [adminSalesDays, setAdminSalesDays] = useState(7)
  const [adminSalesRetry, setAdminSalesRetry] = useState(0)
  const [adminCatalog, setAdminCatalog] = useState([])
  const [adminCatalogState, setAdminCatalogState] = useState('idle')
  const [adminCatalogError, setAdminCatalogError] = useState('')
  const [adminCatalogStale, setAdminCatalogStale] = useState(false)
  const [adminCatalogFetchedAt, setAdminCatalogFetchedAt] = useState('')
  const [catalogSyncing, setCatalogSyncing] = useState(false)
  const [catalogSyncNotice, setCatalogSyncNotice] = useState('')
  const [gambarBusy, setGambarBusy] = useState(false)
  const [gambarNotice, setGambarNotice] = useState('')
  const [adminCatalogRetry, setAdminCatalogRetry] = useState(0)
  const [catalogDrafts, setCatalogDrafts] = useState({})
  const [catalogBusy, setCatalogBusy] = useState('')
  const [catalogNotice, setCatalogNotice] = useState({ sku: '', text: '', error: false })
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogFilter, setCatalogFilter] = useState('semua')
  const [catalogShowUnsupported, setCatalogShowUnsupported] = useState(false)
  const [batchNotice, setBatchNotice] = useState('')
  const [marginDrafts, setMarginDrafts] = useState({})
  const [signOutState, setSignOutState] = useState('idle')
  const [deletionState, setDeletionState] = useState('idle')
  const [deletionMessage, setDeletionMessage] = useState('')
  const [passwordDraft, setPasswordDraft] = useState('')
  const [passwordState, setPasswordState] = useState('idle')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [profileName, setProfileName] = useState('')
  const [passwordCurrent, setPasswordCurrent] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [roleState, setRoleState] = useState('idle')
  const [roleError, setRoleError] = useState('')
  const [roleRetry, setRoleRetry] = useState(0)
  const [adminRefunds, setAdminRefunds] = useState({ orders: [], refunded: [] })
  const [adminRefundsState, setAdminRefundsState] = useState('idle')
  const [adminRefundsError, setAdminRefundsError] = useState('')
  const [adminRefundsRetry, setAdminRefundsRetry] = useState(0)
  const [refundBusy, setRefundBusy] = useState('')
  const [refundNotice, setRefundNotice] = useState({ id: '', text: '', error: false })
  const [outageBusy, setOutageBusy] = useState('')
  const [contactInfo, setContactInfo] = useState(null)
  const [contactState, setContactState] = useState('idle')

  const canManage = Boolean(session && roleState === 'ready' && role === 'admin' && roleToken === session.access_token)
  const salesTotals = (adminSales?.daily || []).reduce((totals, day) => ({ paid: totals.paid + day.paid, refunded: totals.refunded + day.refunded, paidCount: totals.paidCount + day.paidCount, refundCount: totals.refundCount + day.refundCount }), { paid: 0, refunded: 0, paidCount: 0, refundCount: 0 })
  const salesRevenueMax = Math.max(1, ...(adminSales?.daily || []).flatMap((day) => [day.paid, day.refunded]))
  const salesCountMax = Math.max(1, ...(adminSales?.daily || []).map((day) => day.paidCount))
  const contactIdentity = tryParseContact(contact)
  const twoStepOn = session?.user?.user_metadata?.two_step === true
  const emailCodeForm = emailCodeFor ? <form className="code-form" onSubmit={verifyEmailCode}>
    <label htmlFor="email-code">{emailCodePurpose === 'signup' ? 'Kode konfirmasi untuk' : 'Kode masuk untuk'} {emailCodeFor}</label>
    <div className="order-input"><input id="email-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength="10" required value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ''))} placeholder="kode dari email" /><button type="submit" disabled={loginState === 'loading'}>Verifikasi</button></div>
    <button type="button" className="link-button" onClick={resendEmailCode} disabled={loginState === 'loading' || resendWait > 0}>{resendWait > 0 ? `Kirim ulang kode (${resendWait}s)` : 'Kirim ulang kode'}</button>
  </form> : null
  useEffect(() => {
    if (!session) return
    const meta = session.user.user_metadata || {}
    setRegisterUsername(meta.username || '')
    setProfileName(meta.name || meta.full_name || '')
    setRegisterPhone(session.user.phone ? String(session.user.phone).replace(/^\+62/, '0') : meta.requested_phone ? String(meta.requested_phone).replace(/^\+62/, '0') : '')
  }, [session?.user?.id])

  useEffect(() => {
    if (resendWait <= 0) return
    const timer = setTimeout(() => setResendWait(resendWait - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendWait])

  useEffect(() => {
    const pending = readPendingCode(window.localStorage, Date.now())
    if (!pending) return
    setEmailCodeFor(pending.email)
    setEmailCodePurpose(pending.purpose)
    setResendWait(pending.resendWait)
    setLoginState('sent')
    setLoginMessage(pending.purpose === 'signup' ? 'Akun berhasil dibuat. Kode telah dikirim ke email: masukkan kode di bawah, atau klik tautan konfirmasi.' : 'Kode telah dikirim ke email: masukkan kode di bawah, atau klik tautan untuk langsung masuk.')
  }, [])

  useEffect(() => {
    if (session) clearPendingCode(window.localStorage)
  }, [session?.user?.id])

  useEffect(() => {
    if (!searchOpen) return
    const closeSearch = (event) => { if (!searchBoxRef.current?.contains(event.target)) setSearchOpen(false) }
    document.addEventListener('pointerdown', closeSearch)
    return () => document.removeEventListener('pointerdown', closeSearch)
  }, [searchOpen])

  const loadSeq = useRef(0)
  async function loadProducts() {
    const seq = ++loadSeq.current
    setCatalogState('loading')
    setCheckoutAvailable(false)
    setCatalogError('')
    try {
      let headers = {}
      if (session) { try { headers = await authHeaders() } catch {} }
      const url = canManage && hargaView === 'user' ? '/api/products?harga=user' : '/api/products'
      const data = await request(url, { headers })
      if (seq !== loadSeq.current) return
      setProducts(Array.isArray(data.products) ? data.products : [])
      setCheckoutAvailable(data.checkoutAvailable === true)
      setCheckAvailable(data.checkAvailable === true)
      setCatalogState('ready')
    } catch (error) {
      if (seq !== loadSeq.current) return
      setCatalogError(error.message)
      setCatalogState('error')
    }
  }

  useEffect(() => { setHargaView('admin') }, [session?.user?.id])
  useEffect(() => { setVoucher(null); setVoucherNotice(''); setPromoCode('') }, [hargaView])
  useEffect(() => { if (view === 'checkout' && canManage && hargaView === 'user') setHargaView('admin') }, [view, canManage, hargaView])
  useEffect(() => { loadProducts() }, [session?.access_token, hargaView, canManage])
  useEffect(() => {
    applyPageMeta(routeFromPath(), currentPath())
    const navigate = () => {
      const route = routeFromPath()
      setView(route.view)
      setAdminPage(route.adminPage || 'transactions')
      setGame(route.game)
      setCheckoutId(route.checkoutId)
      setReceiptId(route.orderId || '')
      if (route.view === 'checkout') setCheckoutError('')
      setLoginState('idle')
      setLoginMessage('')
      applyPageMeta(route, currentPath())
      requestAnimationFrame(() => {
        if (['game', 'checkout', 'admin', 'receipt', 'terms', 'privacy', 'contact', 'notfound', 'account', 'register'].includes(route.view)) window.scrollTo(0, 0)
        else {
          const target = currentPath() === '/katalog' ? 'katalog' : 'main'
          if (document.getElementById(target)) document.getElementById(target).scrollIntoView()
          else requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView())
        }
      })
    }
    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target.closest?.('a[href]')
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const raw = anchor.getAttribute('href')
      if (!raw || raw.startsWith('#')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) return
      event.preventDefault()
      go(url.pathname + url.search + url.hash)
    }
    window.addEventListener('popstate', navigate)
    window.addEventListener('melon:navigate', navigate)
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('popstate', navigate)
      window.removeEventListener('melon:navigate', navigate)
      document.removeEventListener('click', onClick)
    }
  }, [])
  useEffect(() => {
    if (!supabase) return
    let active = true
    restoredSession.then(({ session: next, error }) => {
      if (!active) return
      if (error) {
        if (authReturn) {
          if (authReturn.kind === 'cancelled') showToast('info', 'Login dibatalkan', 'Anda membatalkan proses masuk dengan Google. Silakan coba lagi kapan saja.')
          else if (authReturn.kind === 'error') showToast('error', 'Login Google gagal', 'Google menolak proses masuk. Coba lagi beberapa saat nanti.')
          else showToast('error', 'Login gagal', 'Kode login sudah tidak berlaku. Silakan masuk kembali.')
        } else {
          setView('account')
          setLoginState('error')
          setLoginMessage(error.message)
        }
      } else if (!next) {
        setSession(next)
      } else {
        const freshLogin = Boolean(authReturn && (authReturn.kind === 'pkce' || authReturn.kind === 'session'))
        const startedAt = freshLogin ? writeSessionStart(window.localStorage, Date.now()) : seedSessionStart(window.localStorage, next.user, Date.now())
        if (sessionExpired(startedAt, Date.now())) {
          cutSession()
        } else {
          setSession(next)
          if (freshLogin) showToast('ok', 'Berhasil masuk', 'Anda berhasil masuk. Selamat datang kembali.')
        }
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    const storagePrefix = supabase.auth.storageKey || ''
    function syncSignOutAcrossTabs(event) {
      if (!storagePrefix || !event.key || !event.key.startsWith(storagePrefix) || event.newValue) return
      setSession(null)
    }
    window.addEventListener('storage', syncSignOutAcrossTabs)
    return () => { active = false; listener.subscription.unsubscribe(); window.removeEventListener('storage', syncSignOutAcrossTabs) }
  }, [])

  async function requestDeletion() {
    if (!session || deletionState === 'loading' || deletionState === 'sent') return
    setDeletionState('loading')
    setDeletionMessage('')
    try {
      await request('/api/account/deletion-request', { method: 'POST', headers: await authHeaders() })
      setDeletionState('sent')
      showToast('ok', 'Permintaan terkirim', 'Kami memproses penghapusan akun paling lambat 14 hari kerja.')
    } catch (error) {
      setDeletionState('error')
      setDeletionMessage(error.message)
    }
  }

  // ponytail: batas sesi 24 jam, diperiksa setiap menit dan saat tab kembali aktif.
  useEffect(() => {
    if (!supabase || !session) return
    const verifySessionAge = () => {
      const startedAt = readSessionStart(window.localStorage) ?? seedSessionStart(window.localStorage, session.user, Date.now())
      if (sessionExpired(startedAt, Date.now())) cutSession()
    }
    verifySessionAge()
    const timer = setInterval(verifySessionAge, 60000)
    const onVisibility = () => { if (document.visibilityState === 'visible') verifySessionAge() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [session])

  useEffect(() => {
    if (!session) { setOrders([]); setOrdersState('idle'); return }
    let active = true
    setOrdersState('loading')
    authHeaders().then((headers) => request('/api/orders', { headers })).then((data) => {
      if (active) { setOrders(Array.isArray(data.orders) ? data.orders : []); setOrdersState('ready') }
    }).catch((error) => { if (active) { setOrdersError(error.message); setOrdersState('error') } })
    return () => { active = false }
  }, [session?.access_token, ordersRetry])

  useEffect(() => {
    if (view !== 'receipt' || !session) { setReceipt(null); setReceiptState('idle'); return }
    if (!receiptId) { setReceipt(null); setReceiptError('Pesanan tidak ditemukan. Buka struk dari riwayat pesanan di akun.'); setReceiptState('error'); return }
    let active = true
    setReceiptState((current) => (current === 'ready' ? current : 'loading'))
    authHeaders().then((headers) => request(`/api/orders/${encodeURIComponent(receiptId)}`, { headers })).then((data) => {
      if (active) { setReceipt(data.order || null); setReceiptState('ready') }
    }).catch((error) => { if (active) { setReceiptError(error.message); setReceiptState('error') } })
    return () => { active = false }
  }, [view, session?.access_token, receiptId, receiptRetry])

  useEffect(() => {
    if (view !== 'receipt' || receiptState !== 'ready' || !ACTIVE_STATUSES.includes(receipt?.status)) return
    const timer = setTimeout(() => setReceiptRetry((value) => value + 1), receiptDelay(receiptRetry))
    return () => clearTimeout(timer)
  }, [view, receiptState, receipt?.status, receiptRetry])

  // ponytail: ringkasan penilaian per layanan dipakai di kepala halaman game dan struk.
  useEffect(() => {
    const nama = game || (products.find((item) => item.id === checkoutId) || {}).game || ''
    if (!nama) { setRatingRingkas(null); return undefined }
    let aktif = true
    request(`/api/ratings?game=${encodeURIComponent(nama)}`).then((data) => { if (aktif) setRatingRingkas(data.rating || null) }).catch(() => { if (aktif) setRatingRingkas(null) })
    return () => { aktif = false }
  }, [game, checkoutId, products])

  useEffect(() => {
    setRatingScore(Number(receipt?.ratingScore) || 0)
    setRatingNote(receipt?.ratingNote || '')
    setRatingState(receipt?.ratingScore ? 'saved' : 'idle')
    setRatingError('')
  }, [receipt?.id, receipt?.ratingScore, receipt?.ratingNote])

  async function kirimPenilaian() {
    if (!receipt || ratingState === 'sending') return
    if (!ratingScore) { setRatingError('Pilih jumlah bintang terlebih dahulu.'); return }
    setRatingState('sending')
    setRatingError('')
    try {
      const headers = await authHeaders()
      await request(`/api/orders/${encodeURIComponent(receipt.id)}/rating`, { method: 'POST', headers, body: JSON.stringify({ score: ratingScore, note: ratingNote }) })
      setRatingState('saved')
    } catch (error) {
      setRatingError(error.message)
      setRatingState('idle')
    }
  }

  // ponytail: hitung mundur masa bayar cuma jalan saat invoice menunggu pembayaran.
  useEffect(() => {
    if (view !== 'receipt' || receipt?.status !== 'pending') return
    setClock(Date.now())
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [view, receipt?.status])

  // ponytail: modal konfirmasi dapat ditutup dengan Esc, tapi tidak saat pesanan sedang dibuat.
  useEffect(() => {
    if (!confirmOpen) return
    const onKey = (event) => { if (event.key === 'Escape' && checkoutState !== 'loading') setConfirmOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmOpen, checkoutState])

  useEffect(() => {
    if (!session) { setRole('buyer'); setRoleToken(''); setRoleState('idle'); return }
    let active = true
    setRole('buyer')
    setRoleToken('')
    setRoleState('loading')
    setRoleError('')
    authHeaders().then((headers) => request('/api/me', { headers })).then((data) => {
      if (active) { setRole(data.role === 'admin' ? 'admin' : 'buyer'); setRoleToken(session.access_token); setRoleState('ready') }
    }).catch((error) => { if (active) { setRole('buyer'); setRoleToken(''); setRoleError(error.message); setRoleState('error') } })
    return () => { active = false }
  }, [session?.access_token, roleRetry])

  useEffect(() => {
    if (!session || role !== 'admin' || roleState !== 'ready' || roleToken !== session.access_token) { setAdminOrders([]); setAdminState('idle'); return }
    let active = true
    setAdminState('loading')
    setAdminError('')
    authHeaders().then((headers) => request('/api/admin/vouchers', { headers })).then((data) => setAdminVouchers(data.vouchers || [])).catch(() => {})
    authHeaders().then((headers) => request('/api/admin/orders', { headers })).then((data) => {
      if (active) { setAdminOrders(Array.isArray(data.orders) ? data.orders : []); setAdminState('ready') }
    }).catch((error) => { if (active) { setAdminError(error.message); setAdminState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, adminRetry])

  useEffect(() => {
    if (!session || role !== 'admin' || roleState !== 'ready' || roleToken !== session.access_token || view !== 'admin' || adminPage !== 'summary') { setAdminSales(null); setAdminSalesState('idle'); return }
    let active = true
    setAdminSalesState('loading')
    setAdminSalesError('')
    authHeaders().then((headers) => request(`/api/admin/sales?days=${adminSalesDays}`, { headers })).then((data) => { if (active) { setAdminSales(data); setAdminSalesState('ready') } }).catch((error) => { if (active) { setAdminSalesError(error.message); setAdminSalesState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, view, adminPage, adminSalesDays, adminSalesRetry])

  useEffect(() => {
    if (!session || role !== 'admin' || roleState !== 'ready' || roleToken !== session.access_token) { setAdminCatalog([]); setAdminCatalogState('idle'); setAdminCatalogStale(false); return }
    let active = true
    setAdminCatalogState('loading')
    setAdminCatalogError('')
    setAdminCatalogStale(false)
    authHeaders().then((headers) => request('/api/admin/supplier-products', { headers })).then((data) => {
      if (!active) return
      const items = Array.isArray(data.products) ? data.products : []
      setAdminCatalog(items)
      setAdminCatalogStale(data.catalogStale === true)
      setAdminCatalogFetchedAt(typeof data.catalogFetchedAt === 'string' ? data.catalogFetchedAt : '')
      setCatalogDrafts(Object.fromEntries(items.map((item) => [item.sku, { price: item.price == null ? '' : String(item.price), enabled: item.enabled === true, priceMode: item.priceMode === 'manual' ? 'manual' : 'auto' }])))
      setAdminCatalogState('ready')
    }).catch((error) => { if (active) { setAdminCatalogError(error.message); setAdminCatalogState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, adminCatalogRetry])
  useEffect(() => {
    if (!session || role !== 'admin' || roleState !== 'ready' || roleToken !== session.access_token) { setAdminRefunds({ orders: [], refunded: [] }); setAdminRefundsState('idle'); return }
    let active = true
    setAdminRefundsState('loading')
    setAdminRefundsError('')
    authHeaders().then((headers) => request('/api/admin/refunds', { headers })).then((data) => {
      if (!active) return
      setAdminRefunds({ orders: Array.isArray(data.orders) ? data.orders : [], refunded: Array.isArray(data.refunded) ? data.refunded : [] })
      setAdminRefundsState('ready')
    }).catch((error) => { if (active) { setAdminRefundsError(error.message); setAdminRefundsState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, adminRefundsRetry])

  // ponytail: kontak diambil dari server sekali saja; kalau gagal, email bawaan tetap tampil supaya tidak ada halaman buntu.
  useEffect(() => {
    if (view !== 'contact' || contactInfo) return
    let active = true
    setContactState('loading')
    request('/api/contact').then((data) => {
      if (active) { setContactInfo(data); setContactState('ready') }
    }).catch(() => {
      if (active) { setContactInfo({ email: 'halo@melonbyte.id', whatsapp: null }); setContactState('ready') }
    })
    return () => { active = false }
  }, [view, contactInfo])

  function exportCatalogCsv() {
    const rows = adminCatalog.map((item) => {
      const draft = catalogDrafts[item.sku] || {}
      return { sku: item.sku, name: item.name, game: item.game, category: item.category, cost: item.cost, price: draft.price ?? item.price, saran: suggestPrice(item.cost, item.category), priceMode: draft.priceMode || item.priceMode || 'auto', enabled: draft.enabled === true }
    })
    const blob = new Blob([buildCatalogCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `harga-melonbyte-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setBatchNotice(`${rows.length} baris CSV disiapkan. Buka di Excel, ubah kolom harga_sekarang, lalu impor balik.`)
  }

  async function importCatalogCsv(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    let rows
    try { rows = parseCatalogCsv(await file.text()) } catch (error) { setBatchNotice(`CSV tidak dapat dibaca: ${error.message}`); return }
    if (!rows) { setBatchNotice('Header CSV tidak dikenali. Gunakan tombol Ekspor CSV sebagai contoh format.'); return }
    const known = new Map(adminCatalog.map((item) => [item.sku, item]))
    const patch = {}
    let unknown = 0
    for (const row of rows) {
      if (!known.has(row.sku)) { unknown += 1; continue }
      const draft = catalogDrafts[row.sku] || { price: '', enabled: false, priceMode: 'auto' }
      patch[row.sku] = { ...draft, priceMode: row.priceMode, ...(row.price == null ? {} : { price: String(row.price) }) }
    }
    const applied = Object.keys(patch).length
    if (applied === 0) { setBatchNotice('Tidak ada baris CSV yang cocok dengan katalog.'); return }
    setCatalogDrafts((drafts) => ({ ...drafts, ...patch }))
    setBatchNotice(`${applied} baris CSV masuk ke draf${unknown > 0 ? `; ${unknown} SKU tidak ada di katalog` : ''}. Klik "Simpan semua" untuk menerapkan.`)
  }

  async function syncCatalog() {
    if (catalogSyncing) return
    setCatalogSyncing(true)
    setCatalogSyncNotice('')
    try {
      const headers = await authHeaders()
      const data = await request('/api/admin/supplier-products/sync', { method: 'POST', headers })
      const repriced = Number(data.autoPriced) || 0
      setCatalogSyncNotice(`Katalog diperbarui: ${Number(data.synced) || 0} produk.${repriced > 0 ? ` ${repriced} harga otomatis disesuaikan.` : ''}`)
      showToast('ok', 'Katalog diperbarui', `${Number(data.synced) || 0} produk supplier tersinkron${repriced > 0 ? `, ${repriced} harga otomatis disesuaikan` : ''}.`)
      setAdminCatalogRetry((value) => value + 1)
    } catch (error) {
      setCatalogSyncNotice(error.message)
    } finally {
      setCatalogSyncing(false)
    }
  }

  async function refreshGameImages() {
    if (gambarBusy) return
    setGambarBusy(true)
    setGambarNotice('')
    try {
      const headers = await authHeaders()
      const data = await request('/api/admin/game-icons/refresh', { method: 'POST', headers })
      const daftar = Array.isArray(data.icons) ? data.icons : []
      const berhasil = daftar.filter((item) => item.ok)
      const gagal = daftar.filter((item) => !item.ok)
      if (gagal.length === 0) {
        setGambarNotice(`Gambar diperbarui: ${berhasil.length} game. Muat ulang halaman toko untuk melihat hasilnya.`)
        showToast('ok', 'Gambar game diperbarui', `${berhasil.length} ikon diambil dari App Store.`)
      } else {
        setGambarNotice(`Berhasil ${berhasil.length} game, gagal ${gagal.length}: ${gagal.map((item) => `${item.slug} (${item.error})`).join(', ')}`)
      }
    } catch (error) {
      setGambarNotice(error.message)
    } finally {
      setGambarBusy(false)
    }
  }

  async function signIn(event) {
    event.preventDefault()
    if (!supabase || loginState === 'loading') return
    let identity
    try {
      identity = parseContact(contact)
    } catch (error) {
      setLoginState('error')
      setLoginMessage(error.message)
      return
    }
    if (!loginPassword) {
      setLoginState('error')
      setLoginMessage(identity.email ? 'Isi kata sandi akun Anda terlebih dahulu, atau gunakan tombol "Masuk tanpa kata sandi".' : 'Isi kata sandi akun Anda terlebih dahulu. Kode verifikasi tetap dikirim melalui email, bukan SMS.')
      return
    }
    setLoginState('loading')
    setLoginMessage('')
    try {
      if (identity.email) {
        const { data, error } = await supabase.auth.signInWithPassword({ email: identity.email, password: loginPassword })
        if (error) throw error
        if (data.user?.user_metadata?.two_step === true) {
          await supabase.auth.signOut({ scope: 'local' })
          await sendLoginEmail(identity.email)
          setLoginPassword('')
          setEmailCodeFor(identity.email)
          setEmailCodePurpose('login')
          setEmailCode('')
          setResendWait(60)
          setLoginState('sent')
          setLoginMessage('Verifikasi 2 langkah aktif. Kode telah dikirim ke email: masukkan kode di bawah.')
        } else {
          setLoginPassword('')
          writeSessionStart(window.localStorage, Date.now())
          setLoginState('idle')
          showToast('ok', 'Berhasil masuk', `Halo, ${data.user?.user_metadata?.name || data.user?.user_metadata?.full_name || data.user?.user_metadata?.username || identity.email}!`)
        }
      } else {
        const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: identity.phone, password: loginPassword }) })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'Login gagal. Coba lagi.')
        if (data.needsConfirmation) {
          const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: data.email, options: { emailRedirectTo: window.location.origin + '/' } })
          if (resendError) throw resendError
          setLoginPassword('')
          setEmailCodeFor(data.email)
          setEmailCodePurpose('signup')
          setEmailCode('')
          setResendWait(60)
          setLoginState('sent')
          setLoginMessage('Email akun ini belum dikonfirmasi. Kode konfirmasi baru telah dikirim ke email: masukkan kode di bawah.')
          writePendingCode(window.localStorage, { email: data.email, purpose: 'signup', sentAt: Date.now() })
        } else {
          const { data: signedIn, error: sessionError } = await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token })
          if (sessionError) throw sessionError
          if (signedIn.user?.user_metadata?.two_step === true) {
            await supabase.auth.signOut({ scope: 'local' })
            await sendLoginEmail(signedIn.user.email)
            setLoginPassword('')
            setEmailCodeFor(signedIn.user.email)
            setEmailCodePurpose('login')
            setEmailCode('')
            setResendWait(60)
            setLoginState('sent')
            setLoginMessage('Verifikasi 2 langkah aktif. Kode telah dikirim ke email: masukkan kode di bawah.')
          } else {
            setLoginPassword('')
            writeSessionStart(window.localStorage, Date.now())
            setLoginState('idle')
            showToast('ok', 'Berhasil masuk', `Halo, ${signedIn.user?.user_metadata?.name || signedIn.user?.user_metadata?.full_name || signedIn.user?.user_metadata?.username || identity.phone}!`)
          }
        }
      }
    } catch (error) {
      if (identity?.email && /email not confirmed/i.test(error.message || '')) {
        try {
          const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: identity.email, options: { emailRedirectTo: window.location.origin + '/' } })
          if (resendError) throw resendError
          setLoginPassword('')
          setEmailCodeFor(identity.email)
          setEmailCodePurpose('signup')
          setEmailCode('')
          setResendWait(60)
          setLoginState('sent')
          setLoginMessage('Email Anda belum dikonfirmasi. Kode konfirmasi baru telah dikirim ke email: masukkan kode di bawah.')
          writePendingCode(window.localStorage, { email: identity.email, purpose: 'signup', sentAt: Date.now() })
          return
        } catch (resendError) {
          setLoginState('error')
          setLoginMessage(authErrorMessage(resendError.message))
          return
        }
      }
      setLoginState('error')
      setLoginMessage(authErrorMessage(error.message))
    }
  }

  async function sendLoginEmail(email) {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + '/', shouldCreateUser: false } })
    if (error) throw error
  }

  async function sendEmailLink() {
    if (!supabase || loginState === 'loading') return
    const identity = tryParseContact(contact)
    if (!identity.email) return
    setLoginState('loading')
    setLoginMessage('')
    try {
      await sendLoginEmail(identity.email)
      setEmailCodeFor(identity.email)
      setEmailCodePurpose('login')
      setEmailCode('')
      setResendWait(60)
      setLoginState('sent')
      setLoginMessage('Kode telah dikirim ke email: masukkan kode di bawah, atau klik tautan untuk langsung masuk.')
      writePendingCode(window.localStorage, { email: identity.email, purpose: 'login', sentAt: Date.now() })
    } catch (error) {
      setLoginState('error')
      setLoginMessage(authErrorMessage(error.message))
    }
  }

  async function resendEmailCode() {
    if (!supabase || !emailCodeFor || loginState === 'loading' || resendWait > 0) return
    setLoginState('loading')
    setLoginMessage('')
    try {
      if (emailCodePurpose === 'signup') {
        const { error } = await supabase.auth.resend({ type: 'signup', email: emailCodeFor, options: { emailRedirectTo: window.location.origin + '/' } })
        if (error) throw error
      } else {
        await sendLoginEmail(emailCodeFor)
      }
      setResendWait(60)
      setLoginState('sent')
      setLoginMessage('Kode baru telah dikirim ke email. Periksa kotak masuk dan folder spam.')
      writePendingCode(window.localStorage, { email: emailCodeFor, purpose: emailCodePurpose, sentAt: Date.now() })
    } catch (error) {
      setLoginState('error')
      setLoginMessage(authErrorMessage(error.message))
    }
  }

  async function verifyEmailCode(event) {
    event.preventDefault()
    if (!supabase || loginState === 'loading' || !/^\d{6,10}$/.test(emailCode)) return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const type = emailCodePurpose === 'signup' ? 'signup' : 'email'
      const { error } = await supabase.auth.verifyOtp({ email: emailCodeFor, token: emailCode, type })
      if (error) throw error
      writeSessionStart(window.localStorage, Date.now())
      clearPendingCode(window.localStorage)
      setEmailCode('')
      setEmailCodeFor('')
      setEmailCodePurpose('')
      setResendWait(0)
      setLoginState('idle')
      showToast('ok', 'Berhasil masuk', 'Anda berhasil masuk. Selamat datang di Melonbyte.')
      go('/akun')
    } catch (error) {
      setLoginState('error')
      setLoginMessage(authErrorMessage(error.message))
    }
  }

  async function register(event) {
    event.preventDefault()
    if (!supabase || loginState === 'loading') return
    if (registerPassword.length < 6) {
      setLoginState('error')
      setLoginMessage('Kata sandi minimal 6 karakter.')
      return
    }
    setLoginState('loading')
    setLoginMessage('')
    try {
      const { email, requested_phone, username } = parseRegistration(registerEmail, registerPhone, registerUsername)
      const { data, error } = await supabase.auth.signUp({
        email,
        password: registerPassword,
        options: {
          emailRedirectTo: window.location.origin + '/',
          data: { username, requested_phone },
        },
      })
      if (error) throw error
      setRegisterPassword('')
      if (data?.session) {
        go('/akun')
        setLoginState('idle')
        setLoginMessage('Akun berhasil dibuat. Anda langsung masuk.')
      } else if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
        await sendLoginEmail(email)
        setEmailCodeFor(email)
        setEmailCodePurpose('login')
        setEmailCode('')
        setResendWait(60)
        setLoginState('sent')
        setLoginMessage('Email ini sudah terdaftar. Anda langsung masuk ke akun tersebut. Kode telah dikirim ke email: masukkan kode di bawah.')
        writePendingCode(window.localStorage, { email, purpose: 'login', sentAt: Date.now() })
      } else {
        setEmailCodeFor(email)
        setEmailCodePurpose('signup')
        setEmailCode('')
        setResendWait(60)
        setLoginState('sent')
        setLoginMessage('Akun berhasil dibuat. Kode telah dikirim ke email: masukkan kode di bawah, atau klik tautan konfirmasi.')
        writePendingCode(window.localStorage, { email, purpose: 'signup', sentAt: Date.now() })
      }
    } catch (error) {
      setLoginState('error')
      setLoginMessage(authErrorMessage(error.message))
    }
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (!supabase || !session || profileState === 'loading') return
    setProfileState('loading')
    setPhoneMessage('')
    try {
      const { requested_phone, username } = parseRegistration(session.user.email || '', registerPhone, registerUsername)
      const { error } = await supabase.auth.updateUser({ data: { ...session.user.user_metadata, username, requested_phone, name: profileName.trim() } })
      if (error) throw error
      setPhoneMessage('Profil tersimpan.')
      setProfileState('ready')
      showToast('ok', 'Profil tersimpan', 'Nama, username, dan nomor HP akun Anda telah diperbarui.')
    } catch (error) {
      setProfileState('error')
      setPhoneMessage(error.message || 'Gagal menyimpan data akun.')
    }
  }

  async function requestTwoStepChange() {
    if (!supabase || !session || !session.user.email || twoStepState === 'loading') return
    const next = twoStepOn !== true
    setTwoStepState('loading')
    setTwoStepMessage('')
    try {
      await sendLoginEmail(session.user.email)
      setTwoStepNext(next)
      setTwoStepCode('')
      setResendWait(60)
      setTwoStepState('sent')
      setTwoStepMessage(`Kode sudah dikirim ke ${session.user.email}. Masukkan kodenya untuk mengonfirmasi ${next ? 'mengaktifkan' : 'mematikan'} verifikasi 2 langkah.`)
    } catch (error) {
      setTwoStepState('error')
      setTwoStepMessage(authErrorMessage(error.message))
    }
  }

  async function resendTwoStepCode() {
    if (!supabase || !session || !session.user.email || twoStepNext === null || twoStepState === 'loading' || resendWait > 0) return
    setTwoStepState('loading')
    setTwoStepMessage('')
    try {
      await sendLoginEmail(session.user.email)
      setResendWait(60)
      setTwoStepState('sent')
      setTwoStepMessage('Kode baru telah dikirim ke email. Periksa kotak masuk dan folder spam.')
    } catch (error) {
      setTwoStepState('error')
      setTwoStepMessage(authErrorMessage(error.message))
    }
  }

  async function verifyTwoStepCode(event) {
    event.preventDefault()
    if (!supabase || !session || !session.user.email || twoStepNext === null || twoStepState === 'loading') return
    if (!/^\d{6,10}$/.test(twoStepCode)) {
      setTwoStepState('error')
      setTwoStepMessage('Kode terdiri dari 6-10 digit angka. Periksa email terbaru dari Melonbyte.')
      return
    }
    setTwoStepState('loading')
    setTwoStepMessage('')
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: session.user.email, token: twoStepCode, type: 'email' })
      if (verifyError) throw verifyError
      const { error } = await supabase.auth.updateUser({ data: { ...session.user.user_metadata, two_step: twoStepNext } })
      if (error) throw error
      const enabling = twoStepNext === true
      writeSessionStart(window.localStorage, Date.now())
      setTwoStepNext(null)
      setTwoStepCode('')
      setResendWait(0)
      setTwoStepState('ready')
      setTwoStepMessage(enabling ? 'Verifikasi 2 langkah aktif. Login berikutnya akan meminta kode dari email.' : 'Verifikasi 2 langkah dimatikan. Login cukup dengan email dan kata sandi.')
      showToast(enabling ? 'ok' : 'info', enabling ? 'Verifikasi 2 langkah aktif' : 'Verifikasi 2 langkah dimatikan', enabling ? 'Login berikutnya akan meminta kode dari email.' : 'Login sekarang cukup dengan email dan kata sandi.')
    } catch (error) {
      setTwoStepState('error')
      setTwoStepMessage(authErrorMessage(error.message))
    }
  }

  function cancelTwoStepChange() {
    setTwoStepNext(null)
    setTwoStepCode('')
    setResendWait(0)
    setTwoStepState('idle')
    setTwoStepMessage('')
  }

  async function savePassword(event) {
    event.preventDefault()
    if (!supabase || !session || passwordState === 'loading') return
    if (passwordDraft.length < 6) {
      setPasswordState('error')
      setPasswordMessage('Kata sandi baru minimal 6 karakter.')
      return
    }
    if (passwordDraft !== passwordConfirm) {
      setPasswordState('error')
      setPasswordMessage('Konfirmasi tidak sama dengan kata sandi baru. Ulangi pengisian kata sandi baru.')
      return
    }
    setPasswordState('loading')
    setPasswordMessage('')
    try {
      if (passwordCurrent && session.user.email) {
        const { error: checkError } = await supabase.auth.signInWithPassword({ email: session.user.email, password: passwordCurrent })
        if (checkError) throw new Error('Kata sandi saat ini salah.')
      }
      const { error } = await supabase.auth.updateUser({ password: passwordDraft })
      if (error) throw error
      setPasswordCurrent('')
      setPasswordDraft('')
      setPasswordConfirm('')
      setPasswordState('idle')
      setPasswordMessage('Kata sandi tersimpan. Login berikutnya cukup dengan email dan kata sandi.')
      showToast('ok', 'Kata sandi tersimpan', 'Login berikutnya cukup dengan email dan kata sandi baru.')
    } catch (error) {
      setPasswordState('error')
      setPasswordMessage(authErrorMessage(error.message))
    }
  }

  const signOutButton = <button type="button" className="secondary-button signout-button" onClick={signOutAccount} disabled={signOutState === 'loading'}>{signOutState === 'loading' ? 'Keluar...' : 'Keluar akun'}</button>
  const deletionBlock = (
    <section className="account-danger" aria-labelledby="hapus-akun">
      <h2 id="hapus-akun">Hapus akun</h2>
      <p>Permintaan penghapusan diproses paling lambat 14 hari kerja. Riwayat transaksi tetap disimpan sesuai kewajiban pembukuan, tanpa data pribadi yang tidak diperlukan.</p>
      {deletionState === 'sent' ? <p role="status">Permintaan tercatat. Konfirmasi dikirim ke email terdaftar setelah data dihapus.</p> : <button type="button" className="secondary-button" onClick={requestDeletion} disabled={deletionState === 'loading'}>{deletionState === 'loading' ? 'Mengirim...' : 'Ajukan penghapusan akun'}</button>}
      {deletionState === 'error' && <p role="alert">{deletionMessage}</p>}
    </section>
  )

  async function signOutAccount() {
    if (!supabase || signOutState === 'loading') return
    setSignOutState('loading')
    setSession(null)
    setTwoStepNext(null)
    setTwoStepCode('')
    setTwoStepState('idle')
    setTwoStepMessage('')
    setLoginState('idle')
    setLoginMessage('')
    setPhoneMessage('')
    try {
      await Promise.race([
        Promise.allSettled([supabase.auth.signOut(), supabase.auth.signOut({ scope: 'local' })]),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ])
    } catch { /* jaringan dapat gagal; sesi lokal tetap dibersihkan di bawah */ }
    try {
      const storage = window.localStorage
      const prefix = supabase.auth.storageKey
      for (const key of Object.keys(storage)) {
        if (key.startsWith(prefix)) storage.removeItem(key)
      }
    } catch { /* localStorage dapat diblokir; tombol logout tetap selesai */ }
    clearSessionStart(window.localStorage)
    setSignOutState('idle')
    showToast('ok', 'Anda telah keluar', 'Sesi di perangkat ini telah ditutup.')
  }

  // ponytail: batas sesi 24 jam. Sesi lokal ditutup dan pengguna diminta masuk kembali.
  async function cutSession() {
    if (!supabase) return
    setSession(null)
    setTwoStepNext(null)
    setTwoStepCode('')
    setTwoStepState('idle')
    setTwoStepMessage('')
    setLoginState('idle')
    setLoginMessage('Sesi berakhir karena telah berjalan 24 jam. Silakan masuk kembali.')
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* jaringan dapat gagal; pembersihan lokal di bawah tetap jalan */ }
    try {
      const storage = window.localStorage
      const prefix = supabase.auth.storageKey
      for (const key of Object.keys(storage)) {
        if (key.startsWith(prefix)) storage.removeItem(key)
      }
    } catch { /* localStorage dapat diblokir */ }
    clearSessionStart(window.localStorage)
    showToast('info', 'Sesi berakhir', 'Sesi dibatasi 24 jam. Silakan masuk kembali untuk melanjutkan.')
  }

  function showToast(tone, title, body) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ tone, title, body })
    toastTimer.current = setTimeout(() => setToast(null), 5200)
  }

  function closeToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(null)
  }

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    function handleHistoryRestore(event) {
      if (!event.persisted || loginState !== 'loading') return
      setLoginState('idle')
      showToast('info', 'Login dibatalkan', 'Anda menutup proses masuk dengan Google sebelum selesai. Silakan coba lagi kapan saja.')
    }
    window.addEventListener('pageshow', handleHistoryRestore)
    return () => window.removeEventListener('pageshow', handleHistoryRestore)
  }, [loginState])

  async function signInGoogle() {
    if (!supabase || loginState === 'loading') return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } })
      if (error) throw error
    } catch (error) {
      setLoginState('idle')
      showToast('error', 'Login Google gagal', authErrorMessage(error.message))
    }
  }

  // ponytail: pengiriman formulir tidak langsung membuat pesanan. Data diverifikasi terlebih dahulu di modal konfirmasi.
  function openConfirm(event) {
    event.preventDefault()
    if (!selected || !checkoutAvailable || checkoutState === 'loading') return
    if (selected && isOutage(selected)) {
      setCheckoutError(OUTAGE_NOTE)
      setCheckoutState('error')
      return
    }
    if (!supabase || !session) {
      setCheckoutError('Masuk ke akun Anda terlebih dahulu sebelum membuat pesanan.')
      setCheckoutState('error')
      return
    }
    if (orderFormat === 'uid_server' && !zoneId) {
      setCheckoutError('Pilih server akun terlebih dahulu, lalu lanjut ke pembayaran.')
      setCheckoutState('error')
      return
    }
    setCheckoutError('')
    setCheckoutState('idle')
    setTermsOk(true)
    setConfirmOpen(true)
  }

  // ponytail: potongan voucher cuma berlaku untuk produk yang sedang dipilih; kalau pembeli ganti produk, potongannya otomatis dilepas.
  function activeVoucher() {
    return voucher && selected && voucher.productId === selected.id ? voucher : null
  }
  function voucherCut() {
    const picked = activeVoucher()
    return picked ? picked.discount : 0
  }
  // ponytail: angka potongan diminta ke server, bukan dihitung di browser, supaya layar dan tagihan tidak pernah beda.
  async function applyVoucher() {
    if (!selected || voucherBusy) return
    const code = promoCode.trim().toUpperCase()
    if (!code) return
    setVoucherBusy(true)
    setVoucherNotice('')
    try {
      const data = await request('/api/voucher', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ code, productId: selected.id }) })
      setVoucher({ ...data.voucher, productId: selected.id })
      setPromoCode(data.voucher.code)
    } catch (error) {
      setVoucher(null)
      setVoucherNotice(error.message)
    } finally {
      setVoucherBusy(false)
    }
  }
  async function createVoucher(event) {
    event.preventDefault()
    if (voucherBusy) return
    setVoucherBusy(true)
    setVoucherAdminNotice('')
    try {
      const data = await request('/api/admin/vouchers', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ code: voucherDraft.code.trim().toUpperCase(), kind: 'fixed', value: Number(voucherDraft.value), minOrder: Number(voucherDraft.minOrder), quota: voucherDraft.quota === '' ? null : Number(voucherDraft.quota), perUser: Number(voucherDraft.perUser), newBuyersOnly: voucherDraft.newBuyersOnly, days: Number(voucherDraft.days) }) })
      setAdminVouchers(data.vouchers || [])
      setVoucherAdminNotice(`Voucher ${data.code} tersimpan.`)
    } catch (error) {
      setVoucherAdminNotice(error.message)
    } finally {
      setVoucherBusy(false)
    }
  }
  async function toggleVoucher(item) {
    try {
      const data = await request(`/api/admin/vouchers/${encodeURIComponent(item.code)}`, { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ active: !item.active }) })
      setAdminVouchers(data.vouchers || [])
    } catch (error) {
      setVoucherAdminNotice(error.message)
    }
  }

  // ponytail: refund diproses di server (Midtrans atau tandai manual); tombol cuma memicu dan menampilkan hasilnya.
  async function processRefund(order, manual) {
    if (refundBusy) return
    let note = ''
    if (manual) {
      if (!window.confirm(`Tandai refund manual untuk #${order.id}?\n\nGunakan ini hanya jika dana sudah dikembalikan sendiri di luar sistem.`)) return
      note = (window.prompt('Catatan refund manual (contoh: transfer bank BCA, 21 Okt):') || '').trim()
      if (note.length < 3) { setRefundNotice({ id: order.id, text: 'Refund manual memerlukan catatan singkat.', error: true }); return }
    }
    setRefundBusy(order.id)
    setRefundNotice({ id: '', text: '', error: false })
    try {
      const data = await request(`/api/admin/orders/${encodeURIComponent(order.id)}/refund`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify(manual ? { manual: true, note } : { manual: false }) })
      setRefundNotice({ id: order.id, text: data.manual ? 'Ditandai refund manual. Pembeli menerima email konfirmasi.' : 'Refund dikirim melalui Midtrans. Pembeli menerima email konfirmasi.', error: false })
      showToast('ok', 'Refund diproses', `${order.productName} · ${rupiah(order.price)}`)
      setAdminRefundsRetry((value) => value + 1)
    } catch (error) {
      setRefundNotice({ id: order.id, text: error.message, error: true })
    } finally {
      setRefundBusy('')
    }
  }

  // ponytail: tanda gangguan per produk; menonaktifkan satu nominal tanpa mengubah harga atau status tampil.
  async function toggleOutage(item) {
    if (outageBusy) return
    const next = item.gangguan !== true
    setOutageBusy(item.sku)
    setCatalogNotice({ sku: '', text: '', error: false })
    try {
      const data = await request(`/api/admin/products/${encodeURIComponent(item.sku)}/outage`, { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ gangguan: next }) })
      setAdminCatalog((items) => items.map((current) => current.sku === item.sku ? { ...current, gangguan: data.product.gangguan === true } : current))
      setCatalogNotice({ sku: item.sku, text: next ? 'Ditandai gangguan: produk tidak dapat dipesan sampai gangguan dicabut.' : 'Gangguan dicabut: produk dapat dipesan kembali.', error: false })
      showToast(next ? 'info' : 'ok', next ? 'Produk ditandai gangguan' : 'Gangguan dicabut', next ? `${item.name || item.sku} ditandai gangguan dan tidak dapat dipesan.` : `${item.name || item.sku} dapat dipesan kembali.`)
      loadProducts()
    } catch (error) {
      setCatalogNotice({ sku: item.sku, text: error.message, error: true })
    } finally {
      setOutageBusy('')
    }
  }

  // ponytail: pesanan dibuat di sini (setelah konfirmasi), lalu halaman invoice yang menampilkan QR/VA.
  async function checkout() {
    if (!selected || !checkoutAvailable || checkoutState === 'loading' || !termsOk) return
    setCheckoutState('loading')
    setCheckoutError('')
    try {
      if (!supabase || !session) throw new Error('Masuk ke akun Anda terlebih dahulu sebelum membuat pesanan.')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail.trim())) throw new Error('Isi email kontak yang valid sebelum membuat pesanan.')
      if (!/^[0-9+()\s-]{8,20}$/.test(contactPhone.trim())) throw new Error('Isi nomor HP kontak yang valid sebelum membuat pesanan.')
      const voucherUse = activeVoucher()
      const payable = selected.price - (voucherUse ? voucherUse.discount : 0)
      const data = await request('/api/checkout', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ ...(selected.format === 'plain' || selected.format === 'riot' ? { productId: selected.id, userId: userId.trim() } : { productId: selected.id, userId: userId.trim(), zoneId: zoneId.trim() }), paymentMethod: activePaymentMethod(payable), voucherCode: voucherUse?.code, contactEmail: contactEmail.trim(), contactPhone: contactPhone.trim() }),
      })
      if (!data.orderId) throw new Error('Pesanan tidak terbentuk. Coba lagi beberapa saat nanti.')
      setConfirmOpen(false)
      setCheckoutState('idle')
      setReceipt(null)
      go(`/struk/${encodeURIComponent(data.orderId)}`)
    } catch (error) {
      setCheckoutError(error.message)
      setCheckoutState('error')
    }
  }

  async function copyText(value) {
    if (!value) return
    const mark = () => {
      setCopied(value)
      setTimeout(() => setCopied((current) => (current === value ? '' : current)), 2500)
    }
    try {
      await navigator.clipboard.writeText(value)
      mark()
    } catch (error) {
      // ponytail: sebagian browser menolak Clipboard API tanpa HTTPS. Gunakan cara lama sebelum menyerah.
      try {
        const field = document.createElement('textarea')
        field.value = value
        field.setAttribute('readonly', '')
        field.style.position = 'fixed'
        field.style.opacity = '0'
        document.body.appendChild(field)
        field.select()
        const ok = document.execCommand('copy')
        field.remove()
        if (!ok) throw new Error('copy ditolak browser')
        mark()
      } catch (fallbackError) {
        showToast('error', 'Gagal menyalin', 'Salin nomor secara manual.')
      }
    }
  }

  async function saveSellingPrice(sku) {
    const draft = catalogDrafts[sku]
    if (!draft || catalogBusy) return
    const price = Number(draft.price)
    if (!Number.isSafeInteger(price) || price < 1) { setCatalogNotice({ sku, text: 'Harga jual harus berupa angka bulat minimal 1.', error: true }); return }
    setCatalogBusy(sku)
    setCatalogNotice({ sku: '', text: '', error: false })
    try {
      const data = await request(`/api/admin/products/${encodeURIComponent(sku)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ price, enabled: draft.enabled, priceMode: draft.priceMode === 'manual' ? 'manual' : 'auto' }) })
      const product = data.product
      setAdminCatalog((items) => items.map((item) => item.sku === sku ? { ...item, ...product } : item))
      setCatalogDrafts((drafts) => ({ ...drafts, [sku]: { price: product.price == null ? '' : String(product.price), enabled: product.enabled === true, priceMode: product.priceMode === 'manual' ? 'manual' : 'auto' } }))
      setCatalogNotice({ sku, text: product.enabled ? 'Tersimpan. Produk tampil di katalog.' : 'Tersimpan. Produk belum tampil di katalog.', error: false })
      showToast('ok', 'Harga tersimpan', product.enabled ? 'Produk tampil di katalog pembeli.' : 'Produk disimpan sebagai draf, belum tampil di katalog.')
      loadProducts()
    } catch (error) {
      setCatalogNotice({ sku, text: error.message, error: true })
    } finally {
      setCatalogBusy('')
    }
  }

  async function saveAllChanges() {
    if (catalogBusy) return
    const pending = adminCatalog.filter((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false, priceMode: 'auto' }; return draft.price !== (item.price == null ? '' : String(item.price)) || (draft.enabled === true) !== (item.enabled === true) })
    if (pending.length === 0) return
    setBatchNotice('')
    let saved = 0
    for (const item of pending) {
      const draft = catalogDrafts[item.sku]
      const price = Number(draft.price)
      if (!Number.isSafeInteger(price) || price < 1) { setCatalogNotice({ sku: item.sku, text: 'Harga jual harus berupa angka bulat minimal 1.', error: true }); continue }
      setCatalogBusy(item.sku)
      try {
        const data = await request(`/api/admin/products/${encodeURIComponent(item.sku)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ price, enabled: draft.enabled, priceMode: draft.priceMode === 'manual' ? 'manual' : 'auto' }) })
        const product = data.product
        setAdminCatalog((items) => items.map((current) => current.sku === item.sku ? { ...current, ...product } : current))
        setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { price: product.price == null ? '' : String(product.price), enabled: product.enabled === true, priceMode: product.priceMode === 'manual' ? 'manual' : 'auto' } }))
        saved += 1
      } catch (error) {
        setCatalogNotice({ sku: item.sku, text: error.message, error: true })
      }
    }
    setCatalogBusy('')
    setBatchNotice(saved === pending.length ? `${saved} harga tersimpan.` : `${saved} dari ${pending.length} harga tersimpan; sisanya gagal, lihat kartunya.`)
    showToast(saved === pending.length ? 'ok' : 'error', saved === pending.length ? `${saved} harga tersimpan` : 'Sebagian harga gagal disimpan', saved === pending.length ? 'Harga baru langsung digunakan pada katalog pembeli.' : `${saved} dari ${pending.length} tersimpan. Cek kartu yang bertanda merah.`)
    loadProducts()
  }

  function toggleGroup(items, nextEnabled) {
    if (catalogBusy) return
    const updated = { ...catalogDrafts }
    let changed = 0
    let skipped = 0
    for (const item of items) {
      const draft = updated[item.sku] || { price: '', enabled: false }
      const price = Number(draft.price)
      const priceOk = Number.isSafeInteger(price) && price >= 1 && price <= 100000000
      if (nextEnabled) {
        if (!item.supported || item.missing === true || !priceOk) { skipped += 1; continue }
        if (draft.enabled === true) continue
        updated[item.sku] = { ...draft, enabled: true }
        changed += 1
      } else {
        if (draft.enabled !== true) continue
        if (!priceOk) { skipped += 1; continue }
        updated[item.sku] = { ...draft, enabled: false }
        changed += 1
      }
    }
    if (changed === 0 && skipped === 0) { setBatchNotice('Tidak ada perubahan.'); return }
    setCatalogDrafts(updated)
    const reason = nextEnabled ? 'isi harga jual terlebih dahulu atau belum didukung checkout' : 'harga jualnya belum lengkap'
    if (changed === 0) { setBatchNotice(`Tidak ada yang berubah. ${skipped} produk dilewati: ${reason}.`); return }
    setBatchNotice(`${changed} produk ${nextEnabled ? 'ditampilkan' : 'disembunyikan'}.${skipped > 0 ? ` ${skipped} dilewati: ${reason}.` : ''}`)
  }

    function applyBrandMargin(brand) {
    if (catalogBusy) return
    const pct = Number(marginDrafts[brand.name])
    if (!Number.isFinite(pct) || pct <= 0) { setBatchNotice(`Isi persen margin ${brand.name} terlebih dahulu, lalu klik Terapkan.`); return }
    if (pct > 500) { setBatchNotice('Margin maksimal 500%.'); return }
    const updates = {}
    let skipped = 0
    for (const item of brand.items) {
      const saran = suggestPrice(item.cost, item.category, pct)
      if (saran == null) { skipped += 1; continue }
      updates[item.sku] = String(saran)
    }
    const applied = Object.keys(updates).length
    if (applied === 0) { setBatchNotice(`Tidak ada SKU ${brand.name} dengan modal di katalog aktif.`); return }
    setCatalogDrafts((drafts) => {
      const next = { ...drafts }
      for (const sku of Object.keys(updates)) next[sku] = { ...(drafts[sku] || { price: '', enabled: false, priceMode: 'auto' }), price: updates[sku] }
      return next
    })
    setBatchNotice(`${applied} harga draft ${brand.name} terisi${skipped > 0 ? `; ${skipped} SKU tanpa modal dilewati` : ''}. Klik "Simpan semua perubahan" untuk menerapkan.`)
    showToast('ok', `${applied} harga draft terisi`, `${brand.name}: harga masih draf. Klik "Simpan semua" agar tersimpan permanen.`)
  }

const games = [...new Set(products.map((item) => item.game).filter(Boolean))]
  const catalogTypes = catalogTypesFor(products)
  const activeType = catalogTypes.find((type) => type.id === category) || CATALOG_TYPES[0]
  const typeTabs = catalogTypes
  const activeBrands = [...new Set(products.filter((item) => catalogTypeOf(item, catalogTypes).id === activeType.id).map((item) => item.game).filter(Boolean))]
  const searchCatalogs = catalogSearch.trim() ? games.filter((name) => products.some((item) => item.game === name && matchesCatalog(item, catalogSearch))) : []
  const accountName = session?.user.user_metadata?.name || session?.user.user_metadata?.full_name || session?.user.user_metadata?.username || session?.user.email?.split('@')[0] || 'Akun'
  const accountInitial = String(accountName).trim().charAt(0).toLocaleUpperCase('id-ID') || 'A'
  const filtered = products.filter((item) => item.game === game)
  const selected = products.find((item) => item.id === checkoutId) || null
  const gameAktif = game || (selected ? selected.game : '')
  const orderItems = view === 'checkout' ? (selected ? products.filter((item) => item.game === selected.game) : []) : filtered
  // ponytail: nominal di halaman pembeli dikelompokkan per jenis (diamond biasa, weekly pass, bundle) supaya tidak perlu menyisir daftar panjang.
  const orderKinds = groupByKind([...orderItems].sort((a, b) => a.price - b.price))
  const orderFormat = selected?.format || orderItems[0]?.format || 'plain'
  const orderType = catalogTypeOf(selected || orderItems[0] || {}, catalogTypes)

  const checkRunRef = useRef(0)

  useEffect(() => {
    checkRunRef.current += 1
    setCheckState('idle'); setCheckResult(null); setCheckError('')
  }, [userId, zoneId, selected?.id])

  // ponytail: cek nickname tidak pernah memblokir checkout; gagal ditampilkan apa adanya.
  async function checkNickname(force) {
    if (!selected || selected.checkable !== true || !checkAvailable || checkState === 'loading') return
    const id = userId.trim()
    const zone = zoneId.trim()
    const valid = orderFormat === 'plain' ? /^[0-9]{1,32}$/.test(id) : /^[0-9]{1,32}$/.test(id) && /^[0-9]{1,20}$/.test(zone)
    if (!valid) {
      setCheckState('error')
      setCheckError(orderFormat === 'plain' ? 'Isi User ID berupa angka terlebih dahulu.' : 'Isi User ID dan Zone ID berupa angka terlebih dahulu.')
      return
    }
    const run = checkRunRef.current + 1
    checkRunRef.current = run
    setCheckState('loading')
    setCheckError('')
    try {
      if (!supabase || !session) throw new Error('Masuk ke akun Anda terlebih dahulu untuk memakai fitur periksa nickname.')
      const data = await request('/api/check-account', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(orderFormat === 'plain' ? { productId: selected.id, userId: id, force: force === true } : { productId: selected.id, userId: id, zoneId: zone, force: force === true }),
      })
      if (run !== checkRunRef.current) return
      if (!data.check?.nickname) throw new Error('Respons cek tidak valid.')
      setCheckResult(data.check)
      setCheckState('done')
    } catch (error) {
      if (run !== checkRunRef.current) return
      setCheckError(error.message)
      setCheckState('error')
    }
  }

  function openCatalog(name) {
    setSearchOpen(false)
    setCatalogSearch('')
    go(`/game/${encodeURIComponent(name)}`)
  }
  const pricingQuery = catalogQuery.trim().toLowerCase()
  const pricingItems = adminCatalog.filter((item) => (catalogShowUnsupported || item.supported) && (catalogFilter === 'semua' || Boolean((catalogDrafts[item.sku] || {}).enabled) === (catalogFilter === 'tampil')) && (!pricingQuery || [item.name, item.sku, item.game, item.category].some((value) => String(value || '').toLowerCase().includes(pricingQuery))))
  const pricingGroups = (() => {
    const categories = new Map()
    for (const item of pricingItems) {
      const categoryName = item.category || 'Lainnya'
      const brandName = item.game || 'Lainnya'
      if (!categories.has(categoryName)) categories.set(categoryName, { name: categoryName, items: [], brands: new Map() })
      const category = categories.get(categoryName)
      category.items.push(item)
      if (!category.brands.has(brandName)) category.brands.set(brandName, { name: brandName, items: [] })
      category.brands.get(brandName).items.push(item)
    }
    // ponytail: di dalam satu brand masih ada jenis berbeda (diamond biasa, weekly pass, bundle), dipisah agar harga mudah dibandingkan.
    return [...categories.values()].map((category) => ({
      ...category,
      brands: [...category.brands.values()].map((brand) => {
        const items = [...brand.items].sort((a, b) => (a.cost ?? Number.MAX_SAFE_INTEGER) - (b.cost ?? Number.MAX_SAFE_INTEGER))
        return { ...brand, items, kinds: groupByKind(items) }
      }),
    }))
  })()
  const pricingDirty = adminCatalog.filter((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false, priceMode: 'auto' }; return draft.price !== (item.price == null ? '' : String(item.price)) || (draft.enabled === true) !== (item.enabled === true) }).length

  // ponytail: turunan untuk halaman invoice - detail bayar, hitung mundur, dan tahapan status.
  const invoiceDetail = receipt?.paymentDetail || null
  const invoiceRemaining = receipt?.paymentExpiresAt ? Math.max(0, new Date(receipt.paymentExpiresAt).getTime() - clock) : 0
  const invoiceRemainingLabel = (() => {
    if (!invoiceRemaining) return ''
    const total = Math.floor(invoiceRemaining / 1000)
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    return [hours ? `${hours} jam` : '', hours || minutes ? `${minutes} menit` : '', `${total % 60} detik`].filter(Boolean).join(' ')
  })()
  const invoiceSteps = (() => {
    const status = receipt?.status || 'pending'
    const paid = ['payment_paid', 'fulfillment_pending', 'fulfilled', 'fulfillment_failed', 'manual_review', 'refunded'].includes(status)
    const processing = ['fulfillment_pending', 'fulfillment_failed', 'manual_review'].includes(status)
    return [
      { key: 'created', label: 'Pesanan dibuat', hint: 'Data pesanan sudah tercatat.', state: 'done' },
      { key: 'payment', label: 'Pembayaran', hint: status === 'payment_failed' ? 'Pembayaran gagal atau kedaluwarsa.' : paid ? 'Pembayaran diterima.' : 'Selesaikan pembayaran sesuai instruksi di atas.', state: status === 'payment_failed' ? 'failed' : paid ? 'done' : 'active' },
      { key: 'process', label: 'Diproses otomatis', hint: status === 'refunded' ? 'Pesanan tidak dapat diproses. Dana dikembalikan.' : status === 'fulfilled' ? 'Pesanan telah dikirim ke akun Anda.' : processing ? 'Pesanan sedang dikirim otomatis ke penyedia.' : 'Menunggu pembayaran.', state: status === 'refunded' || status === 'fulfillment_failed' ? 'failed' : status === 'fulfilled' ? 'done' : processing ? 'active' : 'idle' },
      { key: 'done', label: status === 'refunded' ? 'Dana dikembalikan' : 'Selesai', hint: status === 'refunded' ? 'Dana dikembalikan penuh ke metode pembayaran awal.' : 'Terima kasih atas pembelian Anda di Melonbyte.', state: status === 'fulfilled' || status === 'refunded' ? 'done' : 'idle' },
    ]
  })()

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Lewati navigasi</a>
      {toast && <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
        <span className="toast-icon" aria-hidden="true">{toast.tone === 'ok' ? '✓' : toast.tone === 'error' ? '!' : 'i'}</span>
        <div className="toast-body"><strong>{toast.title}</strong>{toast.body ? <p>{toast.body}</p> : null}</div>
        <button type="button" className="toast-close" onClick={closeToast} aria-label="Tutup pemberitahuan">✕</button>
      </div>}
      <header className="site-header">
        <div className="wrap header-inner">
          <a className="wordmark" href="/" aria-label="Melonbyte, kembali ke awal"><span>melon</span>byte<span className="wordmark-dot">.</span></a>
          <form className="home-search" role="search" ref={searchBoxRef} onSubmit={(event) => { event.preventDefault(); const first = searchCatalogs[0]; if (first) openCatalog(first); else if (catalogSearch.trim()) setSearchOpen(true); else document.getElementById('katalog')?.scrollIntoView({ behavior: 'smooth' }) }}>
            <div className="home-search-controls"><input id="home-catalog-search" type="search" aria-label="Cari di katalog" autoComplete="off" aria-autocomplete="list" aria-expanded={searchOpen && Boolean(catalogSearch.trim())} aria-controls="home-search-suggest" value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setSearchOpen(true) }} onFocus={() => { if (catalogSearch.trim()) setSearchOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Cari di katalog" /><button type="submit">Cari</button>{searchOpen && catalogSearch.trim() && <div className="search-suggest" id="home-search-suggest">{searchCatalogs.length === 0 ? <p className="suggest-empty" role="status">Layanan tidak ditemukan. Coba kata lain.</p> : searchCatalogs.map((name) => <button key={name} type="button" onClick={() => openCatalog(name)}>{brandLogo(name) ? <span className={`suggest-art${brandLogo(name).cover ? ' suggest-art-foto' : ''}`} style={{ background: brandLogo(name).bg }} aria-hidden="true"><img src={brandLogo(name).src} alt="" loading="lazy" decoding="async" style={brandLogo(name).cover ? { objectFit: 'cover' } : brandLogo(name).invert ? { filter: 'brightness(0) invert(1)' } : undefined} /></span> : <span className="game-initial" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span>}<span className="suggest-text"><strong>{name}</strong><small>{products.filter((item) => item.game === name).length} nominal</small></span></button>)}</div>}</div>
          </form>
          <nav aria-label="Navigasi utama">
            <a href="/katalog">Katalog</a>
            {canManage && <a href="/admin" aria-current={view === 'admin' ? 'page' : undefined}>Admin</a>}
            {session ? <a className="account-avatar" href="/akun" aria-label={`Akun ${accountName}`} title={accountName} aria-current={view === 'account' ? 'page' : undefined}>{accountInitial}</a> : <>
              <a href="/akun" aria-current={view === 'account' ? 'page' : undefined}>Masuk</a>
              <a href="/daftar" aria-current={view === 'register' ? 'page' : undefined}>Daftar</a>
            </>}
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        {view === 'terms' || view === 'privacy' || view === 'contact' ? <LegalPage view={view} info={contactInfo} state={contactState} /> : view === 'home' ? <>
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> MELONBYTE / LAYANAN DIGITAL</p>
            <h1 id="hero-title">Top up game dan layanan digital, <br /><em>langsung diproses otomatis.</em></h1>
            <p className="hero-description">Cari layanan digital di katalog. Harga dan ketersediaan mengikuti produk yang aktif.</p>
            <a className="primary-link" href="/katalog">Lihat katalog layanan <span aria-hidden="true">↗</span></a>
          </div>
          <div className="hero-graphic" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <span className="graphic-text">m<span className="graphic-dot">.</span></span>
            <span className="graphic-caption">GAME / PULSA / E-MONEY / TAGIHAN</span>
          </div>
        </section>

        <section className="shop-section" id="katalog" aria-labelledby="catalog-title">
          <div className="wrap shop-inner">
            <div className="section-heading"><div><h2 id="catalog-title">Katalog</h2></div><p>Pilih kategori dan layanan yang Anda butuhkan.</p></div>
            {canManage && <div className="admin-price-view" role="group" aria-label="Tampilan harga katalog">
              <span className="admin-price-view-label">Tampilan harga</span>
              <button type="button" className={hargaView === 'admin' ? 'active' : ''} aria-pressed={hargaView === 'admin'} onClick={() => setHargaView('admin')}>Katalog admin</button>
              <button type="button" className={hargaView === 'user' ? 'active' : ''} aria-pressed={hargaView === 'user'} onClick={() => setHargaView('user')}>Katalog user</button>
            </div>}
            {canManage && hargaView === 'user' && <p className="admin-price-note" role="status">Mode lihat harga user: checkout tetap memakai harga modal admin.</p>}

            <div className="category-filter" role="group" aria-label="Kategori katalog">
              {typeTabs.map((type) => <button key={type.id} type="button" className={activeType.id === type.id ? 'active' : ''} aria-pressed={activeType.id === type.id} onClick={() => { setCategory(type.id); setCatalogSearch('') }}>{type.label}</button>)}
            </div>
            {catalogState === 'loading' && <div className="notice" role="status">Memuat katalog...</div>}
            {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum dapat dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
            {catalogState === 'ready' && (activeBrands.length === 0 ? <div className="notice" role="status"><strong>{activeType.label} belum tersedia.</strong><p>Belum ada layanan aktif dalam kategori ini. Periksa kembali nanti.</p></div> : <div className="game-grid poster-grid">{activeBrands.map((item) => { const logo = brandLogo(item); return <button key={item} type="button" className="game-card poster" style={{ '--brand': brandWarna(item) || '#3d5a35', '--brand-dark': brandGelap(item) || '#22331d' }} onClick={() => { go(`/game/${encodeURIComponent(item)}`) }}><span className="poster-art" aria-hidden="true">{logo ? <><img className="poster-blur" src={logo.src} alt="" loading="lazy" decoding="async" />{logo.cover ? <img className="poster-img poster-img-foto" src={logo.src} alt="" loading="lazy" decoding="async" /> : <span className="poster-chip"><img className="poster-img" src={logo.src} alt="" loading="lazy" decoding="async" /></span>}</> : <span className="poster-initial">{String(item).slice(0, 2).toUpperCase()}</span>}</span><span className="poster-text"><strong>{item}</strong><span className="poster-hint">Lihat nominal <span aria-hidden="true">›</span></span></span></button> })}</div>)}
          </div>
        </section>

        </> : view === 'game' || view === 'checkout' ? <section className="checkout-section wrap" id={view === 'game' ? 'game-detail' : 'data-akun'} aria-labelledby="order-title">
          <div className={`section-heading brand-head${view === 'checkout' ? ' brand-head-kecil' : ''}`}><div><a className="back-button" href={view === 'game' ? '/katalog' : selected ? `/game/${encodeURIComponent(selected.game)}` : '/katalog'}>‹ {view === 'game' ? 'Semua layanan' : 'Kembali'}</a><div className="brand-banner" style={{ '--brand': brandWarna(gameAktif) || '#3d5a35', '--brand-dark': brandGelap(gameAktif) || '#22331d' }}><div className="brand-ident">{brandLogo(gameAktif) ? <span className={`brand-art${brandLogo(gameAktif).cover ? ' brand-art-foto' : ''}`} style={{ background: brandLogo(gameAktif).bg }}><img src={brandLogo(gameAktif).src} alt="" decoding="async" style={brandLogo(gameAktif).cover ? { objectFit: 'cover' } : brandLogo(gameAktif).invert ? { filter: 'brightness(0) invert(1)' } : undefined} /></span> : null}<div className="brand-copy"><h2 id="order-title">{gameAktif || 'Checkout'}</h2>{view === 'checkout' && <p>Periksa pesanan, lalu lanjut ke pembayaran.</p>}</div></div>{view === 'game' ? <p className={`brand-stat${ratingRingkas && ratingRingkas.count > 0 ? '' : ' brand-stat-kosong'}`}>{ratingRingkas && ratingRingkas.count > 0 ? <><strong>★ {String(ratingRingkas.average ?? 0).replace('.', ',')}</strong><span>{ratingRingkas.count} penilaian</span></> : <><strong aria-hidden="true">★</strong><span>belum ada penilaian</span></>}</p> : null}</div></div></div>
          {catalogState === 'loading' && <div className="notice" role="status">Memuat produk...</div>}
          {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum dapat dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
          {catalogState === 'ready' && view === 'game' && filtered.length === 0 && <div className="notice" role="status"><strong>Belum ada nominal aktif.</strong><p>Produk baru tampil setelah harga dan stok dikonfigurasi. Checkout belum tersedia.</p></div>}
          {catalogState === 'ready' && view === 'checkout' && !selected && <div className="notice" role="status"><strong>Produk tidak ditemukan.</strong><p>Produk mungkin sudah tidak aktif. Pilih lagi dari katalog.</p><p><a href="/katalog">Kembali ke katalog</a></p></div>}
          {catalogState === 'ready' && view === 'game' && filtered.length > 0 && allOutage(filtered) && <div className="notice notice-warn" role="status"><strong>Semua nominal layanan ini sedang gangguan.</strong><p>Penyedia layanan sedang mengalami kendala. Coba layanan lain, atau kembali lagi nanti.</p></div>}
          {catalogState === 'ready' && view === 'checkout' && selected && isOutage(selected) && <div className="notice notice-warn" role="status"><strong>Nominal ini sedang gangguan.</strong><p>{OUTAGE_NOTE}</p></div>}
          {catalogState === 'ready' && (view === 'game' ? filtered.length > 0 : selected) && <div className="checkout-layout">
            <form className="checkout-form order-form" onSubmit={openConfirm}>
              <ol className="order-steps">
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">1</span><h3>{orderType.targetTitle}</h3></div>
                  <div className="field-row"><label>{orderFormat === 'riot' ? 'Riot ID' : orderType.targetLabel} <input value={userId} onChange={(event) => setUserId(event.target.value)} required maxLength={orderFormat === 'riot' ? '40' : '32'} inputMode={orderFormat === 'riot' ? 'text' : 'numeric'} pattern={orderFormat === 'riot' ? '[A-Za-z0-9# ._-]+' : '[0-9]+'} placeholder={orderFormat === 'riot' ? 'Nama#1234' : orderType.targetPlaceholder} autoComplete="off" /></label>{orderFormat === 'ml_concat' && <label>Zone ID <input value={zoneId} onChange={(event) => setZoneId(event.target.value)} required maxLength="20" inputMode="numeric" pattern="[0-9]+" placeholder="Zone ID" autoComplete="off" /></label>}{orderFormat === 'uid_server' && <div className="field-block"><span className="field-block-label">Server</span><PilihanServer nilai={zoneId} onPilih={setZoneId} /></div>}</div>
                  <p className="field-hint">{orderFormat === 'plain' ? orderType.targetHint : orderFormat === 'ml_concat' ? 'User ID dan Zone ID berupa angka. Jangan memasukkan kata sandi.' : orderFormat === 'riot' ? 'Tulis Riot ID lengkap, contoh: NamaAnda#1234.' : 'Pilih server yang sama dengan akun game. Jangan memasukkan kata sandi.'}</p>
                  {selected?.checkable && (
                    <div className="check-block">
                      {checkState === 'done' && checkResult ? (
                        <p className="check-result" role="status">Nickname: <strong>{checkResult.nickname}</strong>{checkResult.region ? ` · Region ${checkResult.region}` : ''} <span className="check-note">{checkResult.cached ? 'hasil tersimpan' : 'baru diperiksa'}</span></p>
                      ) : (
                        <button type="button" className="check-button" onClick={() => checkNickname(false)} disabled={!checkAvailable || checkState === 'loading'}>{checkState === 'loading' ? 'Memeriksa...' : 'Periksa nickname'}</button>
                      )}
                      {checkState === 'done' && <button type="button" className="check-again-button" onClick={() => checkNickname(true)} disabled={!checkAvailable || checkState === 'loading'}>Periksa ulang</button>}
                      {checkState === 'error' && <p className="check-error" role="alert">{checkError}</p>}
                      {!checkAvailable && <p className="field-hint">Periksa nickname belum tersedia saat ini.</p>}
                    </div>
                  )}
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">2</span><h3>Pilih nominal</h3></div>
                  {orderKinds.map((kind) => <Fragment key={kind.name}>{orderKinds.length > 1 && <p className="product-kind">{kind.name}<small className="product-kind-count">{kind.items.length} nominal</small></p>}<div className="product-grid">{kind.items.map((item) => <button key={item.id} type="button" className={isOutage(item) ? 'product is-outage' : item.id === selected?.id ? 'product selected' : 'product'} aria-current={item.id === selected?.id ? 'true' : undefined} disabled={isOutage(item)} title={isOutage(item) ? OUTAGE_NOTE : undefined} onClick={() => { go(`/beli/${encodeURIComponent(item.id)}`) }}><strong>{namaSingkat(item)}</strong>{isOutage(item) && <span className="product-flag">Gangguan</span>}<span className="product-bottom"><span className="product-price">{rupiah(item.price)}</span></span></button>)}</div></Fragment>)}
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">3</span><h3>Jumlah pembelian</h3><span className="step-tag">Terkunci</span></div>
                  <p className="qty-fixed" aria-label="Jumlah pembelian 1 item"><strong>1</strong><span>item</span></p>
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">4</span><h3>Metode pembayaran</h3></div>
                  <div className="pay-options" role="radiogroup" aria-label="Metode pembayaran">{availablePaymentMethods(PAYMENT_METHODS, selected ? selected.price - voucherCut() : 0).map((method, index, options) => <Fragment key={method.id}>{index === 0 || options[index - 1].group !== method.group ? <p className="pay-group">{method.group}</p> : null}<label className={paymentMethod === method.id ? 'pay-option active' : 'pay-option'}><input type="radio" name="payment" value={method.id} checked={paymentMethod === method.id} onChange={() => setPaymentMethod(method.id)} autoComplete="off" /><span><strong>{method.label}</strong><small>{method.note}</small></span></label></Fragment>)}</div>{availablePaymentMethods(PAYMENT_METHODS, selected ? selected.price - voucherCut() : 0).length < PAYMENT_METHODS.length && <p className="pay-note">Virtual Account &amp; Mandiri Bill tersedia untuk pesanan mulai {rupiah(VA_MIN_ORDER)}.</p>}
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">5</span><h3>Kode promo</h3>{voucherCut() > 0 && <span className="step-tag">Terpakai</span>}</div>
                  <label>Kode promo <input id="voucher-code" value={promoCode} onChange={(event) => { setPromoCode(event.target.value.toUpperCase()); setVoucher(null); setVoucherNotice('') }} maxLength="24" placeholder="Masukkan kode promo" autoComplete="off" /></label>
                  <button type="button" className="secondary-button" onClick={applyVoucher} disabled={voucherBusy || !promoCode.trim()}>{voucherBusy ? 'Memeriksa...' : 'Gunakan'}</button>
                  {voucherNotice && <p className="voucher-notice" role="alert">{voucherNotice}</p>}
                  {voucherCut() > 0 && <p className="field-hint">Potongan {voucher.code} sebesar {rupiah(voucherCut())} sudah masuk ke total.</p>}
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">6</span><h3>Detail kontak</h3></div>
                  <div className="field-row"><label><span className="field-label">Email</span><input value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} type="email" maxLength="120" autoComplete="off" placeholder="nama@email.com" aria-describedby="kontak-bisa-diubah" /></label><label><span className="field-label">Nomor HP</span><input value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} type="tel" maxLength="20" inputMode="tel" autoComplete="off" placeholder="08..." aria-describedby="kontak-bisa-diubah" /></label></div>
                  <p className="field-hint" id="kontak-bisa-diubah">{session ? 'Terisi dari profil akun.' : 'Masuk ke akun untuk menyelesaikan pesanan.'}</p>
                </li>
              </ol>
              {!checkoutAvailable && <p className="field-hint" role="status">Checkout belum tersedia. Coba lagi nanti.</p>}
              {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
              <button className="checkout-button" type="submit" disabled={!checkoutAvailable || !selected || !session || checkoutState === 'loading'}>{checkoutState === 'loading' ? 'Membuat pesanan...' : 'Buat pesanan'}</button>
            </form>
            {confirmOpen && <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && checkoutState !== 'loading') setConfirmOpen(false) }}>
              <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-desc">
                <div className="confirm-head"><h2 id="confirm-title">Buat pesanan</h2><button type="button" className="confirm-close" onClick={() => setConfirmOpen(false)} disabled={checkoutState === 'loading'} aria-label="Tutup konfirmasi">×</button></div>
                <p id="confirm-desc">Periksa kembali. Pesanan baru dibuat setelah Anda menekan Pesan sekarang.</p>
                <dl className="confirm-rows">
                  <div><dt>Produk</dt><dd>{selected?.name}</dd></div>
                  <div><dt>{orderFormat === 'riot' ? 'Riot ID' : orderType.targetLabel}</dt><dd>{userId}{orderFormat === 'ml_concat' && zoneId ? ` (${zoneId})` : ''}</dd></div>
                  {selected?.checkable && <div><dt>Nickname</dt><dd>{checkResult ? checkResult.nickname : 'belum diperiksa'}</dd></div>}
                  <div><dt>Metode pembayaran</dt><dd>{PAYMENT_METHODS.find((method) => method.id === activePaymentMethod(selected ? selected.price - voucherCut() : 0))?.label}</dd></div>
                  {voucherCut() > 0 && <div><dt>Harga</dt><dd>{rupiah(selected?.price || 0)}</dd></div>}
                  {voucherCut() > 0 && <div><dt>Potongan {voucher.code}</dt><dd>−{rupiah(voucherCut())}</dd></div>}
                  <div><dt>Total</dt><dd><strong>{rupiah((selected?.price || 0) - voucherCut())}</strong></dd></div>
                </dl>
                <label className="confirm-terms"><input type="checkbox" checked={termsOk} onChange={(event) => setTermsOk(event.target.checked)} autoComplete="off" /> Data di atas sudah benar dan pesanan dapat diproses otomatis.</label>
                {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                <div className="confirm-actions">
                  <button type="button" className="secondary-button" onClick={() => setConfirmOpen(false)} disabled={checkoutState === 'loading'}>Batal</button>
                  <button type="button" className="checkout-button" onClick={checkout} disabled={!termsOk || checkoutState === 'loading'}>{checkoutState === 'loading' ? 'Membuat pesanan...' : 'Pesan sekarang'}</button>
                </div>
              </div>
            </div>}
            <aside className="summary" aria-label="Ringkasan pesanan"><p className="eyebrow">RINGKASAN</p>{selected ? <><div className="summary-item"><span>{selected.game}</span><strong>{selected.name}</strong></div><div className="summary-total"><span>Harga</span><strong>{rupiah(selected.price)}</strong></div><div className="summary-total"><span>Jumlah</span><strong>1 item</strong></div>{voucherCut() > 0 && <div className="summary-total summary-cut"><span>Potongan {voucher.code}</span><strong>−{rupiah(voucherCut())}</strong></div>}<div className="summary-total"><span>Total</span><strong>{rupiah(selected.price - voucherCut())}</strong></div>{canManage && <p className="summary-inclusive" role="status">Harga modal admin: tanpa margin.</p>}<p className="summary-inclusive">Harga sudah termasuk biaya pembayaran.</p></> : <p>Belum ada item produk yang dipilih.</p>}</aside>
          </div>}
        </section> : view === 'receipt' ? <div className="invoice-page wrap" id="struk">
          <div className="invoice-head">
            <div><a className="back-button" href="/akun">‹ Semua pesanan</a><h1>Invoice <span className="invoice-code">#{(receipt?.id || receiptId || '').slice(0, 8)}</span></h1>{receipt?.createdAt && <p className="invoice-meta">Dibuat {labelTanggalJam(receipt.createdAt)}</p>}</div>
            {receipt && <span className={`receipt-status status-${receipt.status}`}>{statusLabel(receipt.status)}</span>}
          </div>
          {!session ? <div className="notice" role="status"><p>Masuk untuk membuka invoice ini.</p><a className="secondary-button" href="/akun">Masuk</a></div> : receiptState === 'error' ? <p role="alert">Gagal memuat invoice. {receiptError} <button type="button" onClick={() => setReceiptRetry((value) => value + 1)}>Coba lagi</button> <a href="/akun">Kembali ke akun</a></p> : !receipt ? <p role="status">Memuat invoice...</p> : <>
            <section className={`invoice-banner banner-${receipt.status}`} aria-label="Status pesanan">
              <div><h2>{statusLabel(receipt.status)}</h2>{statusHint(receipt.status) && <p>{statusHint(receipt.status)}</p>}</div>
              {receipt.status === 'pending' && receipt.paymentExpiresAt && <p className="invoice-timer">{invoiceRemaining > 0 ? <>Sisa waktu bayar <strong>{invoiceRemainingLabel}</strong></> : 'Waktu pembayaran habis. Buat pesanan baru untuk mencoba kembali.'}</p>}
            </section>
            {receipt.status === 'pending' && <section className="invoice-pay" aria-labelledby="invoice-pay-title">
              <h2 id="invoice-pay-title">Selesaikan pembayaran</h2>
              {invoiceDetail?.qrUrl ? <div className="pay-qr">
                <img src={invoiceDetail.qrUrl} alt="Kode QR pembayaran" width="240" height="240" />
                <div><p>Pindai kode QR ini dari aplikasi bank atau e-wallet, lalu bayar tepat <strong>{rupiah(receipt.price)}</strong>.</p>{invoiceDetail.deeplink && <a className="secondary-button" href={invoiceDetail.deeplink}>Buka aplikasi pembayaran</a>}</div>
              </div> : invoiceDetail?.vaNumber ? <div className="pay-va">
                <p>Transfer ke nomor Virtual Account berikut, lalu bayar tepat <strong>{rupiah(receipt.price)}</strong>.</p>
                <p className="pay-number"><span>{invoiceDetail.vaNumber}</span><button type="button" className="copy-button" onClick={() => copyText(invoiceDetail.vaNumber)}>{copied === invoiceDetail.vaNumber ? 'Tersalin' : 'Salin'}</button></p>
                <p className="field-hint">Bank {VA_BANKS[invoiceDetail.bank] || invoiceDetail.bank}.</p>
              </div> : invoiceDetail?.billKey ? <div className="pay-va">
                <p>Bayar melalui Mandiri Bill Payment, lalu bayar tepat <strong>{rupiah(receipt.price)}</strong>.</p>
                <p className="pay-number"><span>Kode bayar {invoiceDetail.billerCode} · {invoiceDetail.billKey}</span><button type="button" className="copy-button" onClick={() => copyText(invoiceDetail.billKey)}>{copied === invoiceDetail.billKey ? 'Tersalin' : 'Salin'}</button></p>
              </div> : receipt.redirectUrl ? <div className="pay-legacy">
                <p>Lanjutkan pembayaran di halaman berikut.</p><a className="checkout-button" href={receipt.redirectUrl}>Buka halaman pembayaran</a>
              </div> : <p className="field-hint" role="status">Instruksi pembayaran belum tersedia. Muat ulang halaman ini.</p>}
            </section>}
            <section className="invoice-progress" aria-labelledby="invoice-progress-title">
              <h2 id="invoice-progress-title">Progres pesanan</h2>
              <ol className="progress-steps">{invoiceSteps.map((step) => <li key={step.key} className={`progress-step is-${step.state}`}><span className="progress-marker" aria-hidden="true">{step.state === 'done' ? '✓' : ''}</span><div><strong>{step.label}</strong><small>{step.hint}</small></div></li>)}</ol>
            </section>
            <section className="invoice-details" aria-labelledby="invoice-detail-title">
              <h2 id="invoice-detail-title">Detail pesanan</h2>
              <dl className="receipt-rows">
                <div><dt>Produk</dt><dd>{receipt.productName}</dd></div>
                <div><dt>User ID</dt><dd>{receipt.userId}{receipt.zoneId ? ` (${receipt.zoneId})` : ''}</dd></div>
                <div><dt>Metode pembayaran</dt><dd>{PAYMENT_METHODS.find((method) => method.id === receipt.paymentChannel)?.label || 'Belum dipilih'}</dd></div>{receipt.status === 'pending' && receipt.paymentExpiresAt && <div><dt>Batas pembayaran</dt><dd>{labelTanggalJam(receipt.paymentExpiresAt)}</dd></div>}
                {Number(receipt.discount) > 0 && <div><dt>Harga</dt><dd>{rupiah(Number(receipt.price) + Number(receipt.discount))}</dd></div>}
                {Number(receipt.discount) > 0 && <div><dt>Potongan{receipt.voucherCode ? ` ${receipt.voucherCode}` : ''}</dt><dd>−{rupiah(receipt.discount)}</dd></div>}
                <div><dt>Total</dt><dd><strong>{rupiah(receipt.price)}</strong></dd></div>
                {receipt.sn && <div><dt>Nomor seri</dt><dd>{receipt.sn}</dd></div>}
                {receipt.refundNote && <div><dt>Refund</dt><dd>{receipt.refundNote}</dd></div>}
                {receipt.fulfillmentNote && (receipt.status === 'fulfillment_failed' || receipt.status === 'manual_review') && <div><dt>Catatan</dt><dd>{receipt.fulfillmentNote}</dd></div>}
                <div><dt>ID pesanan</dt><dd>#{receipt.id}</dd></div>
              </dl>
            </section>
            {receipt.status === 'fulfilled' && <section className="invoice-rating" aria-labelledby="invoice-rating-title">
              <h2 id="invoice-rating-title">Penilaian pesanan</h2>
              {ratingState === 'saved' ? <><p className="rating-thanks" role="status">Terima kasih. Penilaian Anda sudah tersimpan.</p><button type="button" className="rating-ubah" onClick={() => setRatingState('idle')}>Ubah penilaian</button></> : <>
                <div className="rating-stars" role="radiogroup" aria-label="Jumlah bintang">
                  {[1, 2, 3, 4, 5].map((nilai) => <button key={nilai} type="button" role="radio" aria-checked={ratingScore === nilai} aria-label={`${nilai} bintang`} className={`rating-star${nilai <= ratingScore ? ' is-aktif' : ''}`} onClick={() => setRatingScore(nilai)}>★</button>)}
                </div>
                <label className="rating-note"><span>Catatan (opsional)</span><textarea value={ratingNote} onChange={(event) => setRatingNote(event.target.value)} maxLength={500} rows={3} placeholder="Tulis pengalaman Anda" autoComplete="off" /></label>
                {ratingError && <p className="form-error" role="alert">{ratingError}</p>}
                <button type="button" className="secondary-button" onClick={kirimPenilaian} disabled={ratingState === 'sending'}>{ratingState === 'sending' ? 'Mengirim...' : 'Kirim penilaian'}</button>
              </>}
            </section>}
            <p className="receipt-links"><a href="/katalog">Belanja lagi</a><a href="/akun">Semua pesanan</a></p>
          </>}
        </div> : view === 'notfound' ? (
          <section className="account-page wrap" id="tidak-ditemukan">
            <h1>Halaman tidak ditemukan</h1>
            <p className="auth-lead">Alamat yang Anda buka tidak tersedia atau sudah dipindahkan. Periksa kembali tautannya, atau mulai dari katalog.</p>
            <p><a className="primary-button" href="/katalog">Buka katalog</a></p>
          </section>
) : <div className={view === 'admin' ? 'admin-page wrap' : 'account-page wrap'} id={view === 'admin' ? 'admin' : 'akun'}>
          {view === 'admin' ? <>
            <div className="admin-heading"><div><h1>Panel admin</h1><p>Kelola pesanan toko dan harga produk.</p></div><a className="secondary-button" href="/katalog">Lihat toko</a></div>
            {canManage && <nav className="admin-nav" aria-label="Navigasi admin">
              <a href="/admin/ringkasan" aria-current={adminPage === 'summary' ? 'page' : undefined}>Ringkasan</a><a href="/admin" aria-current={adminPage === 'transactions' ? 'page' : undefined}>Transaksi</a>
              <a href="/admin/produk" aria-current={adminPage === 'products' ? 'page' : undefined}>Produk &amp; harga</a><a href="/admin/voucher" aria-current={adminPage === 'vouchers' ? 'page' : undefined}>Voucher</a><a href="/admin/refund" aria-current={adminPage === 'refunds' ? 'page' : undefined}>Refund</a>
            </nav>}
            {!session ? <div className="notice" role="status"><p>Masuk dengan akun admin untuk mengelola toko.</p><a className="secondary-button" href="/akun">Masuk</a></div> : roleState === 'ready' && !canManage ? <div className="notice" role="status"><p>Halaman ini khusus admin toko.</p><a className="secondary-button" href="/akun">Kembali ke akun</a></div> : null}
          </> : <h1>{view === 'register' && !session ? 'Daftar akun' : 'Akun saya'}</h1>}
          {view !== 'admin' && <>
          <section className="account-section" aria-labelledby="account-title">
            <div className={session ? 'account-layout account-wide' : 'account-layout account-auth'}>
              {session && <div>
                <h2 id="account-title">Profil akun</h2>
                <p>Pesanan yang Anda buat tersimpan di akun ini.</p>
              </div>}
              <div className={session ? 'order-panel' : 'order-panel auth-panel'}>
                {!session && <>
                  <h2 id="account-title">{view === 'register' ? 'Agar pesanan Anda mudah diperiksa.' : 'Masuk ke akun'}</h2>
                  <p className="auth-lead">{view === 'register' ? 'Daftar dengan email, kata sandi, nomor HP, dan username.' : 'Masuk dengan email atau nomor HP dan kata sandi.'}</p>
                </>}
                {!supabase ? <p role={authConfigError ? 'alert' : 'status'}>{authConfigError ? 'Konfigurasi login salah. Gunakan publishable/anon key Supabase; secret/service_role tidak boleh dipakai browser.' : 'Akun belum aktif. Pemilik toko perlu menambahkan konfigurasi Supabase.'}</p> : session ? <>
                  {session.user.email ? <><div className="profile-cols">
                    <div className="profile-col">
                      <form className="profile-form" onSubmit={saveProfile}>
                        <p className="form-title">Ubah profil</p>
                        <div className="profile-field"><label htmlFor="profile-name">Nama</label><input id="profile-name" type="text" autoComplete="off" maxLength="40" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Nama Anda" /></div>
                        <div className="profile-field"><label htmlFor="profile-username">Username</label><input id="profile-username" type="text" autoComplete="off" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="username Anda" /></div>
                        <div className="profile-field"><label htmlFor="profile-email">Email<span className="field-badge"><IkonGembok />Terkunci</span></label><input id="profile-email" type="email" value={session.user.email} readOnly aria-describedby="profile-email-hint" /><small className="field-hint" id="profile-email-hint">Email dipakai untuk verifikasi dan tidak dapat diubah sendiri.</small></div>
                        <div className="profile-field"><label htmlFor="profile-phone">Nomor HP</label><input id="profile-phone" type="tel" autoComplete="off" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." /></div>
                        <button type="submit" className="secondary-button" disabled={profileState === 'loading'}>{profileState === 'loading' ? 'Menyimpan...' : 'Ubah profil'}</button>
                      </form>
                      {session.user.phone_confirmed_at ? <p role="status">Nomor HP terverifikasi: {session.user.phone}</p> : session.user.user_metadata?.requested_phone ? <p role="status">Nomor HP ini dapat dipakai untuk masuk bersama kata sandi; kode verifikasi tetap dikirim melalui email.</p> : null}
                      {phoneMessage && <p role={profileState === 'error' ? 'alert' : 'status'}>{phoneMessage}</p>}
                    </div>
                    <div className="profile-col">
                      <form className="profile-form password-form" onSubmit={savePassword}>
                        <p className="form-title">Ubah kata sandi</p>
                        <p className="form-note">Pastikan Anda mengingat kata sandi baru.</p>
                        <div className="profile-field"><label htmlFor="account-current-password">Kata sandi saat ini</label><input id="account-current-password" type="password" autoComplete="current-password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} placeholder="Kata sandi saat ini (jika sudah ada)" /></div>
                        <div className="profile-field"><label htmlFor="account-password">Kata sandi baru</label><input id="account-password" type="password" autoComplete="new-password" minLength="6" required value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} placeholder="minimal 6 karakter" /></div>
                        <div className="profile-field"><label htmlFor="account-password-confirm">Konfirmasi kata sandi baru</label><input id="account-password-confirm" type="password" autoComplete="new-password" minLength="6" required value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="ulangi kata sandi baru" /></div>
                        <button type="submit" className="secondary-button" disabled={passwordState === 'loading'}>{passwordState === 'loading' ? 'Menyimpan...' : 'Ubah kata sandi'}</button>
                      </form>
                      {passwordMessage && <p role={passwordState === 'error' ? 'alert' : 'status'}>{passwordMessage}</p>}
                      <div className="two-step-zone">
                        <p className="form-title">Verifikasi 2 langkah</p>
                        <p className="form-note">Jika aktif, login dengan kata sandi akan meminta kode dari email. Login Google langsung masuk karena telah diverifikasi Google.</p>
                        {twoStepNext === null ? <button type="button" className="secondary-button" onClick={requestTwoStepChange} disabled={twoStepState === 'loading'} aria-pressed={twoStepOn}>{twoStepState === 'loading' ? 'Mengirim kode...' : twoStepOn ? 'Matikan verifikasi 2 langkah' : 'Nyalakan verifikasi 2 langkah'}</button> : <form className="code-form" onSubmit={verifyTwoStepCode}>
                          <label htmlFor="two-step-code">Kode konfirmasi dari email</label>
                          <div className="order-input"><input id="two-step-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength="10" required value={twoStepCode} onChange={(event) => setTwoStepCode(event.target.value.replace(/\D/g, ''))} placeholder="kode dari email" /><button type="submit" disabled={twoStepState === 'loading'}>Konfirmasi</button></div>
                          <div className="code-actions">
                            <button type="button" className="link-button" onClick={resendTwoStepCode} disabled={twoStepState === 'loading' || resendWait > 0}>{resendWait > 0 ? `Kirim ulang kode (${resendWait}s)` : 'Kirim ulang kode'}</button>
                            <button type="button" className="link-button" onClick={cancelTwoStepChange} disabled={twoStepState === 'loading'}>Batal</button>
                          </div>
                        </form>}
                        {twoStepMessage && <p role={twoStepState === 'error' ? 'alert' : 'status'}>{twoStepMessage}</p>}
                      </div>
                    </div>
                  </div><div className="signout-zone"><p className="signout-hint">Anda dapat masuk kembali kapan saja dengan email dan kata sandi.</p>{signOutButton}</div>{deletionBlock}</> : <><p>Masuk sebagai <strong>{session.user.phone}</strong></p>{signOutButton}{deletionBlock}</>}
                </> : view === 'register' ? <>
                  <form className="profile-form" onSubmit={register}>
                    <div className="auth-fields">
                    <div className="profile-field"><label htmlFor="register-email">Email</label><input id="register-email" type="email" autoComplete="off" required value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} placeholder="email@contoh.com" /></div>
                    <div className="profile-field"><label htmlFor="register-password">Kata sandi</label><input id="register-password" type="password" autoComplete="new-password" minLength="6" required value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} placeholder="minimal 6 karakter" /></div>
                    <div className="profile-field"><label htmlFor="register-phone">Nomor HP</label><input id="register-phone" type="tel" autoComplete="off" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." /></div>
                    <div className="profile-field"><label htmlFor="register-username">Username</label><input id="register-username" type="text" autoComplete="off" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="3-24 huruf, angka, atau _" /></div>
                    </div>
                    <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Memproses...' : 'Daftar akun'}</button>
                  </form>
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  {emailCodeForm}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Daftar dengan Google</button>
                </> : <>
                  <form className="profile-form" onSubmit={signIn}>
                    <div className="profile-field">
                      <label htmlFor="contact">Email atau nomor HP</label>
                      <input id="contact" type="text" autoComplete="off" value={contact} onChange={(event) => { setContact(event.target.value); setLoginMessage(''); setLoginState('idle') }} placeholder="email@contoh.com atau 08..." required />
                    </div>
                    <div className="profile-field"><label htmlFor="login-password">Kata sandi</label><input id="login-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="Kata sandi akun Anda" /></div>
                    <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Memproses...' : 'Masuk'}</button>
                  </form>
                  {contactIdentity.email && <button type="button" className="link-button" onClick={sendEmailLink} disabled={loginState === 'loading'}>Masuk tanpa kata sandi (kirim kode ke email)</button>}
                  {emailCodeForm}
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Masuk atau daftar dengan Google</button>

                </>}
              </div>
              {!session && <aside className="auth-aside">
                <p className="form-title">{view === 'register' ? 'Sudah punya akun?' : 'Belum punya akun?'}</p>
                <p className="form-note">{view === 'register' ? 'Masuk dengan email atau nomor HP dan kata sandi.' : 'Daftar dengan email, kata sandi, nomor HP, dan username.'}</p>
                <a className="secondary-button" href={view === 'register' ? '/akun' : '/daftar'}>{view === 'register' ? 'Masuk' : 'Daftar akun'}</a>
              </aside>}
            </div>
          </section>
          {session && <section className="order-section" aria-labelledby="order-title"><div className="order-layout"><div><h2 id="order-title">Riwayat pesanan</h2><p>Klik pesanan untuk membuka invoice dan status terbarunya. Jangan membayar ulang sebelum memeriksa status.</p></div><div className="order-panel">{ordersState === 'loading' ? <p role="status">Memuat pesanan...</p> : ordersState === 'error' ? <p role="alert">Gagal memuat pesanan. {ordersError} <button type="button" onClick={() => setOrdersRetry((value) => value + 1)}>Coba lagi</button></p> : orders.length === 0 ? <p role="status">Belum ada pesanan di akun ini. <a href="/katalog">Lihat katalog</a></p> : <ul className="order-list">{orders.map((order) => <li key={order.id}><a href={`/struk/${encodeURIComponent(order.id)}`}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {statusLabel(order.status)}</span><small>{[tanggalWib(order.createdAt, true), `#${order.id}`].filter(Boolean).join(' · ')}</small></a></li>)}</ul>}</div></div></section>}
          </>}
          {view === 'admin' && session && roleState === 'loading' && <p role="status">Memeriksa akses akun...</p>}
          {view === 'admin' && session && roleState === 'error' && <p role="alert">Akses pengelola belum dapat diperiksa. {roleError} <button type="button" onClick={() => setRoleRetry((value) => value + 1)}>Coba lagi</button></p>}
          {view === 'admin' && canManage && adminPage === 'vouchers' && <section className="order-section admin-section" aria-labelledby="voucher-title"><div className="section-heading"><div><h2 id="voucher-title">Voucher</h2></div><p>Kuota, masa berlaku, dan batas per akun dijaga oleh server. Voucher pembeli baru tidak dapat dipakai oleh akun yang sudah pernah membeli.</p></div><div className="voucher-admin"><form className="voucher-form" onSubmit={createVoucher}>
  <div className="voucher-form-head"><div><h3>Buat voucher baru</h3><p>Potongan bernilai tetap. Server memeriksa kuota, masa berlaku, dan batas akun saat checkout.</p></div></div>
  <div className="voucher-fields">
    <label className="voucher-field"><span>Kode voucher</span><input type="text" autoComplete="off" maxLength="24" placeholder="TEMAN1K" value={voucherDraft.code} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, code: event.target.value.toUpperCase() }))} /><small>Tanpa spasi, otomatis huruf kapital.</small></label>
    <label className="voucher-field"><span>Potongan (Rp)</span><input type="number" inputMode="numeric" min="1" autoComplete="off" value={voucherDraft.value} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, value: event.target.value }))} /><small>Nominal tetap, bukan persentase.</small></label>
    <label className="voucher-field"><span>Minimum belanja (Rp)</span><input type="number" inputMode="numeric" min="0" autoComplete="off" value={voucherDraft.minOrder} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, minOrder: event.target.value }))} /><small>Dihitung dari harga sebelum potongan.</small></label>
    <label className="voucher-field"><span>Kuota pemakaian</span><input type="number" inputMode="numeric" min="1" autoComplete="off" value={voucherDraft.quota} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, quota: event.target.value }))} /><small>Kosongkan untuk tanpa batas.</small></label>
    <label className="voucher-field"><span>Batas per akun</span><input type="number" inputMode="numeric" min="1" autoComplete="off" value={voucherDraft.perUser} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, perUser: event.target.value }))} /><small>Jumlah pemakaian oleh satu akun.</small></label>
    <label className="voucher-field"><span>Berlaku (hari)</span><input type="number" inputMode="numeric" min="1" max="365" autoComplete="off" value={voucherDraft.days} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, days: event.target.value }))} /><small>Dihitung sejak voucher dibuat.</small></label>
  </div>
  <label className="voucher-new"><input type="checkbox" autoComplete="off" checked={voucherDraft.newBuyersOnly} onChange={(event) => setVoucherDraft((draft) => ({ ...draft, newBuyersOnly: event.target.checked }))} /><span><strong>Khusus pembeli baru</strong><small>Hanya berlaku untuk akun yang belum pernah menyelesaikan pembelian.</small></span></label>
  <div className="voucher-form-foot">
    <p className="voucher-preview">{`Potongan ${rupiah(Number(voucherDraft.value) || 0)} untuk belanja minimum ${rupiah(Number(voucherDraft.minOrder) || 0)}. ${voucherDraft.quota === '' ? 'Tanpa batas kuota' : `Kuota ${voucherDraft.quota} pemakaian`}, ${voucherDraft.perUser || 1} kali per akun, berlaku ${voucherDraft.days || 1} hari.`}</p>
    <button type="submit" disabled={voucherBusy}>{voucherBusy ? 'Menyimpan...' : 'Simpan voucher'}</button>
  </div>
</form>{voucherAdminNotice && <p className="voucher-form-notice" role="status">{voucherAdminNotice}</p>}<ul className="voucher-list">{adminVouchers.length === 0 ? <li>Belum ada voucher.</li> : adminVouchers.map((item) => <li key={item.code}>
<div className="voucher-item-info"><strong>{item.code}</strong><span>{rupiah(item.value)} · min {rupiah(item.minOrder)} · dipakai {item.used}/{item.quota ?? '∞'}</span><small>{item.newBuyersOnly ? 'khusus pembeli baru · ' : ''}{item.active ? 'aktif' : 'nonaktif'}{item.endsAt ? ` · sampai ${new Date(item.endsAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}` : ''}</small></div>
<button type="button" className="secondary-button" onClick={() => toggleVoucher(item)}>{item.active ? 'Matikan' : 'Nyalakan'}</button>
</li>)}</ul></div></section>}
          {view === 'admin' && canManage && adminPage === 'refunds' && <section className="order-section admin-section" aria-labelledby="refund-title"><div className="section-heading"><div><h2 id="refund-title">Refund</h2></div><p>Pesanan yang dananya sudah masuk tetapi itemnya belum terkirim. Refund otomatis melalui Midtrans, atau tandai manual jika dana dikembalikan sendiri.</p></div>{adminRefundsState === 'loading' ? <p role="status">Memuat daftar refund...</p> : adminRefundsState === 'error' ? <p role="alert">Gagal memuat daftar refund. {adminRefundsError} <button type="button" onClick={() => setAdminRefundsRetry((value) => value + 1)}>Coba lagi</button></p> : <>{adminRefunds.orders.length === 0 ? <p role="status">Tidak ada pesanan yang menunggu refund.</p> : <ul className="refund-list">{adminRefunds.orders.map((order) => <li key={order.id} className="refund-card"><div className="refund-info"><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.userId}{order.zoneId ? ` (${order.zoneId})` : ''}</span><small>#{order.id} · {statusLabel(order.status)}{order.fulfillmentNote ? ` · ${order.fulfillmentNote}` : ''}</small></div><div className="refund-actions"><button type="button" className="secondary-button" onClick={() => processRefund(order, false)} disabled={Boolean(refundBusy)}>{refundBusy === order.id ? 'Memproses...' : 'Refund melalui Midtrans'}</button><button type="button" className="secondary-button" onClick={() => processRefund(order, true)} disabled={Boolean(refundBusy)}>Tandai manual</button></div>{refundNotice.id === order.id && <p className={refundNotice.error ? 'price-hint refund-error' : 'price-hint'} role={refundNotice.error ? 'alert' : 'status'}>{refundNotice.text}</p>}</li>)}</ul>}{adminRefunds.refunded.length > 0 && <div className="refund-done"><h3>Sudah direfund</h3><ul className="order-list">{adminRefunds.refunded.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.refundNote || 'refund'}</span><small>#{order.id}{order.refundedAt ? ` · ${new Date(order.refundedAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}{order.refundedBy ? ` · oleh ${order.refundedBy}` : ''}</small></li>)}</ul></div>}</>}</section>}
          {view === 'admin' && canManage && adminPage === 'summary' && <section className="order-section admin-section sales-dashboard" aria-labelledby="sales-title"><div className="section-heading"><div><h2 id="sales-title">Ringkasan penjualan</h2><p>{adminSales?.environment === 'production' ? 'Data pembayaran dari lingkungan produksi.' : 'Lingkungan sandbox. Angka di bawah bukan penjualan nyata.'}</p></div><div className="sales-controls"><div className="sales-range" role="group" aria-label="Rentang ringkasan"><button type="button" aria-pressed={adminSalesDays === 7} onClick={() => setAdminSalesDays(7)}>7 hari</button><button type="button" aria-pressed={adminSalesDays === 30} onClick={() => setAdminSalesDays(30)}>30 hari</button></div><button type="button" className="secondary-button" onClick={() => setAdminSalesRetry((value) => value + 1)} disabled={adminSalesState === 'loading'}>Perbarui</button></div></div>{adminSalesState === 'loading' ? <p role="status">Memuat ringkasan pembayaran...</p> : adminSalesState === 'error' ? <p role="alert">Ringkasan belum dapat dimuat. {adminSalesError} <button type="button" onClick={() => setAdminSalesRetry((value) => value + 1)}>Coba lagi</button></p> : adminSalesState === 'ready' && adminSales ? <><div className="sales-metrics"><article className="sales-metric"><span>Pendapatan bersih</span><strong>{rupiah(salesTotals.paid - salesTotals.refunded)}</strong><small>Pembayaran terverifikasi dikurangi refund</small></article><article className="sales-metric"><span>Pembayaran terverifikasi</span><strong>{salesTotals.paidCount}</strong><small>{rupiah(salesTotals.paid)} diterima pada periode ini</small></article><article className="sales-metric"><span>Perlu pemenuhan</span><strong>{adminSales.pendingFulfillment}</strong><small>Pesanan dibayar, belum selesai</small></article><article className="sales-metric"><span>Refund</span><strong>{salesTotals.refundCount}</strong><small>{rupiah(salesTotals.refunded)} dikembalikan pada periode ini</small></article></div><p className="sales-pending">Pembayaran menunggu: <strong>{adminSales.pendingPayments}</strong>. Pembayaran ini tidak masuk pendapatan.</p>{adminSales.daily.length === 0 ? <p role="status">Belum ada data pembayaran terverifikasi pada periode ini.</p> : <div className="sales-charts"><section className="sales-chart" aria-labelledby="sales-revenue-title"><h3 id="sales-revenue-title">Pembayaran dan refund harian</h3><p>Nominal dalam rupiah. Refund ditampilkan pada tanggal dana dikembalikan.</p><div className="sales-legend"><span><i className="sales-legend-paid" />Pembayaran</span><span><i className="sales-legend-refund" />Refund</span></div><div className="sales-bars-scroll"><div className="sales-bars" style={{ minWidth: adminSalesDays === 30 ? '660px' : '100%' }} role="list" aria-label="Grafik pembayaran dan refund harian">{adminSales.daily.map((day) => <div className="sales-day" key={day.date} role="listitem" aria-label={`${day.date}: pembayaran ${rupiah(day.paid)}, refund ${rupiah(day.refunded)}`}><div className="sales-day-bars"><span className="sales-bar sales-bar-paid" style={{ height: `${Math.max(day.paid ? 3 : 0, day.paid / salesRevenueMax * 100)}%` }} /><span className="sales-bar sales-bar-refund" style={{ height: `${Math.max(day.refunded ? 3 : 0, day.refunded / salesRevenueMax * 100)}%` }} /></div><small>{new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(`${day.date}T12:00:00+07:00`))}</small></div>)}</div></div></section><section className="sales-chart" aria-labelledby="sales-count-title"><h3 id="sales-count-title">Jumlah pembayaran per hari</h3><p>Jumlah transaksi ditampilkan terpisah dari nominal.</p><div className="sales-bars-scroll"><div className="sales-bars sales-count-bars" style={{ minWidth: adminSalesDays === 30 ? '660px' : '100%' }} role="list" aria-label="Grafik jumlah pembayaran per hari">{adminSales.daily.map((day) => <div className="sales-day" key={day.date} role="listitem" aria-label={`${day.date}: ${day.paidCount} pembayaran`}><div className="sales-day-bars"><span className="sales-bar sales-bar-count" style={{ height: `${Math.max(day.paidCount ? 3 : 0, day.paidCount / salesCountMax * 100)}%` }} /></div><small>{new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(`${day.date}T12:00:00+07:00`))}</small></div>)}</div></div></section></div>}<p className="sales-footnote">Periode dihitung berdasarkan waktu pembayaran terverifikasi, bukan waktu pesanan dibuat. Data lama tanpa catatan waktu bayar tidak disertakan.</p></> : null}</section>}
          {view === 'admin' && canManage && adminPage === 'transactions' && <section className="order-section admin-section" aria-labelledby="admin-title"><div className="order-layout"><div><h2 id="admin-title">Transaksi</h2><p>Pesanan terbaru toko, dari seluruh pembeli.</p></div><div className="order-panel">{adminState === 'loading' ? <p role="status">Memuat pesanan toko...</p> : adminState === 'error' ? <p role="alert">Gagal memuat pesanan toko. {adminError} <button type="button" onClick={() => setAdminRetry((value) => value + 1)}>Coba lagi</button></p> : adminOrders.length === 0 ? <p role="status">Belum ada pesanan toko.</p> : <ul className="order-list">{adminOrders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {statusLabel(order.status)}</span><small>{[tanggalWib(order.createdAt, true), `#${order.id}`].filter(Boolean).join(' · ')}</small>{(order.contactEmail || order.contactPhone) && <small className="order-contact">{order.contactEmail}{order.contactEmail && order.contactPhone ? ' · ' : ''}{order.contactPhone && <a href={`https://wa.me/${order.contactPhone.replace(/[^0-9]/g, '').replace(/^0/, '62')}`} target="_blank" rel="noreferrer">{order.contactPhone}</a>}</small>}</li>)}</ul>}</div></div></section>}
          {view === 'admin' && canManage && adminPage === 'products' && <section className="order-section admin-section" aria-labelledby="pricing-title"><div className="section-heading"><div><h2 id="pricing-title">Harga jual</h2></div><p>Harga supplier adalah modal dan tidak ditampilkan ke pembeli. Simpan harga jual sebelum menampilkan produk.</p></div><div className="catalog-sync"><span className="catalog-sync-state">{adminCatalogFetchedAt ? `Katalog supplier · sinkron ${new Date(adminCatalogFetchedAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Katalog supplier belum disinkronkan.'}</span><button type="button" className="secondary-button" onClick={syncCatalog} disabled={catalogSyncing}>{catalogSyncing ? 'Menyinkron...' : 'Perbarui katalog'}</button></div>{catalogSyncNotice && <p className="catalog-sync-notice" role="status">{catalogSyncNotice}</p>}<div className="catalog-sync"><span className="catalog-sync-state">Gambar game diambil dari App Store Indonesia. Perbarui bila ada kolaborasi atau ulang tahun baru.</span><button type="button" className="secondary-button" onClick={refreshGameImages} disabled={gambarBusy}>{gambarBusy ? 'Memperbarui...' : 'Perbarui gambar game'}</button></div>{gambarNotice && <p className="catalog-sync-notice" role="status">{gambarNotice}</p>}{adminCatalogState === 'loading' ? <p role="status">Memuat katalog supplier...</p> : adminCatalogState === 'error' ? <p role="alert">Katalog supplier belum dapat dimuat. {adminCatalogError} <button type="button" onClick={() => setAdminCatalogRetry((value) => value + 1)}>Coba lagi</button></p> : adminCatalog.length === 0 ? <p role="status">Katalog supplier kosong. Tekan Perbarui katalog.</p> : <><div className="pricing-toolbar"><input type="text" aria-label="Cari produk supplier" placeholder="Cari nama, kode, atau brand" autoComplete="off" value={catalogQuery} onChange={(event) => { setCatalogQuery(event.target.value) }} /><div className="category-filter" role="group" aria-label="Saring produk"><button type="button" className={catalogFilter === 'semua' ? 'active' : ''} aria-pressed={catalogFilter === 'semua'} onClick={() => { setCatalogFilter('semua') }}>Semua</button><button type="button" className={catalogFilter === 'tampil' ? 'active' : ''} aria-pressed={catalogFilter === 'tampil'} onClick={() => { setCatalogFilter('tampil') }}>Tampil</button><button type="button" className={catalogFilter === 'draf' ? 'active' : ''} aria-pressed={catalogFilter === 'draf'} onClick={() => { setCatalogFilter('draf') }}>Draf</button></div></div><div className="pricing-meta"><div className="pricing-meta-actions">{adminCatalogStale && <span className="pricing-stale" role="status">Katalog sudah lama tidak disinkronkan.</span>}{batchNotice && <span role="status">{batchNotice}</span>}<label className="pricing-unsupported"><input type="checkbox" checked={catalogShowUnsupported} onChange={(event) => { setCatalogShowUnsupported(event.target.checked) }} />Tampilkan yang belum didukung checkout</label><button type="button" className="secondary-button" onClick={exportCatalogCsv}>Ekspor CSV</button><label className="secondary-button csv-import">Impor CSV<input type="file" accept=".csv,text/csv" autoComplete="off" onChange={importCatalogCsv} /></label>{pricingDirty > 0 && <button type="button" className="secondary-button" onClick={saveAllChanges} disabled={Boolean(catalogBusy)}>Simpan semua ({pricingDirty})</button>}</div></div>{pricingItems.length === 0 ? <p className="pricing-empty" role="status">Tidak ada produk yang cocok. Ubah kata kunci atau penyaring.</p> : <><div className="price-groups">{pricingGroups.map((category) => { const categoryShown = category.items.filter((item) => (catalogDrafts[item.sku] || {}).enabled === true).length; return <section key={category.name} className="price-group"><label className="switch price-category-switch" title={`Aktifkan atau nonaktifkan semua produk kategori ${category.name}`}><input type="checkbox" role="switch" checked={categoryShown === category.items.length} ref={(el) => { if (el) el.indeterminate = categoryShown > 0 && categoryShown < category.items.length }} aria-label={`Tampilkan semua produk kategori ${category.name}`} onChange={(event) => toggleGroup(category.items, event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label><details className="price-category" open={Boolean(catalogQuery.trim())}><summary className="price-cat-head"><h3 className="price-cat-title">{category.name}<small className="price-group-count">{category.items.length} produk · {categoryShown} tampil</small></h3></summary>{category.brands.map((brand) => { const brandShown = brand.items.filter((item) => (catalogDrafts[item.sku] || {}).enabled === true).length; return <div key={brand.name} className="price-brand"><label className="switch price-brand-switch" title={`Aktifkan atau nonaktifkan semua produk ${brand.name}`}><input type="checkbox" role="switch" checked={brandShown === brand.items.length} ref={(el) => { if (el) el.indeterminate = brandShown > 0 && brandShown < brand.items.length }} aria-label={`Tampilkan semua produk ${brand.name}`} onChange={(event) => toggleGroup(brand.items, event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label><details className="price-brand-details" open={Boolean(catalogQuery.trim())}><summary className="price-brand-head"><span className="price-brand-cover"><GameCover name={brand.name} /></span><h4 className="price-brand-title">{brand.name}<small className="price-group-count">{brand.items.length} produk · {brandShown} tampil</small></h4></summary><div className="price-margin"><label className="price-margin-field"><span>Margin</span><input type="number" inputMode="decimal" min="0" max="500" step="0.5" placeholder="8" autoComplete="off" aria-label={`Margin harga ${brand.name} (%)`} value={marginDrafts[brand.name] || ''} onChange={(event) => setMarginDrafts((drafts) => ({ ...drafts, [brand.name]: event.target.value }))} /><span>%</span></label><button type="button" className="secondary-button" onClick={() => applyBrandMargin(brand)} disabled={Boolean(catalogBusy)}>Terapkan</button><span className="price-margin-hint">Modal × (1 + %), sudah termasuk biaya QRIS, dibulatkan ke atas.</span></div>{brand.kinds.map((kind) => <div key={kind.name} className="price-kind">{brand.kinds.length > 1 && <h5 className="price-kind-head">{kind.name}<small className="price-group-count">{kind.items.length} produk</small></h5>}<ul className="price-grid">{kind.items.map((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false, priceMode: 'auto' }; const health = priceHealth(draft.price, item.cost, item.category); const saran = suggestPrice(item.cost, item.category); return <li key={item.sku} className="price-card"><div className="price-head"><strong>{item.name || item.sku}</strong>{item.gangguan === true ? <span className="product-flag">Gangguan</span> : null}<small>{item.game || item.sku}{item.variant ? ` · ${item.variant}` : ''}{item.category ? ` · ${item.category}` : ''}</small></div><div className="price-row"><span className="price-cost">{item.cost == null ? 'Tidak ada di katalog supplier aktif.' : `Modal ${rupiah(item.cost)}`}</span><label className="price-toggle"><input type="checkbox" checked={draft.enabled} disabled={!item.supported} aria-label={`Tampil di katalog: ${item.name || item.sku}`} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, enabled: event.target.checked } }))} />Tampil</label></div><div className="price-row price-actions"><input type="number" inputMode="numeric" min="1" step="1" placeholder="Harga jual (Rp)" autoComplete="off" aria-label={`Harga jual ${item.name || item.sku}`} value={draft.price} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, price: event.target.value } }))} onKeyDown={(event) => { if (event.key === 'Enter') saveSellingPrice(item.sku) }} /><button type="button" className="secondary-button" onClick={() => saveSellingPrice(item.sku)} disabled={Boolean(catalogBusy)}>{catalogBusy === item.sku ? 'Menyimpan...' : 'Simpan'}</button><button type="button" className={item.gangguan === true ? 'secondary-button outage-on' : 'secondary-button'} onClick={() => toggleOutage(item)} disabled={Boolean(outageBusy)}>{outageBusy === item.sku ? 'Menyimpan...' : item.gangguan === true ? 'Gangguan aktif' : 'Tandai gangguan'}</button><label className="price-mode" title="Otomatis: harga mengikuti aturan modal dan biaya pada setiap sinkron katalog. Manual: harga dikunci."><input type="checkbox" autoComplete="off" aria-label={`Kunci harga manual: ${item.name || item.sku}`} checked={draft.priceMode === 'manual'} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, priceMode: event.target.checked ? 'manual' : 'auto' } }))} />Kunci manual</label></div>{!item.supported && <p className="price-hint">Belum didukung checkout, sehingga belum dapat ditampilkan.</p>}{item.cost != null && health && <p className={`price-warning price-health-${health.level}`} role="status">{health.level === 'rugi' ? `Rugi ${rupiah(Math.abs(health.netRp))} setelah biaya QRIS.` : health.level === 'tipis' ? `Margin tipis: sisa ${rupiah(health.netRp)} (${health.marginPct}%).` : `Margin aman: sisa ${rupiah(health.netRp)} (${health.marginPct}%).`}{health.level !== 'rugi' && !health.vaSafe ? ' Belum cukup untuk biaya VA.' : ''}</p>}{item.cost != null && saran != null && <p className="price-suggest-row"><button type="button" className="secondary-button" onClick={() => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, price: String(saran) } }))}>Gunakan saran {rupiah(saran)}</button><span className="price-suggest-note">target margin {marginBand(item.category, Number(item.cost) || 0).pct}%</span></p>}{catalogNotice.sku === item.sku && <p className="price-hint" role={catalogNotice.error ? 'alert' : 'status'}>{catalogNotice.text}</p>}</li>; })}</ul></div>)}</details></div>; })}</details></section>; })}</div></>}</>}</section>}
        </div>}
      </main>
      <footer className="footer">
        <div className="wrap footer-main">
          <div className="footer-brand">
            <a className="wordmark" href="/" aria-label="Melonbyte, beranda"><span>melon</span>byte<span className="wordmark-dot">.</span></a>
            <p>Layanan digital otomatis: game, pulsa, e-money, dan tagihan. Harga dan ketersediaan mengikuti katalog aktif.</p>
          </div>
          <nav className="footer-nav" aria-label="Tautan footer">
            <div className="footer-col"><h2 className="footer-heading">Layanan</h2><a href="/katalog">Katalog</a><a href="/akun">Akun</a></div>
            <div className="footer-col"><h2 className="footer-heading">Informasi</h2>{LEGAL_LINKS.map((link) => <a key={link.path} href={link.path}>{link.label}</a>)}</div>
          </nav>
        </div>
        <div className="wrap footer-bottom">
          <div className="footer-legal">
            <p>© {new Date().getFullYear()} Melonbyte. Seluruh hak cipta dilindungi.</p>
            <p className="footer-note">Nama, logo, dan gambar layanan adalah milik pemiliknya masing-masing. Melonbyte tidak berafiliasi resmi dengan penerbit game, operator seluler, atau penyedia dompet digital.</p>
          </div>
          <button type="button" className="footer-top" onClick={() => { window.scrollTo({ top: 0 }); document.getElementById('main')?.focus({ preventScroll: true }) }}>Kembali ke atas <span aria-hidden="true">↑</span></button>
        </div>
      </footer>
    </div>
  )
}

export default App
