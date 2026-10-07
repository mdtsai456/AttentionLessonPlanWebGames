// 獨立 HTTP 驗證服務，bfcache 測試不攔截瀏覽器請求。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SITE_ROOT } from './site.mjs';
const port = Number(process.env.E2E_PORT || 18931);
const revoked = new Set();
const fixtures = {
  'student-token': { role: 'student', grade: 'G9', caseId: 'S99', school: 'TEST', studentKey: 'G9_S99' },
  'student2-token': { role: 'student', grade: 'G8', caseId: 'S88', school: 'TEST', studentKey: 'G8_S88' },
  'alternate-token': { role: 'student', grade: 'G8', caseId: 'S77', school: 'T2', studentKey: 'G8_S77' },
  'teacher-token': { role: 'teacher', teacherId: 1, teacherName: '測試', school: 'TEST' },
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (url.pathname === '/__test/revoke') {
    revoked.add(url.searchParams.get('token')); return json(res, 200, {});
  }
  if (url.pathname === '/api/auth/me') {
    if (token.startsWith('expired')) return json(res, 200, { ...fixtures['student-token'], expiresAt: new Date(Date.now() - 1000).toISOString() });
    if (token.startsWith('offline')) return json(res, 503, {});
    if (token.startsWith('slow')) {
      const timer = setTimeout(() => json(res, 200, fixtures['student-token']), 6500);
      res.on('close', () => clearTimeout(timer)); return;
    }
    if (token.startsWith('delayed')) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return json(res, 200, { ...fixtures['student-token'], expiresAt: new Date(Date.now() + 3600000).toISOString() });
    }
    const body = fixtures[token.split('.')[0]];
    if (!body || revoked.has(token)) return json(res, 401, { detail: '請重新登入' });
    return json(res, 200, { ...body, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  }
  if (url.pathname === '/api/auth/logout') { revoked.add(token); res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/sessions') return json(res, 201, { sessionId: 'http-test-session', message: '已接收' });
  if (url.pathname === '/api/attention/me') return json(res, 200, { result: 0 });
  if (url.pathname.startsWith('/api/')) return json(res, 200, { students: [], sessions: [] });
  const file = path.resolve(SITE_ROOT, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(SITE_ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const target = fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' });
    fs.createReadStream(target).pipe(res);
  } catch { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1');
