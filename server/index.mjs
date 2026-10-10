import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createHandler } from './app.mjs';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL wajib diisi.');
const ca = readFileSync(new URL('../prod-ca-2021.crt', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { ca, rejectUnauthorized: true }, max: 10 });
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT tidak valid.');
const server = createServer(createHandler({ pool }));
server.listen(port, () => console.log(`Melonbyte API listening on ${port}`));
process.on('SIGTERM', () => server.close(() => pool.end()));
