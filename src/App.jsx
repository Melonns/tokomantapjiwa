import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { parseContact, parseRegistration, tryParseContact } from './contact.mjs'
import { matchesCatalog } from './catalog.mjs'
import { restoreSession } from './auth.mjs'
import { authErrorMessage } from './auth-errors.mjs'
import { isPublicSupabaseKey } from './public-key.mjs'
import './store.css'

const authConfigError = import.meta.env.VITE_SUPABASE_AUTH_ERROR || (import.meta.env.VITE_SUPABASE_ANON_KEY && !isPublicSupabaseKey(import.meta.env.VITE_SUPABASE_ANON_KEY))
const supabase = !authConfigError && import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', detectSessionInUrl: false } })
  : null
const restoredSession = supabase ? restoreSession(supabase.auth, window.location, window.history)
  .then((session) => ({ session, error: null }), (error) => ({ session: null, error })) : Promise.resolve({ session: null, error: null })
if (import.meta.hot) import.meta.hot.dispose(() => supabase?.auth.stopAutoRefresh())
const rupiah = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)

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
  if (hash.startsWith('#game/')) return { view: 'game', game: decodeHash(hash.slice(6)), checkoutId: '' }
  if (hash.startsWith('#beli/')) return { view: 'checkout', game: null, checkoutId: decodeHash(hash.slice(6)) }
  return { view: 'home', game: null, checkoutId: '' }
}

function decodeHash(value) {
  try { return decodeURIComponent(value) } catch { return value }
}
function App() {
  const [products, setProducts] = useState([])
  const [checkoutAvailable, setCheckoutAvailable] = useState(false)
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogError, setCatalogError] = useState('')
  const [game, setGame] = useState(() => routeFromHash().game)
  const [category, setCategory] = useState('Game')
  const [view, setView] = useState(() => routeFromHash().view)
  const [checkoutId, setCheckoutId] = useState(() => routeFromHash().checkoutId)

  const [catalogSearch, setCatalogSearch] = useState('')
  const [userId, setUserId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [checkoutState, setCheckoutState] = useState('idle')
  const [checkoutError, setCheckoutError] = useState('')
  const [session, setSession] = useState(null)
  const [contact, setContact] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPhone, setRegisterPhone] = useState('')
  const [registerPassword, setRegisterPassword] = useState('')
  const [registerUsername, setRegisterUsername] = useState('')
  const [phoneToVerify, setPhoneToVerify] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [profileState, setProfileState] = useState('idle')
  const [phoneState, setPhoneState] = useState('idle')
  const [phoneMessage, setPhoneMessage] = useState('')
  const [code, setCode] = useState('')
  const [codeTarget, setCodeTarget] = useState('')
  const [loginState, setLoginState] = useState('idle')
  const [loginMessage, setLoginMessage] = useState('')
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
  const [adminCatalogRetry, setAdminCatalogRetry] = useState(0)
  const [catalogDrafts, setCatalogDrafts] = useState({})
  const [catalogBusy, setCatalogBusy] = useState('')
  const [catalogNotice, setCatalogNotice] = useState({ sku: '', text: '', error: false })
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogFilter, setCatalogFilter] = useState('semua')
  const [catalogShowUnsupported, setCatalogShowUnsupported] = useState(false)
  const [catalogShown, setCatalogShown] = useState(24)
  const [batchNotice, setBatchNotice] = useState('')
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
  const contactIdentity = tryParseContact(contact)
  useEffect(() => {
    if (!session) return
    const meta = session.user.user_metadata || {}
    setRegisterUsername(meta.username || '')
    setProfileName(meta.name || '')
    setRegisterPhone(session.user.phone ? String(session.user.phone).replace(/^\+62/, '0') : meta.requested_phone ? String(meta.requested_phone).replace(/^\+62/, '0') : '')
  }, [session?.user?.id])

  async function loadProducts() {
    setCatalogState('loading')
    setCheckoutAvailable(false)
    setCatalogError('')
    try {
      const data = await request('/api/products')
      setProducts(Array.isArray(data.products) ? data.products : [])
      setCheckoutAvailable(data.checkoutAvailable === true)
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
      setGame(route.game)
      setCheckoutId(route.checkoutId)
      if (route.view === 'checkout') setCheckoutError('')
      setLoginState('idle')
      setLoginMessage('')
      setCodeTarget('')
      setCode('')
      requestAnimationFrame(() => {
        const hash = window.location.hash
        if (route.view === 'game' || route.view === 'checkout' || hash === '#akun' || hash === '#daftar') window.scrollTo(0, 0)
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
        setView('account')
        setLoginState('error')
        setLoginMessage(error.message)
      } else setSession(next)
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
    if (!session || role !== 'admin' || roleState !== 'ready' || roleToken !== session.access_token) { setAdminCatalog([]); setAdminCatalogState('idle'); return }
    let active = true
    setAdminCatalogState('loading')
    setAdminCatalogError('')
    authHeaders().then((headers) => request('/api/admin/supplier-products', { headers })).then((data) => {
      if (!active) return
      const items = Array.isArray(data.products) ? data.products : []
      setAdminCatalog(items)
      setCatalogDrafts(Object.fromEntries(items.map((item) => [item.sku, { price: item.price == null ? '' : String(item.price), enabled: item.enabled === true }])))
      setAdminCatalogState('ready')
    }).catch((error) => { if (active) { setAdminCatalogError(error.message); setAdminCatalogState('error') } })
    return () => { active = false }
  }, [session?.access_token, role, roleState, roleToken, adminCatalogRetry])

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
        const { error } = await supabase.auth.signInWithPassword({ email: identity.email, password: loginPassword })
        if (error) throw error
        setLoginPassword('')
        setLoginState('idle')
      } else {
        const { error } = await supabase.auth.signInWithOtp({ phone: identity.phone, options: { shouldCreateUser: false } })
        if (error) throw error
        setCodeTarget(identity.phone)
        setCode('')
        setLoginState('sent')
        setLoginMessage('Kode dikirim lewat SMS. Masukkan kodenya di bawah.')
      }
    } catch (error) {
      setLoginState('error')
      setLoginMessage(authErrorMessage(error.message))
    }
  }

  async function sendEmailLink() {
    if (!supabase || loginState === 'loading') return
    const identity = tryParseContact(contact)
    if (!identity.email) return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: identity.email, options: { emailRedirectTo: window.location.origin + '/', shouldCreateUser: false } })
      if (error) throw error
      setLoginState('sent')
      setLoginMessage('Tautan masuk sudah dikirim ke email. Buka tautannya, kamu akan masuk otomatis.')
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
      } else {
        setLoginState('sent')
        setLoginMessage('Akun dibuat. Cek email sekali untuk konfirmasi, lalu masuk pakai email + password.')
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
      setPhoneMessage(session.user.phone_confirmed_at ? 'Profil tersimpan.' : 'Profil tersimpan. Verifikasi nomor HP agar bisa dipakai masuk.')
      setProfileState('ready')
    } catch (error) {
      setProfileState('error')
      setPhoneMessage(error.message || 'Gagal menyimpan data akun.')
    }
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
    setCodeTarget('')
    setCode('')
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
    setSignOutState('idle')
  }

  async function sendPhoneCode() {
    if (!supabase || !session || phoneState === 'loading') return
    setPhoneState('loading')
    setPhoneMessage('')
    try {
      const phone = parseContact(session.user.user_metadata?.requested_phone || '').phone
      if (!phone) throw new Error('Nomor HP pendaftaran tidak valid.')
      const { error } = await supabase.auth.updateUser({ phone })
      if (error) throw error
      setPhoneToVerify(phone)
      setPhoneMessage('Kode SMS dikirim. Nomor belum aktif untuk login sampai kode diverifikasi.')
      setPhoneState('sent')
    } catch (error) {
      setPhoneState('error')
      setPhoneMessage(error.message || 'Gagal mengirim kode SMS.')
    }
  }

  async function confirmPhone(event) {
    event.preventDefault()
    if (!supabase || !session || phoneState === 'loading' || !/^\d{6}$/.test(phoneCode)) return
    setPhoneState('loading')
    setPhoneMessage('')
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: phoneToVerify, token: phoneCode, type: 'phone_change' })
      if (error) throw error
      setPhoneToVerify('')
      setPhoneCode('')
      setPhoneState('ready')
      setPhoneMessage('Nomor HP terverifikasi. Kamu sekarang bisa masuk memakai nomor itu.')
    } catch (error) {
      setPhoneState('error')
      setPhoneMessage(error.message || 'Kode SMS tidak valid.')
    }
  }

  async function verifyPhone(event) {
    event.preventDefault()
    if (!supabase || loginState === 'loading' || !/^\d{6}$/.test(code)) return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: codeTarget, token: code, type: 'sms' })
      if (error) throw error
      window.location.hash = '#akun'
      setCode('')
      setCodeTarget('')
      setLoginState('idle')
    } catch (error) {
      setLoginState('error')
      setLoginMessage(error.message || 'Kode tidak valid. Coba lagi.')
    }
  }

  async function signInGoogle() {
    if (!supabase || loginState === 'loading') return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/' } })
      if (error) throw error
    } catch (error) {
      setLoginState('error')
      setLoginMessage(error.message || 'Login Google gagal. Coba lagi.')
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
        body: JSON.stringify({ productId: selected.id, userId: userId.trim(), zoneId: zoneId.trim() }),
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

  const games = [...new Set(products.map((item) => item.game).filter(Boolean))]
  const catalogMatches = catalogSearch.trim() ? products.filter((item) => matchesCatalog(item, catalogSearch)) : []
  const accountName = session?.user.user_metadata?.username || session?.user.email?.split('@')[0] || 'Akun'
  const accountInitial = String(accountName).trim().charAt(0).toLocaleUpperCase('id-ID') || 'A'
  const filtered = products.filter((item) => item.game === game)
  const selected = products.find((item) => item.id === checkoutId) || null
  const pricingQuery = catalogQuery.trim().toLowerCase()
  const pricingItems = adminCatalog.filter((item) => (catalogShowUnsupported || item.supported) && (catalogFilter === 'semua' || Boolean((catalogDrafts[item.sku] || {}).enabled) === (catalogFilter === 'tampil')) && (!pricingQuery || [item.name, item.sku, item.game, item.category].some((value) => String(value || '').toLowerCase().includes(pricingQuery))))
  const pricingVisible = pricingItems.slice(0, catalogShown)
  const pricingDirty = adminCatalog.filter((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false }; return draft.price !== (item.price == null ? '' : String(item.price)) || (draft.enabled === true) !== (item.enabled === true) }).length

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Lewati navigasi</a>
      <header className="site-header">
        <div className="wrap header-inner">
          <a className="wordmark" href="#main" aria-label="Melonbyte, kembali ke awal"><span>melon</span>byte<span className="wordmark-dot">.</span></a>
          <nav aria-label="Navigasi utama">
            <a href="#katalog">Katalog</a>
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
            <h1 id="hero-title">Mainnya lanjut.<br /><em>Top up-nya di sini.</em></h1>
            <p className="hero-description">Cari layanan digitalmu di katalog. Harga dan ketersediaan mengikuti produk aktif.</p>
            <form className="home-search" role="search" onSubmit={(event) => { event.preventDefault(); document.getElementById('katalog')?.scrollIntoView({ behavior: 'smooth' }) }}>
              <label htmlFor="home-catalog-search">Cari layanan atau nominal</label>
              <div className="home-search-controls"><input id="home-catalog-search" type="search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Cari di katalog" /><button type="submit">Cari</button></div>
            </form>
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
              {['Game', 'Pulsa', 'Hiburan'].map((item) => <button key={item} type="button" className={category === item && !catalogSearch.trim() ? 'active' : ''} aria-pressed={category === item && !catalogSearch.trim()} onClick={() => { setCategory(item); setCatalogSearch('') }}>{item}</button>)}
            </div>
            {catalogState === 'loading' && <div className="notice" role="status">Memuat katalog...</div>}
            {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
            {catalogState === 'ready' && (catalogSearch.trim() ? catalogMatches.length === 0 ? <div className="notice" role="status">{products.length === 0 ? 'Belum ada layanan aktif untuk dicari.' : 'Layanan tidak ditemukan. Coba kata lain.'}</div> : <div className="catalog-results" aria-label="Hasil pencarian katalog">{catalogMatches.map((item) => <button key={item.id} type="button" className="product" onClick={() => { window.location.hash = `#beli/${encodeURIComponent(item.id)}` }}><span className="product-game">{item.game}</span><strong>{item.name}</strong><span className="product-bottom"><span>{rupiah(item.price)}</span><span aria-hidden="true">›</span></span></button>)}</div> : category === 'Game' ? games.length === 0 ? <div className="notice" role="status"><strong>Belum ada game tersedia.</strong><p>Produk tampil di sini setelah aktif di server. Checkout belum tersedia.</p></div> : <div className="game-grid">{games.map((item) => <button key={item} type="button" className="game-card" onClick={() => { window.location.hash = `#game/${encodeURIComponent(item)}` }}><span className="game-initial" aria-hidden="true">{item.slice(0, 2).toUpperCase()}</span><span><strong>{item}</strong><small>Lihat nominal</small></span><span aria-hidden="true">›</span></button>)}</div> : <div className="notice" role="status"><strong>{category} belum tersedia.</strong><p>Belum ada layanan aktif dalam kategori ini. Cek lagi nanti.</p></div>)}
          </div>
        </section>

        </> : view === 'game' ? <section className="checkout-section wrap" id="game-detail" aria-labelledby="game-title">
          <div className="section-heading"><div><a className="back-button" href="#katalog">‹ Semua game</a><h2 id="game-title">{game}</h2></div><p>Pilih nominal, lalu lanjut ke halaman checkout.</p></div>
          {catalogState === 'loading' && <div className="notice" role="status">Memuat nominal...</div>}
          {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
          {catalogState === 'ready' && filtered.length === 0 && <div className="notice" role="status"><strong>Belum ada nominal aktif.</strong><p>Produk baru tampil setelah harga dan stok dikonfigurasi. Checkout belum tersedia.</p></div>}
          {catalogState === 'ready' && filtered.length > 0 && <div className="product-grid">{filtered.map((item) => <button key={item.id} type="button" className="product" onClick={() => { window.location.hash = `#beli/${encodeURIComponent(item.id)}` }}><span className="product-game">{game}</span><strong>{item.name}</strong><span className="product-bottom"><span>{rupiah(item.price)}</span><span aria-hidden="true">›</span></span></button>)}</div>}
        </section> : view === 'checkout' ? <section className="checkout-section wrap" id="data-akun" aria-labelledby="checkout-title">
          <div className="section-heading"><div><a className="back-button" href={selected ? `#game/${encodeURIComponent(selected.game)}` : '#katalog'}>‹ Kembali</a><h2 id="checkout-title">{selected ? selected.game : 'Checkout'}</h2></div><p>Periksa nominal, isi ID akun game tujuan, lalu lanjut ke pembayaran.</p></div>
          {catalogState === 'loading' && <div className="notice" role="status">Memuat produk...</div>}
          {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
          {catalogState === 'ready' && !selected && <div className="notice" role="status"><strong>Produk tidak ditemukan.</strong><p>Produk mungkin sudah tidak aktif. Pilih lagi dari katalog.</p><p><a href="#katalog">Kembali ke katalog</a></p></div>}
          {catalogState === 'ready' && selected && <div className="checkout-layout">
              <form className="checkout-form" onSubmit={checkout}>
                <h3>Data akun game</h3><p>Pastikan ID dan Zone ID sesuai dengan akun Mobile Legends tujuan.</p>
                <div className="field-row"><label>User ID <input value={userId} onChange={(event) => setUserId(event.target.value)} required maxLength="32" inputMode="numeric" pattern="[0-9]+" placeholder="ID akun game" autoComplete="off" /></label><label>Zone ID <input value={zoneId} onChange={(event) => setZoneId(event.target.value)} required maxLength="20" inputMode="numeric" pattern="[0-9]+" placeholder="Zone ID" autoComplete="off" /></label></div>
                <p className="field-hint">User ID dan Zone ID numerik. Jangan masukkan password game.</p>
                {!session && <p className="field-hint">Masuk ke akun Melonbyte dulu agar pesanan tersimpan di akunmu. <a href="#akun">Masuk di sini</a>.</p>}
                {!checkoutAvailable && <p className="field-hint" role="status">Checkout belum tersedia. Integrasi pembayaran dan Digiflazz masih menunggu verifikasi.</p>}
                {checkoutError && <p className="form-error" role="alert">{checkoutError}</p>}
                <button className="checkout-button" type="submit" disabled={!checkoutAvailable || !selected || !session || checkoutState === 'loading'}>{checkoutState === 'loading' ? 'Menyiapkan pembayaran...' : 'Lanjut ke pembayaran'}</button>
                <p className="form-note">Pembayaran lewat Midtrans saat layanan terhubung. Pesanan dikirim setelah pembayaran terkonfirmasi.</p>
              </form>
              <aside className="summary" aria-label="Ringkasan pesanan"><p className="eyebrow">RINGKASAN</p>{selected ? <><div className="summary-item"><span>{selected.game}</span><strong>{selected.name}</strong></div><div className="summary-total"><span>Harga produk</span><strong>{rupiah(selected.price)}</strong></div><p>Biaya pembayaran, jika ada, tampil di halaman pembayaran.</p></> : <p>Pilih nominal untuk melihat ringkasan.</p>}</aside>
            </div>}
        </section> : <div className="account-page wrap" id="akun">
          <h1>{view === 'register' && !session ? 'Daftar akun' : 'Akun saya'}</h1>
          <section className="account-section" aria-labelledby="account-title">
            <div className={session ? 'account-layout account-wide' : 'account-layout'}>
              <div>
                <h2 id="account-title">{session ? 'Profil akun' : view === 'register' ? 'Biar pesananmu gampang dicek.' : 'Masuk ke akun'}</h2>
                <p>{session ? 'Pesanan yang kamu buat tersimpan di akun ini.' : view === 'register' ? 'Daftar pakai email, password, nomor HP, dan username.' : 'Masuk pakai email + password atau nomor HP.'}</p>
                {!session && <p>{view === 'register' ? <>Sudah punya akun? <a href="#akun">Masuk</a></> : <>Belum punya akun? <a href="#daftar">Daftar di sini</a></>}</p>}
              </div>
              <div className="order-panel">
                {!supabase ? <p role={authConfigError ? 'alert' : 'status'}>{authConfigError ? 'Konfigurasi login salah. Gunakan publishable/anon key Supabase; secret/service_role tidak boleh dipakai browser.' : 'Akun belum aktif. Pemilik toko perlu menambahkan konfigurasi Supabase.'}</p> : session ? <>
                  {session.user.email ? <><div className="profile-cols">
                    <div className="profile-col">
                      <form className="profile-form" onSubmit={saveProfile}>
                        <p className="form-title">Ubah profil</p>
                        <div className="profile-field"><label htmlFor="profile-name">Nama</label><input id="profile-name" type="text" autoComplete="name" maxLength="40" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Nama kamu" /></div>
                        <div className="profile-field"><label htmlFor="profile-username">Username</label><input id="profile-username" type="text" autoComplete="nickname" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="username kamu" /></div>
                        <div className="profile-field"><label htmlFor="profile-email">Email</label><input id="profile-email" type="email" value={session.user.email} readOnly /></div>
                        <div className="profile-field"><label htmlFor="profile-phone">Nomor HP</label><input id="profile-phone" type="tel" autoComplete="tel" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." /></div>
                        <button type="submit" className="secondary-button" disabled={profileState === 'loading'}>{profileState === 'loading' ? 'Menyimpan...' : 'Ubah profil'}</button>
                      </form>
                      {session.user.phone_confirmed_at ? <p role="status">Nomor HP terverifikasi: {session.user.phone}</p> : session.user.user_metadata?.requested_phone ? <div className="phone-setup">
                        <p>Nomor HP tersimpan, belum terverifikasi.</p>
                        <button type="button" className="secondary-button" onClick={sendPhoneCode} disabled={phoneState === 'loading'}>{phoneState === 'loading' ? 'Mengirim...' : 'Kirim kode verifikasi SMS'}</button>
                        {phoneToVerify && <form className="code-form" onSubmit={confirmPhone}><label htmlFor="phone-change-code">Kode SMS</label><div className="order-input"><input id="phone-change-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} placeholder="6 digit kode" /><button type="submit" disabled={phoneState === 'loading'}>Verifikasi</button></div></form>}
                      </div> : null}
                      {phoneMessage && <p role={phoneState === 'error' || profileState === 'error' ? 'alert' : 'status'}>{phoneMessage}</p>}
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
                    </div>
                  </div><div className="signout-zone"><p className="signout-hint">Kamu bisa masuk lagi kapan saja dengan email dan kata sandi.</p>{signOutButton}</div></> : <><p>Masuk sebagai <strong>{session.user.phone}</strong></p>{signOutButton}</>}
                </> : view === 'register' ? <>
                  <form className="profile-form" onSubmit={register}>
                    <label htmlFor="register-email">Email</label><input id="register-email" type="email" autoComplete="email" required value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} placeholder="email@contoh.com" />
                    <label htmlFor="register-password">Password</label><input id="register-password" type="password" autoComplete="new-password" minLength="6" required value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} placeholder="minimal 6 karakter" />
                    <label htmlFor="register-phone">Nomor HP</label><input id="register-phone" type="tel" autoComplete="tel" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." />
                    <label htmlFor="register-username">Username</label><input id="register-username" type="text" autoComplete="nickname" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="3–24 huruf, angka, atau _" />
                    <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Memproses...' : 'Daftar akun'}</button>
                  </form>
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Daftar dengan Google</button>
                </> : <>
                  <form onSubmit={signIn}>
                    <label htmlFor="contact">Email atau nomor HP</label>
                    <div className="order-input">
                      <input id="contact" type="text" autoComplete="username" value={contact} onChange={(event) => { setContact(event.target.value); setCodeTarget(''); setCode(''); setLoginMessage(''); setLoginState('idle') }} placeholder="email@contoh.com atau 08..." required />
                      <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Memproses...' : contactIdentity.email ? 'Masuk' : contactIdentity.phone ? 'Kirim kode SMS' : 'Lanjut'}</button>
                    </div>
                    {contactIdentity.email && <label htmlFor="login-password">Password</label>}
                    {contactIdentity.email && <input id="login-password" className="password-input" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="Password akunmu" />}
                  </form>
                  {contactIdentity.email && <button type="button" className="link-button" onClick={sendEmailLink} disabled={loginState === 'loading'}>Masuk tanpa password (kirim tautan ke email)</button>}
                  {codeTarget && <form className="code-form" onSubmit={verifyPhone}>
                    <label htmlFor="sms-code">Kode SMS untuk {codeTarget}</label>
                    <div className="order-input"><input id="sms-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={code} onChange={(event) => setCode(event.target.value)} placeholder="6 digit kode" /><button type="submit" disabled={loginState === 'loading'}>Verifikasi</button></div>
                  </form>}
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Masuk atau daftar dengan Google</button>

                </>}
              </div>
            </div>
          </section>
          {session && <section className="order-section" aria-labelledby="order-title"><div className="order-layout"><div><h2 id="order-title">Riwayat pesanan</h2><p>Status pending berarti pesanan masih diproses. Jangan bayar ulang sebelum mengecek statusnya.</p></div><div className="order-panel">{ordersState === 'loading' ? <p role="status">Memuat pesanan...</p> : ordersState === 'error' ? <p role="alert">Gagal memuat pesanan. {ordersError} <button type="button" onClick={() => setOrdersRetry((value) => value + 1)}>Coba lagi</button></p> : orders.length === 0 ? <p role="status">Belum ada pesanan di akun ini. <a href="#katalog">Lihat katalog</a></p> : <ul className="order-list">{orders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.status}</span><small>#{order.id}</small></li>)}</ul>}</div></div></section>}
          {session && roleState === 'loading' && <p role="status">Memeriksa akses akun...</p>}
          {session && roleState === 'error' && <p role="alert">Akses pengelola belum bisa diperiksa. {roleError} <button type="button" onClick={() => setRoleRetry((value) => value + 1)}>Coba lagi</button></p>}
          {session && roleState === 'ready' && role === 'admin' && roleToken === session.access_token && <section className="order-section" aria-labelledby="admin-title"><div className="order-layout"><div><h2 id="admin-title">Pengelola</h2><p>Pesanan terbaru toko.</p></div><div className="order-panel">{adminState === 'loading' ? <p role="status">Memuat pesanan toko...</p> : adminState === 'error' ? <p role="alert">Gagal memuat pesanan toko. {adminError} <button type="button" onClick={() => setAdminRetry((value) => value + 1)}>Coba lagi</button></p> : adminOrders.length === 0 ? <p role="status">Belum ada pesanan toko.</p> : <ul className="order-list">{adminOrders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.status}</span><small>#{order.id}</small></li>)}</ul>}</div></div></section>}
          {session && roleState === 'ready' && role === 'admin' && roleToken === session.access_token && <section className="order-section" aria-labelledby="pricing-title"><div className="section-heading"><div><h2 id="pricing-title">Harga jual</h2></div><p>Harga supplier adalah modal, tidak tampil ke pembeli. Atur harga jual dan centang produk yang tampil di katalog.</p></div>{adminCatalogState === 'loading' ? <p role="status">Memuat katalog supplier...</p> : adminCatalogState === 'error' ? <p role="alert">Katalog supplier belum bisa dimuat. {adminCatalogError} <button type="button" onClick={() => setAdminCatalogRetry((value) => value + 1)}>Coba lagi</button></p> : adminCatalog.length === 0 ? <p role="status">Belum ada produk supplier aktif.</p> : <><div className="pricing-toolbar"><input type="text" aria-label="Cari produk supplier" placeholder="Cari nama, kode, atau brand" value={catalogQuery} onChange={(event) => { setCatalogQuery(event.target.value); setCatalogShown(24) }} /><div className="category-filter" role="group" aria-label="Saring produk"><button type="button" className={catalogFilter === 'semua' ? 'active' : ''} aria-pressed={catalogFilter === 'semua'} onClick={() => { setCatalogFilter('semua'); setCatalogShown(24) }}>Semua</button><button type="button" className={catalogFilter === 'tampil' ? 'active' : ''} aria-pressed={catalogFilter === 'tampil'} onClick={() => { setCatalogFilter('tampil'); setCatalogShown(24) }}>Tampil</button><button type="button" className={catalogFilter === 'draf' ? 'active' : ''} aria-pressed={catalogFilter === 'draf'} onClick={() => { setCatalogFilter('draf'); setCatalogShown(24) }}>Draf</button></div></div><div className="pricing-meta"><span>Menampilkan {pricingVisible.length} dari {pricingItems.length} produk</span><div className="pricing-meta-actions">{batchNotice && <span role="status">{batchNotice}</span>}<label className="pricing-unsupported"><input type="checkbox" checked={catalogShowUnsupported} onChange={(event) => { setCatalogShowUnsupported(event.target.checked); setCatalogShown(24) }} />Tampilkan yang belum didukung checkout</label>{pricingDirty > 0 && <button type="button" className="secondary-button" onClick={saveAllChanges} disabled={Boolean(catalogBusy)}>Simpan semua ({pricingDirty})</button>}</div></div>{pricingItems.length === 0 ? <p className="pricing-empty" role="status">Tidak ada produk yang cocok. Ubah kata kunci atau saringan.</p> : <><ul className="price-grid">{pricingVisible.map((item) => { const draft = catalogDrafts[item.sku] || { price: '', enabled: false }; return <li key={item.sku} className="price-card"><div className="price-head"><strong>{item.name || item.sku}</strong><small>{item.game || item.sku}{item.category ? ` · ${item.category}` : ''}</small></div><div className="price-row"><span className="price-cost">{item.cost == null ? 'Tidak ada di katalog supplier aktif.' : `Modal ${rupiah(item.cost)}`}</span><label className="price-toggle"><input type="checkbox" checked={draft.enabled} disabled={!item.supported} aria-label={`Tampil di katalog: ${item.name || item.sku}`} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, enabled: event.target.checked } }))} />Tampil</label></div><div className="price-row price-actions"><input type="number" inputMode="numeric" min="1" step="1" placeholder="Harga jual (Rp)" aria-label={`Harga jual ${item.name || item.sku}`} value={draft.price} onChange={(event) => setCatalogDrafts((drafts) => ({ ...drafts, [item.sku]: { ...draft, price: event.target.value } }))} onKeyDown={(event) => { if (event.key === 'Enter') saveSellingPrice(item.sku) }} /><button type="button" className="secondary-button" onClick={() => saveSellingPrice(item.sku)} disabled={Boolean(catalogBusy)}>{catalogBusy === item.sku ? 'Menyimpan...' : 'Simpan'}</button></div>{!item.supported && <p className="price-hint">Belum didukung checkout, jadi belum bisa tampil.</p>}{item.cost != null && Number(draft.price) > 0 && Number(draft.price) < item.cost && <p className="price-warning" role="status">Harga jual di bawah modal.</p>}{catalogNotice.sku === item.sku && <p className="price-hint" role={catalogNotice.error ? 'alert' : 'status'}>{catalogNotice.text}</p>}</li>; })}</ul>{pricingItems.length > pricingVisible.length && <button type="button" className="secondary-button price-more" onClick={() => setCatalogShown((value) => value + 24)}>Tampilkan lebih banyak (sisa {pricingItems.length - pricingVisible.length})</button>}</>}</>}</section>}
        </div>}
      </main>
      <footer className="footer"><div className="wrap footer-inner"><span className="wordmark"><span>melon</span>byte<span className="wordmark-dot">.</span></span><p>Layanan digital. Harga dan ketersediaan mengikuti katalog aktif.</p><a href="#main">Kembali ke atas ↑</a></div></footer>
    </div>
  )
}

export default App
