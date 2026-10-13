import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT || '5173');
const VITE_PORT = PORT + 1;
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (!process.env.BASE_PATH) process.env.BASE_PATH = '/';

const vite = spawn(
  'pnpm',
  ['--filter', '@workspace/lead-crm', 'run', 'dev'],
  {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(VITE_PORT) },
    cwd: WORKSPACE,
  }
);
vite.on('exit', (code) => process.exit(code ?? 0));

const server = http.createServer((req, res) => {
  const opts = {
    hostname: '127.0.0.1',
    port: VITE_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${VITE_PORT}` },
  };
  const pr = http.request(opts, (pr2) => {
    res.writeHead(pr2.statusCode, pr2.headers);
    pr2.pipe(res, { end: true });
  });
  pr.on('error', () => {
    res.writeHead(502);
    res.end('vite starting…');
  });
  req.pipe(pr, { end: true });
});

server.on('upgrade', (req, socket, head) => {
  const conn = net.createConnection({ host: '127.0.0.1', port: VITE_PORT }, () => {
    const headers = Object.entries({ ...req.headers, host: `localhost:${VITE_PORT}` })
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    conn.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head && head.length) conn.write(head);
    socket.pipe(conn);
    conn.pipe(socket);
  });
  conn.on('error', () => socket.destroy());
  socket.on('error', () => conn.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[health-start] proxy :${PORT} -> vite :${VITE_PORT}`);
});
