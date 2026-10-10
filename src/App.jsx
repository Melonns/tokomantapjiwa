import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { parseContact, parseRegistration } from './contact.mjs'
import './store.css'

const supabase = import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null
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

function App() {
  const [products, setProducts] = useState([])
  const [checkoutAvailable, setCheckoutAvailable] = useState(false)
  const [catalogState, setCatalogState] = useState('loading')
  const [catalogError, setCatalogError] = useState('')
  const [game, setGame] = useState(null)
  const [category, setCategory] = useState('Game')
  const [view, setView] = useState(window.location.hash === '#daftar' ? 'register' : window.location.hash === '#akun' ? 'account' : 'home')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [userId, setUserId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [checkoutState, setCheckoutState] = useState('idle')
  const [checkoutError, setCheckoutError] = useState('')
  const [session, setSession] = useState(null)
  const [contact, setContact] = useState('')
  const [registerEmail, setRegisterEmail] = useState('')
  const [registerPhone, setRegisterPhone] = useState('')
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
  const [roleState, setRoleState] = useState('idle')
  const [roleError, setRoleError] = useState('')
  const [roleRetry, setRoleRetry] = useState(0)

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
      const hash = window.location.hash
      setView(hash === '#daftar' ? 'register' : hash === '#akun' ? 'account' : 'home')
      setLoginState('idle')
      setLoginMessage('')
      setCodeTarget('')
      setCode('')
      requestAnimationFrame(() => {
        if (hash === '#akun' || hash === '#daftar') window.scrollTo(0, 0)
        else document.getElementById(hash === '#katalog' ? 'katalog' : 'main')?.scrollIntoView()
      })
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => {
    if (game && view === 'home') requestAnimationFrame(() => document.getElementById('game-detail')?.scrollIntoView({ behavior: 'smooth' }))
  }, [game, view])
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener.subscription.unsubscribe()
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

  async function signIn(event) {
    event.preventDefault()
    if (!supabase || loginState === 'loading') return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const identity = parseContact(contact)
      const credentials = identity.email
        ? { email: identity.email, options: { emailRedirectTo: window.location.origin + '/#akun', shouldCreateUser: false } }
        : { phone: identity.phone, options: { shouldCreateUser: false } }
      const { error } = await supabase.auth.signInWithOtp(credentials)
      if (error) throw error
      setCodeTarget(identity.phone || '')
      setCode('')
      setLoginState('sent')
      setLoginMessage(identity.phone ? 'Kode dikirim lewat SMS. Masukkan kodenya di bawah.' : 'Cek email untuk tautan masuk, lalu kembali ke halaman akun.')
    } catch (error) {
      setLoginState('error')
      setLoginMessage(error.message || 'Gagal mengirim kode. Coba lagi.')
    }
  }

  async function register(event) {
    event.preventDefault()
    if (!supabase || loginState === 'loading') return
    setLoginState('loading')
    setLoginMessage('')
    try {
      const { email, requested_phone, username } = parseRegistration(registerEmail, registerPhone, registerUsername)
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin + '/#akun',
          shouldCreateUser: true,
          data: { username, requested_phone },
        },
      })
      if (error) throw error
      setLoginState('sent')
      setLoginMessage('Cek email untuk tautan verifikasi. Nomor HP belum terverifikasi dan belum bisa dipakai masuk. Setelah masuk, verifikasi nomor lewat kode SMS di halaman akun.')
    } catch (error) {
      setLoginState('error')
      setLoginMessage(error.message || 'Pendaftaran gagal. Coba lagi.')
    }
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (!supabase || !session || profileState === 'loading') return
    setProfileState('loading')
    setPhoneMessage('')
    try {
      const { requested_phone, username } = parseRegistration(session.user.email || '', registerPhone, registerUsername)
      const { error } = await supabase.auth.updateUser({ data: { ...session.user.user_metadata, username, requested_phone } })
      if (error) throw error
      setPhoneMessage('Data tersimpan. Verifikasi nomor HP agar bisa dipakai masuk.')
      setProfileState('ready')
    } catch (error) {
      setProfileState('error')
      setPhoneMessage(error.message || 'Gagal menyimpan data akun.')
    }
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
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/#akun' } })
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

  const games = [...new Set(products.map((item) => item.game).filter(Boolean))]
  const filtered = products.filter((item) => item.game === game &&
    item.name.toLocaleLowerCase('id-ID').includes(search.toLocaleLowerCase('id-ID')))

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Lewati navigasi</a>
      <header className="site-header">
        <div className="wrap header-inner">
          <a className="wordmark" href="#main" aria-label="Melonbyte, kembali ke awal"><span>melon</span>byte<span className="wordmark-dot">.</span></a>
          <nav aria-label="Navigasi utama">
            <a href="#katalog">Katalog</a>
            <a href="#akun" aria-current={view === 'account' ? 'page' : undefined}>{session ? 'Akun saya' : 'Masuk'}</a>
            {!session && <a href="#daftar" aria-current={view === 'register' ? 'page' : undefined}>Daftar</a>}
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
              {['Game', 'Pulsa', 'Hiburan'].map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} aria-pressed={category === item} onClick={() => { setCategory(item); setGame(null); setSelected(null) }}>{item}</button>)}
            </div>
            {category === 'Game' ? <>
              {catalogState === 'loading' && <div className="notice" role="status">Memuat katalog game...</div>}
              {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
              {catalogState === 'ready' && games.length === 0 ? <div className="notice" role="status"><strong>Belum ada game tersedia.</strong><p>Produk tampil di sini setelah aktif di server. Checkout belum tersedia.</p></div> : <div className="game-grid">{games.map((item) => <button key={item} type="button" className={`game-card ${game === item ? 'selected' : ''}`} aria-pressed={game === item} onClick={() => { setGame(item); setSelected(null); setSearch(''); setCheckoutError('') }}><span className="game-initial" aria-hidden="true">{item.slice(0, 2).toUpperCase()}</span><span><strong>{item}</strong><small>Lihat nominal</small></span><span aria-hidden="true">›</span></button>)}</div>}
            </> : <div className="notice" role="status"><strong>{category} belum tersedia.</strong><p>Belum ada layanan aktif dalam kategori ini. Cek lagi nanti.</p></div>}
          </div>
        </section>

        {category === 'Game' && game && <section className="checkout-section wrap" id="game-detail" aria-labelledby="checkout-title">
          <div className="section-heading"><div><button type="button" className="back-button" onClick={() => { setGame(null); setSelected(null); requestAnimationFrame(() => document.getElementById('katalog')?.scrollIntoView({ behavior: 'smooth' })) }}>‹ Semua game</button><h2 id="checkout-title">{game}</h2></div><p>Pilih nominal, lalu isi ID akun game tujuan di sini.</p></div>
          {catalogState === 'loading' && <div className="notice" role="status">Memuat nominal...</div>}
          {catalogState === 'error' && <div className="notice" role="alert"><p>Katalog belum bisa dimuat. {catalogError}</p><button type="button" onClick={loadProducts}>Coba muat lagi</button></div>}
          {catalogState === 'ready' && products.filter((item) => item.game === game).length === 0 && <div className="notice" role="status"><strong>Belum ada nominal aktif.</strong><p>Produk baru tampil setelah harga dan stok dikonfigurasi. Checkout belum tersedia.</p></div>}
          {catalogState === 'ready' && products.some((item) => item.game === game) && <>
            <label className="search-field"><span className="sr-only">Cari nominal</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nominal" type="search" /></label>
            {filtered.length === 0 ? <div className="notice" role="status">Nominal tidak ditemukan. Ubah kata kunci pencarian.</div> : <div className="product-grid">{filtered.map((item) => <button key={item.id} type="button" className={`product ${selected?.id === item.id ? 'selected' : ''}`} aria-pressed={selected?.id === item.id} onClick={() => { setSelected(item); setCheckoutError('') }}><span className="product-game">{game}</span><strong>{item.name}</strong><span className="product-bottom"><span>{rupiah(item.price)}</span><span aria-hidden="true">{selected?.id === item.id ? 'Terpilih' : '+'}</span></span></button>)}</div>}
            <div className="checkout-layout" id="data-akun">
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
            </div>
          </>}
        </section>}
        </> : <div className="account-page wrap" id="akun">
          <h1>{view === 'register' && !session ? 'Daftar akun' : 'Akun saya'}</h1>
          <section className="account-section" aria-labelledby="account-title">
            <div className="account-layout">
              <div>
                <h2 id="account-title">{session ? 'Profil akun' : view === 'register' ? 'Buat akun buyer' : 'Masuk ke akun'}</h2>
                <p>{session ? 'Pesanan yang kamu buat tersimpan di akun ini.' : view === 'register' ? 'Isi email, nomor HP, dan username. Verifikasi email dulu, lalu nomor HP lewat SMS.' : 'Pakai email atau nomor HP yang sudah terdaftar.'}</p>
                {!session && <p>{view === 'register' ? <>Sudah punya akun? <a href="#akun">Masuk</a></> : <>Belum punya akun? <a href="#daftar">Daftar di sini</a></>}</p>}
              </div>
              <div className="order-panel">
                {!supabase ? <p role="status">Akun belum aktif. Pemilik toko perlu menambahkan konfigurasi Supabase.</p> : session ? <>
                  <p>Masuk sebagai <strong>{session.user.email || session.user.phone}</strong></p>
                  {session.user.user_metadata?.username && <p>Username: <strong>{session.user.user_metadata.username}</strong></p>}
                  {session.user.phone_confirmed_at ? <p role="status">Nomor HP terverifikasi: {session.user.phone}</p> : session.user.user_metadata?.requested_phone ? <div className="phone-setup">
                    <p>Nomor HP pendaftaran: {session.user.user_metadata.requested_phone} (belum terverifikasi).</p>
                    <button type="button" className="secondary-button" onClick={sendPhoneCode} disabled={phoneState === 'loading'}>{phoneState === 'loading' ? 'Mengirim...' : 'Kirim kode verifikasi SMS'}</button>
                    {phoneToVerify && <form className="code-form" onSubmit={confirmPhone}><label htmlFor="phone-change-code">Kode SMS</label><div className="order-input"><input id="phone-change-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} placeholder="6 digit kode" /><button type="submit" disabled={phoneState === 'loading'}>Verifikasi</button></div></form>}
                  </div> : session.user.email ? <form className="profile-form" onSubmit={saveProfile}>
                    <p>Lengkapi profil agar nomor HP bisa diverifikasi.</p>
                    <label htmlFor="profile-username">Username</label><input id="profile-username" type="text" autoComplete="nickname" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} />
                    <label htmlFor="profile-phone">Nomor HP</label><input id="profile-phone" type="tel" autoComplete="tel" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." />
                    <button type="submit" className="secondary-button" disabled={profileState === 'loading'}>{profileState === 'loading' ? 'Menyimpan...' : 'Simpan data akun'}</button>
                  </form> : null}
                  {phoneMessage && <p role={phoneState === 'error' || profileState === 'error' ? 'alert' : 'status'}>{phoneMessage}</p>}
                  <button type="button" className="secondary-button" onClick={() => supabase.auth.signOut()}>Keluar akun</button>
                </> : view === 'register' ? <>
                  <form className="profile-form" onSubmit={register}>
                    <label htmlFor="register-email">Email</label><input id="register-email" type="email" autoComplete="email" required value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} placeholder="email@contoh.com" />
                    <label htmlFor="register-phone">Nomor HP</label><input id="register-phone" type="tel" autoComplete="tel" required value={registerPhone} onChange={(event) => setRegisterPhone(event.target.value)} placeholder="08..." />
                    <label htmlFor="register-username">Username</label><input id="register-username" type="text" autoComplete="nickname" minLength="3" maxLength="24" pattern="[a-zA-Z0-9_]+" required value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} placeholder="3–24 huruf, angka, atau _" />
                    <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Mengirim...' : 'Daftar lewat email'}</button>
                    <p className="auth-note">Nomor HP belum aktif untuk masuk sampai kamu verifikasi lewat SMS setelah mengonfirmasi email.</p>
                  </form>
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Daftar dengan Google</button>
                  <p className="auth-note">Sesudah masuk lewat Google, lengkapi username dan nomor HP di halaman akun.</p>
                </> : <>
                  <form onSubmit={signIn}>
                    <label htmlFor="contact">Email atau nomor HP</label>
                    <div className="order-input">
                      <input id="contact" type="text" autoComplete="username" value={contact} onChange={(event) => { setContact(event.target.value); setCodeTarget(''); setCode(''); setLoginMessage(''); setLoginState('idle') }} placeholder="email@contoh.com atau 08..." required />
                      <button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Mengirim...' : 'Kirim kode atau tautan'}</button>
                    </div>
                    <p className="auth-note">Nomor 08... otomatis memakai kode SMS. Email memakai tautan masuk.</p>
                  </form>
                  {codeTarget && <form className="code-form" onSubmit={verifyPhone}>
                    <label htmlFor="sms-code">Kode SMS untuk {codeTarget}</label>
                    <div className="order-input"><input id="sms-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={code} onChange={(event) => setCode(event.target.value)} placeholder="6 digit kode" /><button type="submit" disabled={loginState === 'loading'}>Verifikasi</button></div>
                  </form>}
                  {loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}
                  <div className="auth-divider">atau</div>
                  <button type="button" className="secondary-button google-button" onClick={signInGoogle} disabled={loginState === 'loading'}>Masuk atau daftar dengan Google</button>
                  <p className="auth-note">SMS dan Google perlu diaktifkan pemilik toko di Supabase. Akun baru selalu menjadi buyer.</p>
                </>}
              </div>
            </div>
          </section>
          {session && <section className="order-section" aria-labelledby="order-title"><div className="order-layout"><div><h2 id="order-title">Riwayat pesanan</h2><p>Status pending berarti pesanan masih diproses. Jangan bayar ulang sebelum mengecek statusnya.</p></div><div className="order-panel">{ordersState === 'loading' ? <p role="status">Memuat pesanan...</p> : ordersState === 'error' ? <p role="alert">Gagal memuat pesanan. {ordersError} <button type="button" onClick={() => setOrdersRetry((value) => value + 1)}>Coba lagi</button></p> : orders.length === 0 ? <p role="status">Belum ada pesanan di akun ini. <a href="#katalog">Lihat katalog</a></p> : <ul className="order-list">{orders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.status}</span><small>#{order.id}</small></li>)}</ul>}</div></div></section>}
          {session && roleState === 'loading' && <p role="status">Memeriksa akses akun...</p>}
          {session && roleState === 'error' && <p role="alert">Akses pengelola belum bisa diperiksa. {roleError} <button type="button" onClick={() => setRoleRetry((value) => value + 1)}>Coba lagi</button></p>}
          {session && roleState === 'ready' && role === 'admin' && roleToken === session.access_token && <section className="order-section" aria-labelledby="admin-title"><div className="order-layout"><div><h2 id="admin-title">Pengelola</h2><p>Pesanan terbaru. Tindakan transaksi dan perubahan produk belum tersedia di halaman ini.</p></div><div className="order-panel">{adminState === 'loading' ? <p role="status">Memuat pesanan toko...</p> : adminState === 'error' ? <p role="alert">Gagal memuat pesanan toko. {adminError} <button type="button" onClick={() => setAdminRetry((value) => value + 1)}>Coba lagi</button></p> : adminOrders.length === 0 ? <p role="status">Belum ada pesanan toko.</p> : <ul className="order-list">{adminOrders.map((order) => <li key={order.id}><strong>{order.productName}</strong><span>{rupiah(order.price)} · {order.status}</span><small>#{order.id}</small></li>)}</ul>}</div></div></section>}
        </div>}
      </main>
      <footer className="footer"><div className="wrap footer-inner"><span className="wordmark"><span>melon</span>byte<span className="wordmark-dot">.</span></span><p>Layanan digital. Harga dan ketersediaan mengikuti katalog aktif.</p><a href="#main">Kembali ke atas ↑</a></div></footer>
    </div>
  )
}

export default App
