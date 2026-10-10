import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
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
  const [view, setView] = useState(window.location.hash === '#akun' ? 'account' : 'home')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [userId, setUserId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [checkoutState, setCheckoutState] = useState('idle')
  const [checkoutError, setCheckoutError] = useState('')
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('')
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
      const account = window.location.hash === '#akun'
      setView(account ? 'account' : 'home')
      requestAnimationFrame(() => {
        if (account) window.scrollTo(0, 0)
        else document.getElementById(window.location.hash === '#katalog' ? 'katalog' : 'main')?.scrollIntoView()
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
    if (!supabase) return
    setLoginState('loading')
    setLoginMessage('')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin + '/#akun' } })
    setLoginState(error ? 'error' : 'sent')
    setLoginMessage(error ? error.message : 'Tautan masuk dikirim. Buka emailmu, lalu kembali ke halaman ini.')
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
          <h1>Akun saya</h1>
          <section className="account-section" aria-labelledby="account-title"><div className="account-layout"><div><h2 id="account-title">{session ? 'Profil akun' : 'Masuk ke akun'}</h2><p>{session ? 'Pesanan yang kamu buat tersimpan di akun ini.' : 'Gunakan email untuk masuk sebelum membuat pesanan.'}</p></div><div className="order-panel">{!supabase ? <p role="status">Login belum aktif. Pemilik toko perlu menambahkan konfigurasi Supabase.</p> : session ? <><p>Masuk sebagai <strong>{session.user.email}</strong></p><button type="button" className="secondary-button" onClick={() => supabase.auth.signOut()}>Keluar akun</button></> : <form onSubmit={signIn}><label htmlFor="email">Email akun</label><div className="order-input"><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email kamu" required autoComplete="email" /><button type="submit" disabled={loginState === 'loading'}>{loginState === 'loading' ? 'Mengirim...' : 'Kirim tautan masuk'}</button></div>{loginMessage && <p role={loginState === 'error' ? 'alert' : 'status'}>{loginMessage}</p>}</form>}</div></div></section>
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
