import { createServer } from 'node:http';
import pg from 'pg';
import { createHandler } from './app.mjs';

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL wajib diisi.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true }, max: 10 });
const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT tidak valid.');
const server = createServer(createHandler({ pool }));
server.listen(port, () => console.log(`Melonbyte API listening on ${port}`));
process.on('SIGTERM', () => server.close(() => pool.end()));
