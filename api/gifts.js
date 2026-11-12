
import { randomUUID, timingSafeEqual } from 'node:crypto';

export const schema = `CREATE TABLE IF NOT EXISTS gifts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, notes TEXT NOT NULL,
  photo TEXT NOT NULL DEFAULT '', bought INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL
)`;
let pool;
let ready;
async function postgres(sql, args) {
  if (!process.env.DATABASE_URL) throw new Error('Missing database connection');
  const {Pool} = await import('pg');
  pool ??= new Pool({connectionString: process.env.DATABASE_URL, max: 3});
  ready ??= pool.query(schema).catch(error => { ready = undefined; throw error; });
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
    if (!authorized(req.headers.authorization, owner ? process.env.OWNER_KEY : process.env.SHOPPER_KEY)) {
      return send(401, {error: owner ? 'Check your editor key.' : 'Open the full shopper link you were sent.'});
    }
    try {
      if (req.method === 'GET') {
        const filter = owner ? '' : ' WHERE bought = 0';
        const gifts = await query('SELECT id, title, url, notes, photo FROM gifts' + filter + ' ORDER BY created DESC, id');
        return send(200, {gifts});
      }
      if (req.method !== 'POST') return send(405, {error: 'Unsupported request.'});
      const { action, id, title, url, notes, photo } = req.body ?? {};
      if (!owner && action === 'buy' && typeof id === 'string') {
        const updated = await query('UPDATE gifts SET bought = 1 WHERE id = $1 AND bought = 0 RETURNING id', [id]);
        return updated.length ? send(200, {}) : send(409, {error: 'That gift is no longer available.'});
      }
      if (!owner) return send(403, {error: 'Editor access is required.'});
      if (action === 'remove' && typeof id === 'string') {
        await query('DELETE FROM gifts WHERE id = $1', [id]);
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
        const updated = await query('UPDATE gifts SET title = $1, url = $2, notes = $3, photo = COALESCE($4, photo) WHERE id = $5 RETURNING id',
          [title.trim(), productUrl, notes.trim(), photo ?? null, id]);
        if (!updated.length) return send(404, {error: 'That gift was removed.'});
      } else {
        await query('INSERT INTO gifts (id, title, url, notes, photo, created) VALUES ($1, $2, $3, $4, $5, $6)',
          [randomUUID(), title.trim(), productUrl, notes.trim(), photo ?? '', Date.now()]);
      }
      return send(200, {});
    } catch (error) {
      console.error('Gift operation failed', error.code ?? error.name);
      return send(500, {error: 'The list could not be reached. Try again.'});
    }
  };
}
export default handler();
