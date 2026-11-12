
import { randomUUID, randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';

import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');

export const schema = `CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, notes TEXT NOT NULL,
  photo TEXT NOT NULL DEFAULT '', bought INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS lists (
 id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL, shopper_key TEXT UNIQUE NOT NULL,
 failures INTEGER NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 token TEXT PRIMARY KEY, list_id TEXT NOT NULL, expires BIGINT NOT NULL
)`;
let pool;
let ready;
async function postgres(sql, args) {
  if (!process.env.DATABASE_URL) throw new Error('Missing database connection');
  const {Pool} = await import('pg');
  pool ??= new Pool({connectionString: process.env.DATABASE_URL, max: 3});
  ready ??= pool.query(schema + "; ALTER TABLE gifts ADD COLUMN IF NOT EXISTS list_id TEXT NOT NULL DEFAULT ''").catch(error => { ready = undefined; throw error; });
  await ready;
  return (await pool.query(sql, args)).rows;
}

function authorized(header, key) {
  if (!key || typeof header !== 'string') return false;
  const received = Buffer.from(header);
  const expected = Buffer.from('Bearer ' + key);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function validPhotos(value) {
  if (value === undefined || value === '') return true;
  if (typeof value !== 'string' || value.length > 2800020) return false;
  let photos = [value];
  if (value.startsWith('[')) {
    try { photos = JSON.parse(value); } catch { return false; }
  }
  return photos.length >= 1 && photos.length <= 4 && photos.every(photo =>
    typeof photo === 'string' && photo.length <= 700000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo));
}

export function handler(query = postgres) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    function send(code, data) {
      res.statusCode = code;
      res.end(JSON.stringify(data));
    }
    const mode = new URL(req.url, 'http://localhost').searchParams.get('mode');
    const owner = mode === 'owner';
    if (!owner && mode !== 'shop') return send(400, {error: 'Invalid view.'});
    try {
      const body = req.body ?? {};
      if (owner && req.method === 'POST' && ['register', 'login'].includes(body.action)) {
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = body.password;
        if (!/^[a-z0-9_-]{3,40}$/.test(username) || typeof password !== 'string' || password.length < 10 || password.length > 128) {
          return send(400, {error: 'Use a username of 3–40 letters, numbers, dashes or underscores and a password of 10–128 characters.'});
        }
        let [list] = await query('SELECT * FROM lists WHERE username = $1', [username]);
        if (body.action === 'register') {
          if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) return send(400, {error: 'Enter a list name up to 80 characters.'});
          if (list) return send(409, {error: 'That username is already in use.'});
          const salt = randomBytes(16).toString('hex');
          const hash = (await scrypt(password, salt, 64)).toString('hex');
          const id = randomUUID();
          const inserted = await query('INSERT INTO lists (id, username, name, salt, password_hash, shopper_key) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (username) DO NOTHING RETURNING id',
            [id, username, body.name.trim(), salt, hash, randomBytes(32).toString('hex')]);
          if (!inserted.length) return send(409, {error: 'That username is already in use.'});
          list = {id};
        } else {
          if (list && Number(list.locked_until) > Date.now()) return send(429, {error: 'Too many attempts. Try again in 15 minutes.'});
          const hash = await scrypt(password, list?.salt ?? 'missing-account', 64);
          if (!list || !timingSafeEqual(hash, Buffer.from(list.password_hash, 'hex'))) {
            if (list) await query('UPDATE lists SET failures = failures + 1, locked_until = $1 WHERE id = $2',
              [list.failures >= 4 ? Date.now() + 15 * 60 * 1000 : 0, list.id]);
            return send(401, {error: 'Check your username and password.'});
          }
          await query('UPDATE lists SET failures = 0, locked_until = 0 WHERE id = $1', [list.id]);
        }
        const token = randomBytes(32).toString('hex');
        await query('DELETE FROM sessions WHERE expires < $1', [Date.now()]);
        await query('INSERT INTO sessions (token, list_id, expires) VALUES ($1, $2, $3)', [digest(token), list.id, Date.now() + 7 * 86400000]);
        return send(200, {token});
      }
      const token = typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer /, '') : '';
      let list;
      if (owner) {
        [list] = await query('SELECT lists.id, lists.name, lists.shopper_key FROM lists JOIN sessions ON sessions.list_id = lists.id WHERE sessions.token = $1 AND sessions.expires > $2', [digest(token), Date.now()]);
      } else {
        [list] = await query('SELECT id, name FROM lists WHERE shopper_key = $1', [token]);
      }
      if (!list && authorized(req.headers.authorization, owner ? process.env.OWNER_KEY : process.env.SHOPPER_KEY)) {
        list = {id: '', name: 'My List', shopper_key: process.env.SHOPPER_KEY};
      }
      if (!list) return send(401, {error: owner ? 'Sign in to open your list.' : 'Open the full shopper link you were sent.'});
      if (owner && req.method === 'POST' && body.action === 'logout') {
        await query('DELETE FROM sessions WHERE token = $1', [digest(token)]);
        return send(200, {});
      }
      if (req.method === 'GET') {
        const filter = ' WHERE list_id = $1' + (owner ? '' : ' AND bought = 0');
        const gifts = await query('SELECT id, title, url, notes, photo FROM gifts' + filter + ' ORDER BY created DESC, id', [list.id]);
        return send(200, {gifts, name: list.name, ...(owner && {shopperKey: list.shopper_key})});
      }
      if (req.method !== 'POST') return send(405, {error: 'Unsupported request.'});
      const { action, id, title, url, notes, photo } = req.body ?? {};
      if (!owner && action === 'buy' && typeof id === 'string') {
        const updated = await query('UPDATE gifts SET bought = 1 WHERE id = $1 AND list_id = $2 AND bought = 0 RETURNING id', [id, list.id]);
        return updated.length ? send(200, {}) : send(409, {error: 'That gift is no longer available.'});
      }
      if (!owner) return send(403, {error: 'Editor access is required.'});
      if (action === 'remove' && typeof id === 'string') {
        await query('DELETE FROM gifts WHERE id = $1 AND list_id = $2', [id, list.id]);
        return send(200, {});
      }
      if (action !== 'save' || typeof title !== 'string' || !title.trim() || title.length > 120 ||
          typeof notes !== 'string' || notes.length > 2000 || typeof url !== 'string' || url.length > 2048 ||
          !validPhotos(photo)) {
        return send(400, {error: 'Check the gift name, link, notes, and photo.'});
      }
      let productUrl = '';
      if (url.trim()) {
        let link;
        try { link = new URL(url); } catch { return send(400, {error: 'Enter a full product URL.'}); }
        if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) {
          return send(400, {error: 'Use an HTTP or HTTPS product URL.'});
        }
        productUrl = link.href;
      }
      if (!id && !productUrl && !notes.trim() && !photo) return send(400, {error: 'Add a link, photo, or note.'});
      if (typeof id === 'string' && id) {
        const updated = await query('UPDATE gifts SET title = $1, url = $2, notes = $3, photo = COALESCE($4, photo) WHERE id = $5 AND list_id = $6 RETURNING id',
          [title.trim(), productUrl, notes.trim(), photo ?? null, id, list.id]);
        if (!updated.length) return send(404, {error: 'That gift was removed.'});
      } else {
        await query('INSERT INTO gifts (id, title, url, notes, photo, created, list_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [randomUUID(), title.trim(), productUrl, notes.trim(), photo ?? '', Date.now(), list.id]);
      }
      return send(200, {});
    } catch (error) {
      console.error('Gift operation failed', error.code ?? error.name);
      return send(500, {error: 'The list could not be reached. Try again.'});
    }
  };
}
export default handler();
