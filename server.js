'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

// Solo escucha en la propia maquina: nadie de la red puede entrar.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 7681;
const TOKEN_FILE = path.join(__dirname, '.token');
const COOKIE = 'tw_token';
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// ---------- Token de acceso (se crea una vez y se guarda en .token) ----------

function loadToken() {
  try {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved.length >= 32) return saved;
  } catch {}
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  return token;
}

const TOKEN = loadToken();

function sameToken(value) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hasValidCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return sameToken(rest.join('='));
  }
  return false;
}

// ---------- Lectura de ~/.ssh/config para listar los servidores ----------

function readSshHosts() {
  let text;
  try {
    text = fs.readFileSync(path.join(os.homedir(), '.ssh', 'config'), 'utf8');
  } catch {
    return [];
  }
  const hosts = [];
  let current = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+?)(?:\s*=\s*|\s+)(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'host') {
      current = value
        .split(/\s+/)
        .filter((alias) => alias && !/[*?!]/.test(alias))
        .map((alias) => ({ alias, hostname: '', user: '' }));
      hosts.push(...current);
    } else if (key === 'match') {
      current = [];
    } else if (key === 'hostname') {
      current.forEach((h) => (h.hostname = h.hostname || value));
    } else if (key === 'user') {
      current.forEach((h) => (h.user = h.user || value));
    }
  }
  return hosts;
}

// Acepta "alias", "host", "usuario@host" y "usuario@host:puerto".
// El formato estricto evita que se cuelen opciones de ssh (por ejemplo -oProxyCommand).
function parseTarget(target) {
  if (typeof target !== 'string' || target.length > 255) return null;
  const m = target.match(/^(?:([A-Za-z0-9_][A-Za-z0-9._-]*)@)?([A-Za-z0-9_][A-Za-z0-9._-]*)(?::(\d{1,5}))?$/);
  if (!m) return null;
  const [, user, host, port] = m;
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  const args = [];
  if (port) args.push('-p', port);
  args.push('--', user ? `${user}@${host}` : host);
  return args;
}

// ---------- Servidor HTTP ----------

const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/vendor/xterm.js': ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript; charset=utf-8'],
  '/vendor/xterm.css': ['node_modules/@xterm/xterm/css/xterm.css', 'text/css; charset=utf-8'],
  '/vendor/addon-fit.js': ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript; charset=utf-8'],
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  // Bloquea ataques de DNS rebinding: solo se atiende a localhost.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, 'Host no permitido');
  if (req.method !== 'GET') return send(res, 405, 'Metodo no permitido');

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Primer ingreso con ?token=...: se guarda en una cookie y se limpia la URL.
  if (url.searchParams.has('token')) {
    if (!sameToken(url.searchParams.get('token'))) return send(res, 401, 'Token incorrecto');
    return send(res, 302, '', {
      Location: '/',
      'Set-Cookie': `${COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
    });
  }

  if (!hasValidCookie(req)) {
    return send(res, 401, 'Sin acceso. Abre la URL con token que aparece en la consola al iniciar el servidor.');
  }

  if (url.pathname === '/api/hosts') {
    return send(res, 200, JSON.stringify(readSshHosts()), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  const entry = STATIC[url.pathname];
  if (!entry) return send(res, 404, 'No encontrado');
  fs.readFile(path.join(__dirname, entry[0]), (err, data) => {
    if (err) return send(res, 500, 'No se pudo leer el archivo');
    send(res, 200, data, { 'Content-Type': entry[1] });
  });
});

// ---------- WebSocket: cada conexion es una terminal ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const host = req.headers.host;
  const url = new URL(req.url, `http://${host}`);
  const ok =
    ALLOWED_HOSTS.has(host) &&
    req.headers.origin === `http://${host}` && // solo la propia pagina puede abrir terminales
    hasValidCookie(req) &&
    url.pathname === '/ws';
  if (!ok) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => startSession(ws, url.searchParams));
});

function clamp(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function startSession(ws, params) {
  const target = params.get('host');
  let file = process.env.SHELL || '/bin/bash';
  let args = [];

  if (target) {
    args = parseTarget(target);
    if (!args) {
      ws.send('\r\nDestino no valido. Usa un alias, host o usuario@host[:puerto].\r\n');
      return ws.close();
    }
    file = 'ssh';
  }

  let term;
  try {
    term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: clamp(params.get('cols'), 2, 500, 80),
      rows: clamp(params.get('rows'), 2, 300, 24),
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
  } catch (err) {
    ws.send(`\r\nNo se pudo iniciar la terminal: ${err.message}\r\n`);
    return ws.close();
  }

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  term.onExit(() => {
    if (ws.readyState === ws.OPEN) ws.close();
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === 'i' && typeof msg.d === 'string') {
      term.write(msg.d);
    } else if (msg.t === 'r') {
      try {
        term.resize(clamp(msg.cols, 2, 500, 80), clamp(msg.rows, 2, 300, 24));
      } catch {}
    }
  });

  ws.on('close', () => {
    try {
      term.kill();
    } catch {}
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya esta en uso: la terminal web ya esta corriendo, o usa otro puerto con PORT=7682 npm start`);
  } else {
    console.error(`No se pudo iniciar el servidor: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('Terminal web lista. Abre esta URL en tu navegador:');
  console.log(`\n  http://${HOST}:${PORT}/?token=${TOKEN}\n`);
  console.log('Solo acepta conexiones desde esta maquina. Ctrl+C para detener.');
});
