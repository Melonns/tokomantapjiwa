import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { parseContact, parseRegistration, tryParseContact } from './contact.mjs'
import { matchesCatalog } from './catalog.mjs'
import { authReturnFromUrl, restoreSession } from './auth.mjs'
import { clearSessionStart, readSessionStart, seedSessionStart, sessionExpired, writeSessionStart } from './session.mjs'
import { authErrorMessage } from './auth-errors.mjs'
import { clearPendingCode, readPendingCode, writePendingCode } from './pending-code.mjs'
import { isPublicSupabaseKey } from './public-key.mjs'
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

// Blueprint metode bayar: satu tempat untuk diubah sesuai kanal Midtrans yang aktif nanti.
const PAYMENT_METHODS = [
  { id: 'qris', label: 'QRIS', note: 'Scan dari aplikasi bank atau e-wallet' },
  { id: 'va', label: 'Transfer bank / VA', note: 'Nomor virtual account per pesanan' },
  { id: 'ewallet', label: 'E-wallet', note: 'GoPay, OVO, DANA, ShopeePay' },
]
const MAX_ITEM_QTY = 10

// ponytail: Token server Hoyo mengikuti petunjuk seller "[UID]|[Server]" di deskripsi SKU.
const uidServerOptions = [
  { value: 'os_asia', label: 'Asia' },
  { value: 'os_usa', label: 'Amerika' },
  { value: 'os_euro', label: 'Eropa' },
  { value: 'os_cht', label: 'TW, HK, MO' },
]

// ponytail: Tipe katalog storefront. Kategori mengikuti kolom category dari data supplier (mirror);
// tab + salinan teks ditulis di sini biar gampang diubah saat kategori baru muncul.
const CATALOG_TYPES = [
  { id: 'game', label: 'Game', categories: ['Games'], targetTitle: 'Kredensial akun tujuan', targetLabel: 'User ID', targetHint: 'User ID numerik. Jangan masukkan password game.', targetPlaceholder: 'ID akun game' },
  { id: 'pulsa', label: 'Pulsa & Data', categories: ['Pulsa', 'Data', 'Masa Aktif', 'Paket SMS & Telpon', 'Aktivasi Voucher', 'Aktivasi Perdana'], targetTitle: 'Nomor tujuan', targetLabel: 'Nomor HP', targetHint: 'Nomor HP tujuan yang aktif. Jangan masukkan PIN atau kode OTP.', targetPlaceholder: '08xxxxxxxxxx' },
  { id: 'ewallet', label: 'E-Money', categories: ['E-Money'], targetTitle: 'Nomor akun tujuan', targetLabel: 'Nomor HP', targetHint: 'Nomor HP yang terdaftar pada akun e-money tujuan.', targetPlaceholder: '08xxxxxxxxxx' },
  { id: 'hiburan', label: 'Hiburan', categories: ['TV'], targetTitle: 'Nomor pelanggan', targetLabel: 'Nomor pelanggan', targetHint: 'Nomor pelanggan atau smart card layanan TV berlangganan.', targetPlaceholder: 'Nomor smart card' },
  { id: 'tagihan', label: 'Tagihan', categories: ['PLN'], targetTitle: 'Nomor pelanggan', targetLabel: 'Nomor meter / ID pelanggan', targetHint: 'Nomor meter atau ID pelanggan dari tagihan.', targetPlaceholder: 'Nomor meter' },
]
const OTHER_CATALOG_TYPE = { id: 'lainnya', label: 'Lainnya', categories: [], targetTitle: 'ID tujuan', targetLabel: 'ID tujuan', targetHint: 'Isi ID atau nomor tujuan sesuai layanan.', targetPlaceholder: 'ID tujuan' }
const ALL_CATALOG_TYPES = [...CATALOG_TYPES, OTHER_CATALOG_TYPE]
const catalogTypeOf = (item) => CATALOG_TYPES.find((type) => type.categories.includes(item && item.category)) || OTHER_CATALOG_TYPE

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Server belum bisa dihubungi. Coba lagi nanti.')
  return payload
}

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('Sesi login habis. Masuk lagi untuk lanjut.')
  return { Authorization: `Bearer ${data.session.access_token}` }
}

function routeFromHash() {
  const hash = window.location.hash
  if (hash === '#daftar') return { view: 'register', game: null, checkoutId: '' }
  if (hash === '#akun') return { view: 'account', game: null, checkoutId: '' }
  if (hash === '#admin' || hash === '#admin/produk') return { view: 'admin', adminPage: hash === '#admin/produk' ? 'products' : 'transactions', game: null, checkoutId: '' }
  if (hash.startsWith('#game/')) return { view: 'game', game: decodeHash(hash.slice(6)), checkoutId: '' }
  if (hash.startsWith('#beli/')) return { view: 'checkout', game: null, checkoutId: decodeHash(hash.slice(6)) }
  return { view: 'home', game: null, checkoutId: '' }
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

function App() {
  const [products, setProducts] = useState([])
  const [checkoutAvailable, setCheckoutAvailable] = useState(false)
  const [checkAvailable, setCheckAvailable] = useState(false)
  const [checkState, setCheckState] = useState('idle')
  const [checkResult, setCheckResult] = useState(null)
  const [checkError, setCheckError] = useState('')
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogError, setCatalogError] = useState('')
  const [game, setGame] = useState(() => routeFromHash().game)
  const [category, setCategory] = useState('game')
  const [view, setView] = useState(() => routeFromHash().view)
  const [adminPage, setAdminPage] = useState(() => routeFromHash().adminPage || 'transactions')
  const [checkoutId, setCheckoutId] = useState(() => routeFromHash().checkoutId)

  const [catalogSearch, setCatalogSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchBoxRef = useRef(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const [userId, setUserId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [checkoutState, setCheckoutState] = useState('idle')
  const [checkoutError, setCheckoutError] = useState('')
  const [itemQty, setItemQty] = useState(1)
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].id)
  const [promoCode, setPromoCode] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [session, setSession] = useState(null)
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
  const [role, setRole] = useState('buyer')
  const [roleToken, setRoleToken] = useState('')
  const [adminOrders, setAdminOrders] = useState([])
  const [adminState, setAdminState] = useState('idle')
  const [adminError, setAdminError] = useState('')
  const [adminRetry, setAdminRetry] = useState(0)
  const [adminCatalog, setAdminCatalog] = useState([])
  const [adminCatalogState, setAdminCatalogState] = useState('idle')
  const [adminCatalogError, setAdminCatalogError] = useState('')
  const [adminCatalogStale, setAdminCatalogStale] = useState(false)
  const [adminCatalogFetchedAt, setAdminCatalogFetchedAt] = useState('')
  const [catalogSyncing, setCatalogSyncing] = useState(false)
  const [catalogSyncNotice, setCatalogSyncNotice] = useState('')
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
  const [passwordDraft, setPasswordDraft] = useState('')
  const [passwordState, setPasswordState] = useState('idle')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [profileName, setProfileName] = useState('')
  const [passwordCurrent, setPasswordCurrent] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [roleState, setRoleState] = useState('idle')
  const [roleError, setRoleError] = useState('')
  const [roleRetry, setRoleRetry] = useState(0)
  const canManage = Boolean(session && roleState === 'ready' && role === 'admin' && roleToken === session.access_token)
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
    setLoginMessage(pending.purpose === 'signup' ? 'Akun dibuat. Kode sudah dikirim ke email — masukkan di bawah, atau klik tautan konfirmasinya.' : 'Kode sudah dikirim ke email — masukkan di bawah, atau klik tautannya buat langsung masuk.')
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

  async function loadProducts() {
    setCatalogState('loading')
    setCheckoutAvailable(false)
    setCatalogError('')
    try {
      const data = await request('/api/products')
      setProducts(Array.isArray(data.products) ? data.products : [])
      setCheckoutAvailable(data.checkoutAvailable === true)
      setCheckAvailable(data.checkAvailable === true)
      setCatalogState('ready')
    } catch (error) {
      setCatalogError(error.message)
      setCatalogState('error')
    }
  }

  useEffect(() => { loadProducts() }, [])
  useEffect(() => {
    const navigate = () => {
      const route = routeFromHash()
      setView(route.view)
      setAdminPage(route.adminPage || 'transactions')
      setGame(route.game)
      setCheckoutId(route.checkoutId)
      if (route.view === 'checkout') setCheckoutError('')
      setLoginState('idle')
      setLoginMessage('')
      requestAnimationFrame(() => {
        const hash = window.location.hash
        if (route.view === 'game' || route.view === 'checkout' || route.view === 'admin' || hash === '#akun' || hash === '#daftar') window.scrollTo(0, 0)
        else {
          const target = hash === '#katalog' ? 'katalog' : 'main'
          if (document.getElementById(target)) document.getElementById(target).scrollIntoView()
          else requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView())
        }
      })
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    if (!supabase) return
    let active = true
    restoredSession.then(({ session: next, error }) => {
      if (!active) return
      if (error) {
        if (authReturn) {
          if (authReturn.kind === 'cancelled') showToast('info', 'Login dibatalkan', 'Kamu membatalkan masuk dengan Google. Coba lagi kapan saja.')
          else if (authReturn.kind === 'error') showToast('error', 'Login Google gagal', 'Google menolak proses masuk. Coba lagi sebentar lagi.')
          else showToast('error', 'Login gagal', 'Kode login sudah tidak berlaku. Coba masuk lagi.')
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
          if (freshLogin) showToast('ok', 'Berhasil masuk', 'Kamu sudah masuk. Selamat datang lagi!')
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

  // ponytail: cut sesi 24 jam - dicek tiap menit dan saat tab kembali aktif.
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
    authHeaders().then((headers) => request('/api/admin/orders', { headers })).then((data) => {
      if (active) { setAdminOrders(Array.isArray(data.orders) ? data.orders : []); setAdminState('ready') }
    }).catch((error) => { if (active) { setAdminError(error.message); setAdminState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, adminRetry])

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
      setCatalogDrafts(Object.fromEntries(items.map((item) => [item.sku, { price: item.price == null ? '' : String(item.price), enabled: item.enabled === true }])))
      setAdminCatalogState('ready')
    }).catch((error) => { if (active) { setAdminCatalogError(error.message); setAdminCatalogState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, adminCatalogRetry])

  async function syncCatalog() {
    if (catalogSyncing) return
    setCatalogSyncing(true)
    setCatalogSyncNotice('')
    try {
      const headers = await authHeaders()
      const data = await request('/api/admin/supplier-products/sync', { method: 'POST', headers })
      setCatalogSyncNotice(`Katalog diperbarui: ${Number(data.synced) || 0} produk.`)
      setAdminCatalogRetry((value) => value + 1)
    } catch (error) {
      setCatalogSyncNotice(error.message)
    } finally {
      setCatalogSyncing(false)
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
    if (identity.email && !loginPassword) {
      setLoginState('error')
      setLoginMessage('Isi password akunmu dulu, atau pakai tombol "Masuk tanpa password".')
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
          setLoginMessage('Verifikasi 2 langkah aktif. Kode sudah dikirim ke email — masukkan di bawah.')
        } else {
          setLoginPassword('')
          writeSessionStart(window.localStorage, Date.now())
          setLoginState('idle')
          showToast('ok', 'Berhasil masuk', `Halo, ${data.user?.user_metadata?.name || data.user?.user_metadata?.full_name || data.user?.user_metadata?.username || identity.email}!`)
        }
      } else {
        setLoginState('error')
        setLoginMessage('Login pakai nomor HP belum aktif. Masuk pakai email dulu ya — kode dari email bisa dipakai tanpa password.')
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
          setLoginMessage('Email kamu belum dikonfirmasi. Kode konfirmasi baru sudah dikirim ke email — masukkan di bawah.')
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
      setLoginMessage('Kode sudah dikirim ke email — masukkan di bawah, atau klik tautannya buat langsung masuk.')
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
      setLoginMessage('Kode baru sudah dikirim ke email. Cek kotak masuk (dan folder spam).')
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
      showToast('ok', 'Berhasil masuk', 'Kamu sudah masuk. Selamat datang di Melonbyte!')
      window.location.hash = '#akun'
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
      setLoginMessage('Password minimal 6 karakter.')
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
        window.location.hash = '#akun'
        setLoginState('idle')
        setLoginMessage('Akun dibuat. Kamu langsung masuk.')
      } else if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
        await sendLoginEmail(email)
        setEmailCodeFor(email)
        setEmailCodePurpose('login')
        setEmailCode('')
        setResendWait(60)
        setLoginState('sent')
        setLoginMessage('Email ini sudah terdaftar — kamu langsung masuk ke akun itu. Kode sudah dikirim ke email, masukkan di bawah.')
        writePendingCode(window.localStorage, { email, purpose: 'login', sentAt: Date.now() })
      } else {
        setEmailCodeFor(email)
        setEmailCodePurpose('signup')
        setEmailCode('')
        setResendWait(60)
        setLoginState('sent')
        setLoginMessage('Akun dibuat. Kode sudah dikirim ke email — masukkan di bawah, atau klik tautan konfirmasinya.')
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
      setTwoStepMessage('Kode baru sudah dikirim ke email. Cek kotak masuk (dan folder spam).')
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
      setTwoStepMessage('Kode harus 6–10 digit angka. Cek email terbaru dari Melonbyte.')
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
      setTwoStepMessage(enabling ? 'Verifikasi 2 langkah aktif. Login berikutnya bakal minta kode dari email.' : 'Verifikasi 2 langkah dimatikan. Login cukup pakai email + password.')
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
      setPasswordMessage('Konfirmasi belum sama dengan kata sandi baru. Ulangi isian yang baru.')
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
      setPasswordMessage('Kata sandi tersimpan. Login berikutnya cukup email + kata sandi.')
    } catch (error) {
      setPasswordState('error')
      setPasswordMessage(authErrorMessage(error.message))
    }
  }

  const signOutButton = <button type="button" className="secondary-button signout-button" onClick={signOutAccount} disabled={signOutState === 'loading'}>{signOutState === 'loading' ? 'Keluar...' : 'Keluar akun'}</button>

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
    } catch { /* jaringan bisa gagal; sesi lokal tetap dibersihkan di bawah */ }
    try {
      const storage = window.localStorage
      const prefix = supabase.auth.storageKey
      for (const key of Object.keys(storage)) {
        if (key.startsWith(prefix)) storage.removeItem(key)
      }
    } catch { /* localStorage bisa diblokir; tombol logout tetap selesai */ }
    clearSessionStart(window.localStorage)
    setSignOutState('idle')
    showToast('ok', 'Kamu sudah keluar', 'Sesi di perangkat ini ditutup. Sampai jumpa lagi.')
  }

  // ponytail: cut sesi 24 jam - sesi lokal ditutup, pengguna masuk lagi.
  async function cutSession() {
    if (!supabase) return
    setSession(null)
    setTwoStepNext(null)
    setTwoStepCode('')
    setTwoStepState('idle')
    setTwoStepMessage('')
    setLoginState('idle')
    setLoginMessage('Sesi berakhir karena sudah berjalan 24 jam. Masuk lagi ya.')
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* jaringan bisa gagal; pembersihan lokal di bawah tetap jalan */ }
    try {
      const storage = window.localStorage
      const prefix = supabase.auth.storageKey
      for (const key of Object.keys(storage)) {
        if (key.startsWith(prefix)) storage.removeItem(key)
      }
    } catch { /* localStorage bisa diblokir */ }
    clearSessionStart(window.localStorage)
    showToast('info', 'Sesi berakhir', 'Sesi dibatasi 24 jam. Masuk lagi untuk melanjutkan.')
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
      showToast('info', 'Login dibatalkan', 'Kamu kembali sebelum menyelesaikan masuk dengan Google. Coba lagi kapan saja.')
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

  async function checkout(event) {
    event.preventDefault()
    if (!selected || !checkoutAvailable || checkoutState === 'loading') return
    setCheckoutState('loading')
    setCheckoutError('')
    try {
      if (!supabase || !session) throw new Error('Masuk ke akun dulu sebelum membuat pesanan.')
      const data = await request('/api/checkout', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(selected.format === 'plain' || selected.format === 'riot' ? { productId: selected.id, userId: userId.trim() } : { productId: selected.id, userId: userId.trim(), zoneId: zoneId.trim() }),
      })
      if (!data.orderId || !data.redirectUrl || !/^https:\/\/(app|app\.sandbox)\.midtrans\.com\/snap\//.test(data.redirectUrl)) {
        throw new Error('Tautan pembayaran tidak tersedia. Hubungi pengelola toko.')
      }
      window.location.assign(data.redirectUrl)
    } catch (error) {
      setCheckoutError(error.message)
      setCheckoutState('error')
    }
  }

  async function saveSellingPrice(sku) {
    const draft = catalogDrafts[sku]
    if (!draft || catalogBusy) return
    const price = Number(draft.price)
    if (!Number.isSafeInteger(price) || price < 1) { setCatalogNotice({ sku, text: 'Harga jual harus angka bulat minimal 1.', error: true }); return }
    setCatalogBusy(sku)
    setCatalogNotice({ sku: '', text: '', error: false })
    try {
      const data = await request(`/api/admin/products/${encodeURIComponent(sku)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ price, enabled: draft.enabled }) })
      const product = data.product
      setAdminCatalog((items) => items.map((item) => item.sku === sku ? { ...item, ...product } : item))
      setCatalogDrafts((drafts) => ({ ...drafts, [sku]: { price: product.price == null ? '' : String(product.price), enabled: product.enabled === true } }))
      setCatalogNotice({ sku, text: product.enabled ? 'Tersimpan. Produk tampil di katalog.' : 'Tersimpan. Produk belum tampil di katalog.', error: false })
      loadProducts()
    } catch (error) {
      setCatalogNotice({ sku, text: error.message, error: true })
    } finally {
      setCatalogBusy('')
    }
  }

  async function saveAllChanges() {
    if (catalogBusy) return
    const pending = adminCatalog.filter((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false }; return draft.price !== (item.price == null ? '' : String(item.price)) || (draft.enabled === true) !== (item.enabled === true) })
    if (pending.length === 0) return
    setBatchNotice('')
    let saved = 0
    for (const item of pending) {
      const draft = catalogDrafts[item.sku]
      const price = Number(draft.price)
      if (!Number.isSafeInteger(price) || price < 1) { setCatalogNotice({ sku: item.sku, text: 'Harga jual harus angka bulat minimal 1.', error: true }); continue }
      setCatalogBusy(item.sku)
      try {
        const data = await request(`/api/admin/products/${encodeURIComponent(item.sku)}`, { method: 'PUT', headers: await authHeaders(), body: JSON.stringify({ price, enabled: draft.enabled }) })
        const product = data.product
        setAdminCatalog((items) => items.map((current) => current.sku === item.sku ? { ...current, ...product } : current))
        setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { price: product.price == null ? '' : String(product.price), enabled: product.enabled === true } }))
        saved += 1
      } catch (error) {
        setCatalogNotice({ sku: item.sku, text: error.message, error: true })
      }
    }
    setCatalogBusy('')
    setBatchNotice(saved === pending.length ? `${saved} harga tersimpan.` : `${saved} dari ${pending.length} harga tersimpan; sisanya gagal, lihat kartunya.`)
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
    const reason = nextEnabled ? 'isi harga jual dulu atau belum didukung checkout' : 'harga jualnya belum lengkap'
    if (changed === 0) { setBatchNotice(`Tidak ada yang berubah. ${skipped} produk dilewati: ${reason}.`); return }
    setBatchNotice(`${changed} produk ${nextEnabled ? 'ditampilkan' : 'disembunyikan'}.${skipped > 0 ? ` ${skipped} dilewati: ${reason}.` : ''}`)
  }

    function applyBrandMargin(brand) {
    if (catalogBusy) return
    const pct = Number(marginDrafts[brand.name])
    if (!Number.isFinite(pct) || pct <= 0) { setBatchNotice(`Isi persen margin ${brand.name} dulu, lalu klik Terapkan.`); return }
    if (pct > 500) { setBatchNotice('Margin maksimal 500%.'); return }
    const updates = {}
    let skipped = 0
    for (const item of brand.items) {
      const cost = Number(item.cost)
      if (!Number.isFinite(cost) || cost <= 0) { skipped += 1; continue }
      updates[item.sku] = String(Math.ceil((cost * (1 + pct / 100)) / 100) * 100)
    }
    const applied = Object.keys(updates).length
    if (applied === 0) { setBatchNotice(`Tidak ada SKU ${brand.name} dengan modal di katalog aktif.`); return }
    setCatalogDrafts((drafts) => {
      const next = { ...drafts }
      for (const sku of Object.keys(updates)) next[sku] = { ...(drafts[sku] || { price: '', enabled: false }), price: updates[sku] }
      return next
    })
    setBatchNotice(`${applied} harga draft ${brand.name} terisi${skipped > 0 ? `; ${skipped} SKU tanpa modal dilewati` : ''}. Klik "Simpan semua perubahan" untuk menerapkan.`)
  }

const games = [...new Set(products.map((item) => item.game).filter(Boolean))]
  const activeType = ALL_CATALOG_TYPES.find((type) => type.id === category) || CATALOG_TYPES[0]
  const typeTabs = products.some((item) => catalogTypeOf(item) === OTHER_CATALOG_TYPE) ? [...CATALOG_TYPES, OTHER_CATALOG_TYPE] : CATALOG_TYPES
  const activeBrands = [...new Set(products.filter((item) => catalogTypeOf(item).id === activeType.id).map((item) => item.game).filter(Boolean))]
  const searchCatalogs = catalogSearch.trim() ? games.filter((name) => products.some((item) => item.game === name && matchesCatalog(item, catalogSearch))) : []
  const accountName = session?.user.user_metadata?.name || session?.user.user_metadata?.full_name || session?.user.user_metadata?.username || session?.user.email?.split('@')[0] || 'Akun'
  const accountInitial = String(accountName).trim().charAt(0).toLocaleUpperCase('id-ID') || 'A'
  const filtered = products.filter((item) => item.game === game)
  const selected = products.find((item) => item.id === checkoutId) || null
  const orderItems = view === 'checkout' ? (selected ? products.filter((item) => item.game === selected.game) : []) : filtered
  const orderFormat = selected?.format || orderItems[0]?.format || 'plain'
  const orderType = catalogTypeOf(selected || orderItems[0] || {})

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
      setCheckError(orderFormat === 'plain' ? 'Isi User ID angka dulu.' : 'Isi User ID dan Zone ID angka dulu.')
      return
    }
    const run = checkRunRef.current + 1
    checkRunRef.current = run
    setCheckState('loading')
    setCheckError('')
    try {
      if (!supabase || !session) throw new Error('Masuk ke akun dulu untuk memakai cek nickname.')
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

  function changeQuantity(delta) {
    setItemQty((value) => Math.min(MAX_ITEM_QTY, Math.max(1, value + delta)))
  }

  function setQuantityValue(raw) {
    const digits = String(raw).replace(/[^0-9]/g, '')
    setItemQty(digits ? Math.min(MAX_ITEM_QTY, Math.max(1, Number(digits))) : 1)
  }

  function openCatalog(name) {
    setSearchOpen(false)
    setCatalogSearch('')
    window.location.hash = `#game/${encodeURIComponent(name)}`
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
    return [...categories.values()].map((category) => ({ ...category, brands: [...category.brands.values()] }))
  })()
  const pricingDirty = adminCatalog.filter((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false }; return draft.price !== (item.price == null ? '' : String(item.price)) || (draft.enabled === true) !== (item.enabled === true) }).length

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
          <a className="wordmark" href="#main" aria-label="Melonbyte, kembali ke awal"><span>melon</span>byte<span className="wordmark-dot">.</span></a>
          <form className="home-search" role="search" ref={searchBoxRef} onSubmit={(event) => { event.preventDefault(); const first = searchCatalogs[0]; if (first) openCatalog(first); else if (catalogSearch.trim()) setSearchOpen(true); else document.getElementById('katalog')?.scrollIntoView({ behavior: 'smooth' }) }}>
            <div className="home-search-controls"><input id="home-catalog-search" type="search" aria-label="Cari di katalog" autoComplete="off" aria-autocomplete="list" aria-expanded={searchOpen && Boolean(catalogSearch.trim())} aria-controls="home-search-suggest" value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setSearchOpen(true) }} onFocus={() => { if (catalogSearch.trim()) setSearchOpen(true) }} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Cari di katalog" /><button type="submit">Cari</button>{searchOpen && catalogSearch.trim() && <div className="search-suggest" id="home-search-suggest">{searchCatalogs.length === 0 ? <p className="suggest-empty" role="status">Layanan tidak ditemukan. Coba kata lain.</p> : searchCatalogs.map((name) => <button key={name} type="button" onClick={() => openCatalog(name)}><span className="game-initial" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</span><span className="suggest-text"><strong>{name}</strong><small>{products.filter((item) => item.game === name).length} nominal</small></span></button>)}</div>}</div>
          </form>
          <nav aria-label="Navigasi utama">
            <a href="#katalog">Katalog</a>
            {canManage && <a href="#admin" aria-current={view === 'admin' ? 'page' : undefined}>Admin</a>}
            {session ? <a className="account-avatar" href="#akun" aria-label={`Akun ${accountName}`} title={accountName} aria-current={view === 'account' ? 'page' : undefined}>{accountInitial}</a> : <>
              <a href="#akun" aria-current={view === 'account' ? 'page' : undefined}>Masuk</a>
              <a href="#daftar" aria-current={view === 'register' ? 'page' : undefined}>Daftar</a>
            </>}
          </nav>
        </div>
      </header>

      <main id="main">
        {view === 'home' ? <>
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" /> MELONBYTE / TOP UP DIGITAL</p>
            <h1 id="hero-title">Mainnya lanjut.<br /><em>Top up-nya di&nbsp;sini.</em></h1>
            <p className="hero-description">Cari layanan digitalmu di katalog. Harga dan ketersediaan mengikuti produk aktif.</p>
            <a className="primary-link" href="#katalog">Lihat pilihan top up <span aria-hidden="true">↗</span></a>
          </div>
          <div className="hero-graphic" aria-hidden="true">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <span className="graphic-text">m<span className="graphic-dot">.</span></span>
            <span className="graphic-caption">PLAY ON / RELOAD / REPEAT</span>
          </div>
        </section>

        <section className="shop-section" id="katalog" aria-labelledby="catalog-title">
          <div className="wrap shop-inner">
            <div className="section-heading"><div><h2 id="catalog-title">Katalog</h2></div><p>Pilih kategori dan layanan yang kamu cari.</p></div>

            <div className="category-filter" role="group" aria-label="Kategori katalog">
              {typeTabs.map((type) => <button key={type.id} type="button" className={activeType.id === type.id ? 'active' : ''} aria-pressed={activeType.id === type.id} onClick={() => { setCategory(type.id); setCatalogSearch('') }}>{type.label}</button>)}
            </div>
            {catalogState === 'loading' && <div className="notice" role="status">Memuat katalog...</div>}
            {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
            {catalogState === 'ready' && (activeBrands.length === 0 ? <div className="notice" role="status"><strong>{activeType.label} belum tersedia.</strong><p>Belum ada layanan aktif dalam kategori ini. Cek lagi nanti.</p></div> : <div className="game-grid">{activeBrands.map((item) => <button key={item} type="button" className="game-card" onClick={() => { window.location.hash = `#game/${encodeURIComponent(item)}` }}><GameCover name={item} /><span><strong>{item}</strong><small>Lihat nominal</small></span><span aria-hidden="true">›</span></button>)}</div>)}
          </div>
        </section>

        </> : view === 'game' || view === 'checkout' ? <section className="checkout-section wrap" id={view === 'game' ? 'game-detail' : 'data-akun'} aria-labelledby="order-title">
          <div className="section-heading"><div><a className="back-button" href={view === 'game' ? '#katalog' : selected ? `#game/${encodeURIComponent(selected.game)}` : '#katalog'}>‹ {view === 'game' ? 'Semua layanan' : 'Kembali'}</a><h2 id="order-title">{game || 'Checkout'}</h2></div><p>{view === 'game' ? 'Isi data berurutan; ringkasan di samping ikut berubah.' : 'Periksa pesanan, lalu lanjut ke pembayaran.'}</p></div>
          {catalogState === 'loading' && <div className="notice" role="status">Memuat produk...</div>}
          {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
          {catalogState === 'ready' && view === 'game' && filtered.length === 0 && <div className="notice" role="status"><strong>Belum ada nominal aktif.</strong><p>Produk baru tampil setelah harga dan stok dikonfigurasi. Checkout belum tersedia.</p></div>}
          {catalogState === 'ready' && view === 'checkout' && !selected && <div className="notice" role="status"><strong>Produk tidak ditemukan.</strong><p>Produk mungkin sudah tidak aktif. Pilih lagi dari katalog.</p><p><a href="#katalog">Kembali ke katalog</a></p></div>}
          {catalogState === 'ready' && (view === 'game' ? filtered.length > 0 : selected) && <div className="checkout-layout">
            <form className="checkout-form order-form" onSubmit={checkout}>
              <ol className="order-steps">
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">1</span><h3>{orderType.targetTitle}</h3></div>
                  {orderFormat === 'ml_concat' && <p className="field-hint">Pastikan User ID dan Zone ID sesuai akun game tujuan.</p>}
                  {orderFormat === 'uid_server' && <p className="field-hint">Server akun terlihat di layar masuk game. Pilih yang sama untuk semua nominal.</p>}
                  {orderFormat === 'riot' && <p className="field-hint">Pakai Riot ID lengkap dengan tag, contoh: NamaKamu#1234.</p>}
                  <div className="field-row"><label>{orderFormat === 'riot' ? 'Riot ID' : orderType.targetLabel} <input value={userId} onChange={(event) => setUserId(event.target.value)} required maxLength={orderFormat === 'riot' ? '40' : '32'} inputMode={orderFormat === 'riot' ? 'text' : 'numeric'} pattern={orderFormat === 'riot' ? '[A-Za-z0-9# ._-]+' : '[0-9]+'} placeholder={orderFormat === 'riot' ? 'Nama#1234' : orderType.targetPlaceholder} autoComplete="off" /></label>{orderFormat === 'ml_concat' && <label>Zone ID <input value={zoneId} onChange={(event) => setZoneId(event.target.value)} required maxLength="20" inputMode="numeric" pattern="[0-9]+" placeholder="Zone ID" autoComplete="off" /></label>}{orderFormat === 'uid_server' && <label>Server <select value={zoneId} onChange={(event) => setZoneId(event.target.value)} required><option value="" disabled>Pilih server</option>{uidServerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}</div>
                  <p className="field-hint">{orderFormat === 'plain' ? orderType.targetHint : orderFormat === 'ml_concat' ? 'User ID dan Zone ID numerik. Jangan masukkan password game.' : orderFormat === 'riot' ? 'Hanya butuh Riot ID. Jangan masukkan password akun.' : 'UID numerik + server akun. Jangan masukkan password akun.'}</p>
                  {selected?.checkable && (
                    <div className="check-block">
                      {checkState === 'done' && checkResult ? (
                        <p className="check-result" role="status">Nickname: <strong>{checkResult.nickname}</strong>{checkResult.region ? ` · Region ${checkResult.region}` : ''} <span className="check-note">{checkResult.cached ? 'hasil tersimpan' : 'baru dicek'}</span></p>
                      ) : (
                        <button type="button" className="check-button" onClick={() => checkNickname(false)} disabled={!checkAvailable || checkState === 'loading'}>{checkState === 'loading' ? 'Mengecek...' : 'Cek nickname'}</button>
                      )}
                      {checkState === 'done' && <button type="button" className="check-again-button" onClick={() => checkNickname(true)} disabled={!checkAvailable || checkState === 'loading'}>Cek ulang</button>}
                      {checkState === 'error' && <p className="check-error" role="alert">{checkError}</p>}
                      {!checkAvailable && <p className="field-hint">Cek nickname belum aktif di server ini.</p>}
                    </div>
                  )}
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">2</span><h3>Pilih nominal</h3></div>
                  {view === 'checkout' && <p className="field-hint">Ganti nominal kapan saja; ringkasan ikut berubah.</p>}
                  <div className="product-grid">{orderItems.map((item) => <button key={item.id} type="button" className={item.id === selected?.id ? 'product selected' : 'product'} aria-current={item.id === selected?.id ? 'true' : undefined} onClick={() => { window.location.hash = `#beli/${encodeURIComponent(item.id)}` }}><span className="product-game">{item.game}</span><strong>{item.name}</strong><span className="product-bottom"><span>{rupiah(item.price)}</span><span aria-hidden="true">›</span></span></button>)}</div>
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">3</span><h3>Jumlah pembelian</h3><span className="step-tag">Pratinjau</span></div>
                  <div className="qty-stepper"><button type="button" className="qty-button" onClick={() => changeQuantity(-1)} disabled={itemQty <= 1} aria-label="Kurangi jumlah">−</button><input value={itemQty} onChange={(event) => setQuantityValue(event.target.value)} inputMode="numeric" pattern="[0-9]+" maxLength="2" aria-label="Jumlah pembelian" autoComplete="off" /><button type="button" className="qty-button" onClick={() => changeQuantity(1)} disabled={itemQty >= MAX_ITEM_QTY} aria-label="Tambah jumlah">+</button></div>
                  <p className="field-hint">Maksimal {MAX_ITEM_QTY} per pesanan. Jumlah belum dikirim ke server.</p>
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">4</span><h3>Metode pembayaran</h3><span className="step-tag">Pratinjau</span></div>
                  <div className="pay-options" role="radiogroup" aria-label="Metode pembayaran">{PAYMENT_METHODS.map((method) => <label key={method.id} className={paymentMethod === method.id ? 'pay-option active' : 'pay-option'}><input type="radio" name="payment" value={method.id} checked={paymentMethod === method.id} onChange={() => setPaymentMethod(method.id)} autoComplete="off" /><span><strong>{method.label}</strong><small>{method.note}</small></span></label>)}</div>
                  <p className="field-hint">Metode final masih dipilih di halaman Midtrans saat checkout aktif.</p>
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">5</span><h3>Kode promo</h3><span className="step-tag">Pratinjau</span></div>
                  <label>Kode promo <input value={promoCode} onChange={(event) => setPromoCode(event.target.value)} maxLength="24" placeholder="Contoh: MANGGA10" autoComplete="off" /></label>
                  <p className="field-hint">Kode promo belum aktif — kolom ini disiapkan untuk promo mendatang.</p>
                </li>
                <li className="order-step">
                  <div className="order-step-head"><span className="step-badge" aria-hidden="true">6</span><h3>Detail kontak</h3></div>
                  {session ? <>
                    <div className="field-row"><label>Email <input value={session.user.email || ''} readOnly /></label><label>Nomor HP <input value={session.user.phone || session.user.user_metadata?.requested_phone || ''} readOnly /></label></div>
                    <p className="field-hint">Detail kontak mengikuti profil akunmu. <a href="#akun">Ubah di profil</a>.</p>
                  </> : <>
                    <div className="field-row"><label>Email <input value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} type="email" maxLength="120" placeholder="nama@email.com" autoComplete="off" /></label><label>Nomor HP <input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} type="tel" maxLength="20" inputMode="tel" placeholder="08..." autoComplete="off" /></label></div>
                    <p className="field-hint">Transaksi tamu (email + nomor HP) belum aktif. Masuk dulu agar pesanan tersimpan di akunmu. <a href="#akun">Masuk di sini</a>.</p>
                  </>}
                </li>
              </ol>
              {!checkoutAvailable && <p className="field-hint" role="status">Checkout belum tersedia. Integrasi pembayaran dan Digiflazz masih menunggu verifikasi.</p>}
              {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
              <button className="checkout-button" type="submit" disabled={!checkoutAvailable || !selected || !session || checkoutState === 'loading'}>{checkoutState === 'loading' ? 'Menyiapkan pembayaran...' : 'Lanjut ke pembayaran'}</button>
              <p className="form-note">Pembayaran lewat Midtrans saat layanan terhubung. Pesanan dikirim setelah pembayaran terkonfirmasi.</p>
            </form>
            <aside className="summary" aria-label="Ringkasan pesanan"><p className="eyebrow">RINGKASAN</p>{selected ? <><div className="summary-item"><span>{selected.game}</span><strong>{selected.name}</strong></div><div className="summary-total"><span>Harga</span><strong>{rupiah(selected.price)}</strong></div><div className="summary-total"><span>Jumlah</span><strong>{itemQty} item</strong></div><div className="summary-total"><span>Total</span><strong>{rupiah(selected.price * itemQty)}</strong></div><p>Biaya pembayaran, jika ada, tampil di halaman pembayaran.</p></> : <p>Belum ada item produk yang dipilih.</p>}</aside>
          </div>}
        </section> : <div className={view === 'admin' ? 'admin-page wrap' : 'account-page wrap'} id={view === 'admin' ? 'admin' : 'akun'}>
          {view === 'admin' ? <>
            <div className="admin-heading"><div><h1>Panel admin</h1><p>Kelola pesanan toko dan harga produk.</p></div><a className="secondary-button" href="#katalog">Lihat toko</a></div>
            {canManage && <nav className="admin-nav" aria-label="Navigasi admin">
              <a href="#admin" aria-current={adminPage === 'transactions' ? 'page' : undefined}>Transaksi</a>
              <a href="#admin/produk" aria-current={adminPage === 'products' ? 'page' : undefined}>Produk &amp; harga</a>
            </nav>}
            {!session ? <div className="notice" role="status"><p>Masuk dengan akun admin untuk mengelola toko.</p><a className="secondary-button" href="#akun">Masuk</a></div> : roleState === 'ready' && !canManage ? <div className="notice" role="status"><p>Halaman ini khusus admin toko.</p><a className="secondary-button" href="#akun">Kembali ke akun</a></div> : null}
          </> : <h1>{view === 'register' && !session ? 'Daftar akun' : 'Akun saya'}</h1>}
          {view !== 'admin' && <>
          <section className="account-section" aria-labelledby="account-title">
            <div className={session ? 'account-layout account-wide' : 'account-layout account-auth'}>
              {session && <div>
                <h2 id="account-title">Profil akun</h2>
                <p>Pesanan yang kamu buat tersimpan di akun ini.</p>
              </div>}
              <div className={session ? 'order-panel' : 'order-panel auth-panel'}>
                {!session && <>
                  <h2 id="account-title">{view === 'register' ? 'Biar pesananmu gampang dicek.' : 'Masuk ke akun'}</h2>
                  <p className="auth-lead">{view === 'register' ? 'Daftar pakai email, password, nomor HP, dan username.' : 'Masuk pakai email + password, atau kode dari email.'}</p>
                </>}
                {!supabase ? <p role={authConfigError ? 'alert' : 'status'}>{authConfigError ? 'Konfigurasi login salah. Gunakan publishable/anon key Supabase; secret/service_role tidak boleh dipakai browser.' : 'Akun belum aktif. Pemilik toko perlu menambahkan konfigurasi Supabase.'}</p> : session ? <>
                  {session.user.email ? <><div className="profile-cols">
                    <div className="profile-col">
                      <form className="profile-form" onSubmit={saveProfile}>
                        <p className="form-title">Ubah profil</p>
                        <div className="profile-field"><label htmlFor="profile-name">Nama</label><input id="profile-name" type="text" autoComplete="off" maxLength="40" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Nama kamu" /></div>
                        <div className="profile-field"><label htmlFor="profile-username">Username</label><input id="profile-username" type="text" autoComplete="off" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="username kamu" /></div>
                        <div className="profile-field"><label htmlFor="profile-email">Email</label><input id="profile-email" type="email" value={session.user.email} readOnly /></div>
                        <div className="profile-field"><label htmlFor="profile-phone">Nomor HP</label><input id="profile-phone" type="tel" autoComplete="off" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." /></div>
                        <button type="submit" className="secondary-button" disabled={profileState === 'loading'}>{profileState === 'loading' ? 'Menyimpan...' : 'Ubah profil'}</button>
                      </form>
                      {session.user.phone_confirmed_at ? <p role="status">Nomor HP terverifikasi: {session.user.phone}</p> : session.user.user_metadata?.requested_phone ? <p role="status">Verifikasi nomor HP lewat SMS belum aktif, jadi nomor ini belum bisa dipakai untuk masuk.</p> : null}
                      {phoneMessage && <p role={profileState === 'error' ? 'alert' : 'status'}>{phoneMessage}</p>}
                    </div>
                    <div className="profile-col">
                      <form className="profile-form password-form" onSubmit={savePassword}>
                        <p className="form-title">Ubah kata sandi</p>
                        <p className="form-note">Pastikan kamu mengingat kata sandi barunya.</p>
                        <div className="profile-field"><label htmlFor="account-current-password">Kata sandi saat ini</label><input id="account-current-password" type="password" autoComplete="current-password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} placeholder="Kata sandi saat ini (kalau sudah ada)" /></div>
                        <div className="profile-field"><label htmlFor="account-password">Kata sandi baru</label><input id="account-password" type="password" autoComplete="new-password" minLength="6" required value={passwordDraft} onChange={(event) => setPasswordDraft(event.target.value)} placeholder="minimal 6 karakter" /></div>
                        <div className="profile-field"><label htmlFor="account-password-confirm">Konfirmasi kata sandi baru</label><input id="account-password-confirm" type="password" autoComplete="new-password" minLength="6" required value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} placeholder="ulangi kata sandi baru" /></div>
                        <button type="submit" className="secondary-button" disabled={passwordState === 'loading'}>{passwordState === 'loading' ? 'Menyimpan...' : 'Ubah kata sandi'}</button>
                      </form>
                      {passwordMessage && <p role={passwordState === 'error' ? 'alert' : 'status'}>{passwordMessage}</p>}
                      <div className="two-step-zone">
                        <p className="form-title">Verifikasi 2 langkah</p>
                        <p className="form-note">Kalau aktif, login pakai kata sandi bakal diminta kode dari email. Login Google langsung masuk karena udah diverifikasi Google.</p>
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
                  </div><div className="signout-zone"><p className="signout-hint">Kamu bisa masuk lagi kapan saja dengan email dan kata sandi.</p>{signOutButton}</div></> : <><p>Masuk sebagai <strong>{session.user.phone}</strong></p>{signOutButton}</>}
                </> : view === 'register' ? <>
                  <form className="profile-form" onSubmit={register}>
                    <div className="auth-fields">
                    <div className="profile-field"><label htmlFor="register-email">Email</label><input id="register-email" type="email" autoComplete="off" required value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} placeholder="email@contoh.com" /></div>
                    <div className="profile-field"><label htmlFor="register-password">Password</label><input id="register-password" type="password" autoComplete="new-password" minLength="6" required value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} placeholder="minimal 6 karakter" /></div>
                    <div className="profile-field"><label htmlFor="register-phone">Nomor HP</label><input id="register-phone" type="tel" autoComplete="off" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." /></div>
                    <div className="profile-field"><label htmlFor="register-username">Username</label><input id="register-username" type="text" autoComplete="off" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="3–24 huruf, angka, atau _" /></div>
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
                      <label htmlFor="contact">Email</label>
                      <div className="order-input">
                        <input id="contact" type="text" autoComplete="off" value={contact} onChange={(event) => { setContact(event.target.value); setLoginMessage(''); setLoginState('idle') }} placeholder="email@contoh.com" required />
                        <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Memproses...' : contactIdentity.email ? 'Masuk' : 'Lanjut'}</button>
                      </div>
                    </div>
                    {contactIdentity.email && <div className="profile-field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="Password akunmu" /></div>}
                  </form>
                  {contactIdentity.email && <button type="button" className="link-button" onClick={sendEmailLink} disabled={loginState === 'loading'}>Masuk tanpa password (kirim kode ke email)</button>}
                  {emailCodeForm}
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Masuk atau daftar dengan Google</button>

                </>}
              </div>
              {!session && <aside className="auth-aside">
                <p className="form-title">{view === 'register' ? 'Sudah punya akun?' : 'Belum punya akun?'}</p>
                <p className="form-note">{view === 'register' ? 'Masuk pakai email + password, atau kode dari email.' : 'Daftar pakai email, password, nomor HP, dan username.'}</p>
                <a className="secondary-button" href={view === 'register' ? '#akun' : '#daftar'}>{view === 'register' ? 'Masuk' : 'Daftar akun'}</a>
              </aside>}
            </div>
          </section>
          {session && <section className="order-section" aria-labelledby="order-title"><div className="order-layout"><div><h2 id="order-title">Riwayat pesanan</h2><p>Status pending berarti pesanan masih diproses. Jangan bayar ulang sebelum mengecek statusnya.</p></div><div className="order-panel">{ordersState === 'loading' ? <p role="status">Memuat pesanan...</p> : ordersState === 'error' ? <p role="alert">Gagal memuat pesanan. {ordersError} <button type="button" onClick={() => setOrdersRetry((value) => value + 1)}>Coba lagi</button></p> : orders.length === 0 ? <p role="status">Belum ada pesanan di akun ini. <a href="#katalog">Lihat katalog</a></p> : <ul className="order-list">{orders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.status}</span><small>#{order.id}</small></li>)}</ul>}</div></div></section>}
          </>}
          {view === 'admin' && session && roleState === 'loading' && <p role="status">Memeriksa akses akun...</p>}
          {view === 'admin' && session && roleState === 'error' && <p role="alert">Akses pengelola belum bisa diperiksa. {roleError} <button type="button" onClick={() => setRoleRetry((value) => value + 1)}>Coba lagi</button></p>}
          {view === 'admin' && canManage && adminPage === 'transactions' && <section className="order-section admin-section" aria-labelledby="admin-title"><div className="order-layout"><div><h2 id="admin-title">Transaksi</h2><p>Pesanan terbaru toko, dari seluruh pembeli.</p></div><div className="order-panel">{adminState === 'loading' ? <p role="status">Memuat pesanan toko...</p> : adminState === 'error' ? <p role="alert">Gagal memuat pesanan toko. {adminError} <button type="button" onClick={() => setAdminRetry((value) => value + 1)}>Coba lagi</button></p> : adminOrders.length === 0 ? <p role="status">Belum ada pesanan toko.</p> : <ul className="order-list">{adminOrders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.status}</span><small>#{order.id}</small></li>)}</ul>}</div></div></section>}
          {view === 'admin' && canManage && adminPage === 'products' && <section className="order-section admin-section" aria-labelledby="pricing-title"><div className="section-heading"><div><h2 id="pricing-title">Harga jual</h2></div><p>Harga supplier adalah modal, tidak tampil ke pembeli. Simpan harga jual sebelum menampilkan produk.</p></div><div className="catalog-sync"><span className="catalog-sync-state">{adminCatalogFetchedAt ? `Katalog supplier · sinkron ${new Date(adminCatalogFetchedAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Katalog supplier belum disinkron.'}</span><button type="button" className="secondary-button" onClick={syncCatalog} disabled={catalogSyncing}>{catalogSyncing ? 'Menyinkron...' : 'Perbarui katalog'}</button></div>{catalogSyncNotice && <p className="catalog-sync-notice" role="status">{catalogSyncNotice}</p>}{adminCatalogState === 'loading' ? <p role="status">Memuat katalog supplier...</p> : adminCatalogState === 'error' ? <p role="alert">Katalog supplier belum bisa dimuat. {adminCatalogError} <button type="button" onClick={() => setAdminCatalogRetry((value) => value + 1)}>Coba lagi</button></p> : adminCatalog.length === 0 ? <p role="status">Katalog supplier kosong — tekan Perbarui katalog.</p> : <><div className="pricing-toolbar"><input type="text" aria-label="Cari produk supplier" placeholder="Cari nama, kode, atau brand" autoComplete="off" value={catalogQuery} onChange={(event) => { setCatalogQuery(event.target.value) }} /><div className="category-filter" role="group" aria-label="Saring produk"><button type="button" className={catalogFilter === 'semua' ? 'active' : ''} aria-pressed={catalogFilter === 'semua'} onClick={() => { setCatalogFilter('semua') }}>Semua</button><button type="button" className={catalogFilter === 'tampil' ? 'active' : ''} aria-pressed={catalogFilter === 'tampil'} onClick={() => { setCatalogFilter('tampil') }}>Tampil</button><button type="button" className={catalogFilter === 'draf' ? 'active' : ''} aria-pressed={catalogFilter === 'draf'} onClick={() => { setCatalogFilter('draf') }}>Draf</button></div></div><div className="pricing-meta"><div className="pricing-meta-actions">{adminCatalogStale && <span className="pricing-stale" role="status">Katalog sudah lama tidak disinkron.</span>}{batchNotice && <span role="status">{batchNotice}</span>}<label className="pricing-unsupported"><input type="checkbox" checked={catalogShowUnsupported} onChange={(event) => { setCatalogShowUnsupported(event.target.checked) }} />Tampilkan yang belum didukung checkout</label>{pricingDirty > 0 && <button type="button" className="secondary-button" onClick={saveAllChanges} disabled={Boolean(catalogBusy)}>Simpan semua ({pricingDirty})</button>}</div></div>{pricingItems.length === 0 ? <p className="pricing-empty" role="status">Tidak ada produk yang cocok. Ubah kata kunci atau saringan.</p> : <><div className="price-groups">{pricingGroups.map((category) => { const categoryShown = category.items.filter((item) => (catalogDrafts[item.sku] || {}).enabled === true).length; return <section key={category.name} className="price-group"><label className="switch price-category-switch" title={`Nyala/matikan semua produk kategori ${category.name}`}><input type="checkbox" role="switch" checked={categoryShown === category.items.length} ref={(el) => { if (el) el.indeterminate = categoryShown > 0 && categoryShown < category.items.length }} aria-label={`Tampilkan semua produk kategori ${category.name}`} onChange={(event) => toggleGroup(category.items, event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label><details className="price-category" open={Boolean(catalogQuery.trim())}><summary className="price-cat-head"><h3 className="price-cat-title">{category.name}<small className="price-group-count">{category.items.length} produk · {categoryShown} tampil</small></h3></summary>{category.brands.map((brand) => { const brandShown = brand.items.filter((item) => (catalogDrafts[item.sku] || {}).enabled === true).length; return <div key={brand.name} className="price-brand"><label className="switch price-brand-switch" title={`Nyala/matikan semua produk ${brand.name}`}><input type="checkbox" role="switch" checked={brandShown === brand.items.length} ref={(el) => { if (el) el.indeterminate = brandShown > 0 && brandShown < brand.items.length }} aria-label={`Tampilkan semua produk ${brand.name}`} onChange={(event) => toggleGroup(brand.items, event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label><details className="price-brand-details" open={Boolean(catalogQuery.trim())}><summary className="price-brand-head"><span className="price-brand-cover"><GameCover name={brand.name} /></span><h4 className="price-brand-title">{brand.name}<small className="price-group-count">{brand.items.length} produk · {brandShown} tampil</small></h4></summary><div className="price-margin"><label className="price-margin-field"><span>Margin</span><input type="number" inputMode="decimal" min="0" max="500" step="0.5" placeholder="8" autoComplete="off" aria-label={`Margin harga ${brand.name} (%)`} value={marginDrafts[brand.name] || ''} onChange={(event) => setMarginDrafts((drafts) => ({ ...drafts, [brand.name]: event.target.value }))} /><span>%</span></label><button type="button" className="secondary-button" onClick={() => applyBrandMargin(brand)} disabled={Boolean(catalogBusy)}>Terapkan</button><span className="price-margin-hint">Modal × (1 + %), dibulatkan ke atas.</span></div><ul className="price-grid">{brand.items.map((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false }; return <li key={item.sku} className="price-card"><div className="price-head"><strong>{item.name || item.sku}</strong><small>{item.game || item.sku}{item.variant ? ` · ${item.variant}` : ''}{item.category ? ` · ${item.category}` : ''}</small></div><div className="price-row"><span className="price-cost">{item.cost == null ? 'Tidak ada di katalog supplier aktif.' : `Modal ${rupiah(item.cost)}`}</span><label className="price-toggle"><input type="checkbox" checked={draft.enabled} disabled={!item.supported} aria-label={`Tampil di katalog: ${item.name || item.sku}`} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, enabled: event.target.checked } }))} />Tampil</label></div><div className="price-row price-actions"><input type="number" inputMode="numeric" min="1" step="1" placeholder="Harga jual (Rp)" autoComplete="off" aria-label={`Harga jual ${item.name || item.sku}`} value={draft.price} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, price: event.target.value } }))} onKeyDown={(event) => { if (event.key === 'Enter') saveSellingPrice(item.sku) }} /><button type="button" className="secondary-button" onClick={() => saveSellingPrice(item.sku)} disabled={Boolean(catalogBusy)}>{catalogBusy === item.sku ? 'Menyimpan...' : 'Simpan'}</button></div>{!item.supported && <p className="price-hint">Belum didukung checkout, jadi belum bisa tampil.</p>}{item.cost != null && Number(draft.price) > 0 && Number(draft.price) < item.cost && <p className="price-warning" role="status">Harga jual di bawah modal.</p>}{catalogNotice.sku === item.sku && <p className="price-hint" role={catalogNotice.error ? 'alert' : 'status'}>{catalogNotice.text}</p>}</li>; })}</ul></details></div>; })}</details></section>; })}</div></>}</>}</section>}
        </div>}
      </main>
      <footer className="footer"><div className="wrap footer-inner"><span className="wordmark"><span>melon</span>byte<span className="wordmark-dot">.</span></span><p>Layanan digital. Harga dan ketersediaan mengikuti katalog aktif.</p><a href="#main">Kembali ke atas ↑</a></div></footer>
    </div>
  )
}

export default App
