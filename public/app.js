'use strict';

const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const panesEl = $('panes');
const emptyEl = $('empty');
const hostsEl = $('hosts');
const filterEl = $('filter');

const sessions = new Map();
let activeId = null;
let nextId = 1;
let hosts = [];

// ---------- Sesiones (una pestaña = una terminal) ----------

function openSession(target) {
  const id = nextId++;
  const label = target || 'local';

  const pane = document.createElement('div');
  pane.className = 'pane';
  panesEl.appendChild(pane);

  const tab = document.createElement('div');
  tab.className = 'tab';
  const name = document.createElement('span');
  name.className = 'label';
  name.textContent = label;
  const close = document.createElement('button');
  close.className = 'close';
  close.title = 'Cerrar';
  close.textContent = '×';
  tab.append(name, close);
  tabsEl.appendChild(tab);

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", Menlo, monospace',
    scrollback: 5000,
    theme: { background: '#0d1117', foreground: '#e6edf3' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(pane);

  const session = { id, pane, tab, term, fit, ws: null };
  sessions.set(id, session);

  tab.addEventListener('click', () => activate(id));
  close.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeSession(id);
  });

  activate(id); // la terminal debe estar visible para medir su tamaño

  const qs = new URLSearchParams({ cols: term.cols, rows: term.rows });
  if (target) qs.set('host', target);
  const ws = new WebSocket(`ws://${location.host}/ws?${qs}`);
  session.ws = ws;

  const sendMsg = (msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.onmessage = (ev) => term.write(ev.data);
  ws.onclose = () => {
    term.write('\r\n\x1b[90m[sesión cerrada]\x1b[0m\r\n');
    tab.classList.add('dead');
  };
  term.onData((d) => sendMsg({ t: 'i', d }));
  term.onResize(({ cols, rows }) => sendMsg({ t: 'r', cols, rows }));
}

function activate(id) {
  activeId = id;
  for (const s of sessions.values()) {
    const on = s.id === id;
    s.pane.classList.toggle('active', on);
    s.tab.classList.toggle('active', on);
  }
  emptyEl.hidden = sessions.size > 0;
  const s = sessions.get(id);
  if (s) {
    s.fit.fit();
    s.term.focus();
  }
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.ws) s.ws.close();
  s.term.dispose();
  s.pane.remove();
  s.tab.remove();
  sessions.delete(id);
  if (activeId === id) {
    const last = [...sessions.keys()].pop();
    activate(last ?? null);
  }
}

// Ajusta la terminal visible cuando cambia el tamaño de la ventana.
new ResizeObserver(() => {
  const s = sessions.get(activeId);
  if (s) s.fit.fit();
}).observe(panesEl);

// ---------- Lista de servidores ----------

function renderHosts() {
  const q = filterEl.value.trim().toLowerCase();
  const shown = hosts.filter((h) => `${h.alias} ${h.hostname} ${h.user}`.toLowerCase().includes(q));
  hostsEl.replaceChildren();

  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = hosts.length ? 'Sin coincidencias' : 'No hay servidores en ~/.ssh/config';
    hostsEl.appendChild(li);
    return;
  }

  for (const h of shown) {
    const li = document.createElement('li');
    const alias = document.createElement('span');
    alias.className = 'alias';
    alias.textContent = h.alias;
    li.appendChild(alias);
    const detail = [h.user, h.hostname].filter(Boolean).join('@');
    if (detail) {
      const d = document.createElement('span');
      d.className = 'detail';
      d.textContent = detail;
      li.appendChild(d);
    }
    li.addEventListener('click', () => openSession(h.alias));
    hostsEl.appendChild(li);
  }
}

async function loadHosts() {
  try {
    const res = await fetch('/api/hosts');
    hosts = res.ok ? await res.json() : [];
  } catch {
    hosts = [];
  }
  renderHosts();
}

// ---------- Eventos ----------

$('btn-local').addEventListener('click', () => openSession(null));
$('btn-reload').addEventListener('click', loadHosts);
filterEl.addEventListener('input', renderHosts);

$('form-manual').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const value = $('manual').value.trim();
  if (!value) return;
  openSession(value);
  $('manual').value = '';
});

// Evita cerrar la pestaña del navegador por error con sesiones abiertas.
window.addEventListener('beforeunload', (ev) => {
  const alive = [...sessions.values()].some((s) => s.ws && s.ws.readyState === WebSocket.OPEN);
  if (alive) ev.preventDefault();
});

loadHosts();
