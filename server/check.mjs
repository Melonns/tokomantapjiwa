// ponytail: cek nickname berjalan per brand. Brand di luar peta ini tidak menampilkan tombol cek,
// dan kode di sini menentukan layanan mana yang dipanggil (ML -> cek ML, FF -> cek FF).
export const checkGames = {
  'MOBILE LEGENDS': { code: 'MLBB' },
  'FREE FIRE': { code: 'FREEFIRE' }, // ponytail: placeholder sampai dokumentasi provider cek FF dipasang.
};

export const maxChecksPerDay = 10;
const timeoutMs = 12000;

export const checkableGame = game => checkGames[String(game || '').toUpperCase()] || null;

export const checkReady = env => Boolean(env.CHECK_API_URL && env.CHECK_API_KEY);

// ponytail: bentuk permintaan ke provider ditulis di satu tempat ini; ganti di sini kalau provider cek berganti.
export function checkRequest(env, game, input) {
  return {
    url: env.CHECK_API_URL,
    options: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.CHECK_API_KEY },
      body: JSON.stringify({ game: game.code, user_id: input.userId, zone_id: input.zoneId }),
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    },
  };
}

// ponytail: bentuk respons mengikuti contoh provider (data.account.nickname/region); sesuaikan saat disambungkan.
export function checkResult(payload) {
  const account = payload?.data?.account;
  const nickname = typeof account?.nickname === 'string' ? account.nickname.trim().slice(0, 120) : '';
  if (!nickname) return null;
  return { nickname, region: typeof account?.region === 'string' ? account.region.trim().slice(0, 40) : '' };
}
