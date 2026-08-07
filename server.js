import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const WEBSITE_DIR = join(__dirname, 'website');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

async function serveFile(res, filePath, contentType) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType || 'text/plain',
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(data);
  } catch (err) {
    // Fallback to 404.html if available
    try {
      const fallbackData = await readFile(join(WEBSITE_DIR, '404.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fallbackData);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Healthcheck endpoint for Railway
  if (pathname === '/health' || pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  }

  // Rewrites matching vercel.json
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, join(WEBSITE_DIR, 'index.html'), MIME_TYPES['.html']);
  }
  if (pathname === '/app' || pathname === '/app.html') {
    return serveFile(res, join(WEBSITE_DIR, 'app.html'), MIME_TYPES['.html']);
  }
  if (pathname.startsWith('/@') || pathname === '/tip.html') {
    return serveFile(res, join(WEBSITE_DIR, 'tip.html'), MIME_TYPES['.html']);
  }

  // Serve static files from website directory
  const ext = extname(pathname);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const targetPath = join(WEBSITE_DIR, pathname);

  return serveFile(res, targetPath, mime);
});

server.listen(PORT, () => {
  console.log(`ArcTip server listening on port ${PORT}`);
});
