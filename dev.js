import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handler, schema } from './api/gifts.js';

process.env.OWNER_KEY ??= 'local-editor';
process.env.SHOPPER_KEY ??= 'local-shopper';
const db = new DatabaseSync('christmas.sqlite');
db.exec(schema);
if (!db.prepare('PRAGMA table_info(gifts)').all().some(column => column.name === 'list_id')) {
  db.exec("ALTER TABLE gifts ADD COLUMN list_id TEXT NOT NULL DEFAULT ''");
}
const api = handler((sql, args = []) => db.prepare(sql.replace(/\$\d+/g, '?')).all(...args));
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/owner', ['index.html', 'text/html']],
  ['/shop', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']]
]);
createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/gifts') {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2900000) return res.writeHead(413).end();
      }
      try { req.body = JSON.parse(body); } catch { return res.writeHead(400).end(); }
    }
    return api(req, res);
  }
  const asset = assets.get(pathname);
  if (!asset) return res.writeHead(404).end();
  const content = await readFile(new URL('./public/' + asset[0], import.meta.url));
  res.writeHead(200, {'Content-Type': asset[1] + '; charset=utf-8'}).end(content);
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173/owner'));
