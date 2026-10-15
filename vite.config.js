import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { isPublicSupabaseKey } from './src/public-key.mjs'

export default defineConfig({
    plugins: [react(), {
        name: 'public-supabase-key-only',
        configResolved(config) {
            const key = config.env.VITE_SUPABASE_ANON_KEY
            if (key && !isPublicSupabaseKey(key)) {
                config.env.VITE_SUPABASE_ANON_KEY = ''
                config.env.VITE_SUPABASE_AUTH_ERROR = 'true'
                if (config.command === 'build') throw new Error('Build diblokir: gunakan publishable/anon key Supabase, bukan secret/service_role.')
            }
        },
    }],
    server: { allowedHosts: ['.trycloudflare.com'], proxy: { '/api': 'http://localhost:3001' } },
})
