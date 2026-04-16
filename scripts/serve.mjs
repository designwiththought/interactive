// Tiny static server for the dist/ directory.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist');
const PORT = Number(process.env.PORT) || 4321;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      let filePath = path.join(DIST, decodeURIComponent(url.pathname));
      if (!filePath.startsWith(DIST)) { res.writeHead(403).end(); return; }

      let stat;
      try { stat = await fs.stat(filePath); } catch { stat = null; }
      if (stat?.isDirectory()) filePath = path.join(filePath, 'index.html');
      if (!stat || stat.isDirectory()) {
        try { await fs.access(filePath); } catch { res.writeHead(404).end('Not found'); return; }
      }

      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'content-type': mime[ext] || 'application/octet-stream' });
      res.end(data);
    } catch (err) {
      console.error(err);
      res.writeHead(500).end('Server error');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer().listen(PORT, () => {
    console.log(`> serving dist/ at http://localhost:${PORT}`);
  });
}
