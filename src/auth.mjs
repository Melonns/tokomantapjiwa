export async function restoreSession(auth, location, history) {
  const url = new URL(location.href)
  // ponytail: legacy implicit links remain supported; new logins use PKCE.
  const fragment = new URLSearchParams(url.hash.slice(1).replace(/^akun#/, ''))
  const authKeys = ['access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description', 'code', 'sb_flow_id']
  const callback = authKeys.some((key) => url.searchParams.has(key) || fragment.has(key))
  const accessToken = fragment.get('access_token') || url.searchParams.get('access_token')
  const refreshToken = fragment.get('refresh_token') || url.searchParams.get('refresh_token')
  const code = url.searchParams.get('code')
  const flowId = url.searchParams.get('sb_flow_id')
  const failed = url.searchParams.has('error') || fragment.has('error') || fragment.has('error_description')
  if (callback) {
    for (const key of authKeys) url.searchParams.delete(key)
    url.hash = ''
    history.replaceState(history.state, '', url.pathname + url.search)
  }
  try {
    if (failed || (accessToken && !refreshToken)) throw new Error('Invalid callback')
    const { data, error } = accessToken && refreshToken
      ? await auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      : code ? await auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined) : await auth.getSession()
    if (error || (callback && !data.session)) throw new Error('Invalid session')
    return data.session
  } catch {
    throw new Error('Sesi login gagal dibaca. Coba masuk lagi.')
  }
}
