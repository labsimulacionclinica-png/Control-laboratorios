// Service worker: guarda la app y sus bibliotecas para que abra sin internet.
// Al publicar cambios en estos archivos, sube el número de VERSION.
const VERSION = 'tablero-v3';
const PROPIOS = [
  './', 'index.html', 'app.js', 'comun.js', 'shim.js', 'config.js', 'estilos.css', 'manifest.webmanifest',
  'ficha.html', 'ficha.js', 'privacidad.html', 'terminos.html', 'cookies.html',
  'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-180.png', 'icons/favicon-32.png'
];
const EXTERNOS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap'
];
const HOSTS_EXTERNOS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // Cada archivo se guarda por separado: si falta uno, el resto igual queda disponible sin internet
    await Promise.all(PROPIOS.map(u => c.add(u).catch(() => console.warn('No se pudo guardar', u))));
    // Las bibliotecas se intentan una por una: si alguna falla, la app igual se instala
    await Promise.all(EXTERNOS.map(u => fetch(u, { mode: 'cors', credentials: 'omit' }).then(r => r.ok ? c.put(u, r) : null).catch(() => null)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()) if(k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function redPrimero(req, ms){
  const c = await caches.open(VERSION);
  try{
    const r = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), ms))]);
    if(r && r.ok) c.put(req, r.clone());
    return r;
  }catch(e){
    return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? c.match('index.html') : Response.error());
  }
}
async function cachePrimero(req){
  const c = await caches.open(VERSION);
  const hit = await c.match(req);
  if(hit) return hit;
  try{
    const r = await fetch(req);
    if(r && (r.ok || r.type === 'opaque')) c.put(req, r.clone());
    return r;
  }catch(e){ return Response.error(); }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  // El servidor del tablero nunca se guarda en caché: sus datos van por la cola y IndexedDB
  if(/(^|\.)google\.com$|googleusercontent\.com$/.test(url.hostname) && url.hostname !== 'fonts.googleapis.com') return;
  if(url.origin === self.location.origin){ e.respondWith(redPrimero(req, 4000)); return; }
  if(HOSTS_EXTERNOS.includes(url.hostname)){ e.respondWith(cachePrimero(req)); return; }
});
