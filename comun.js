// Utilidades compartidas por la pantalla de ingreso, el tablero instalado y la ficha de equipos.
(function(){
  'use strict';
  const CFG = window.TABLERO_CONFIG || {};
  const K = { token: 'tablero_token', usuario: 'tablero_usuario', expira: 'tablero_expira', consentimiento: 'tablero_consentimiento', disp: 'tablero_dispositivo' };
  const ls = {
    get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } },
    set(k, v){ try{ localStorage.setItem(k, v); }catch(e){} },
    del(k){ try{ localStorage.removeItem(k); }catch(e){} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Almacenamiento local (IndexedDB): copias de lectura y cola de cambios ----
  let dbP = null;
  function db(){
    if(!dbP) dbP = new Promise((res, rej) => {
      const r = indexedDB.open('tablero-laboratorios', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('cola', { keyPath: 'n', autoIncrement: true }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tienda = async (n, modo) => (await db()).transaction(n, modo || 'readonly').objectStore(n);
  const kvGet = async k => req((await tienda('kv')).get(k));
  const kvSet = async (k, v) => req((await tienda('kv', 'readwrite')).put(v, k));
  const kvDel = async k => req((await tienda('kv', 'readwrite')).delete(k));
  const colaAdd = async item => req((await tienda('cola', 'readwrite')).add(item));
  const colaTodo = async () => req((await tienda('cola')).getAll());
  const colaDel = async n => req((await tienda('cola', 'readwrite')).delete(n));
  async function borrarTodoLocal(){
    try{ await req((await tienda('kv', 'readwrite')).clear()); }catch(e){}
    try{ await req((await tienda('cola', 'readwrite')).clear()); }catch(e){}
  }

  // ---- Llamadas a la API de Apps Script ----
  class ErrorApi extends Error{ constructor(m, codigo, red){ super(m); this.codigo = codigo || ''; this.red = !!red; } }
  async function api(accion, datos, ms){
    if(!/^https:\/\/script\.google\.com\//.test(CFG.API_URL || '')) throw new ErrorApi('La app todavía no está configurada: falta la dirección de la API en config.js.', 'CONFIG');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 60000);
    let resp;
    try{
      resp = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ accion }, datos || {})),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', cache: 'no-store', signal: ctrl.signal });
    }catch(e){ throw new ErrorApi('No hay conexión con el servidor.', 'RED', true); }
    finally{ clearTimeout(t); }
    let j;
    try{ j = await resp.json(); }
    catch(e){ throw new ErrorApi(resp.ok ? 'El servidor no respondió como se esperaba. Revisa que la API esté publicada para "Cualquier usuario".' : 'El servidor respondió con error ' + resp.status + '.', 'HTTP', resp.status >= 500); }
    if(!j || !j.ok) throw new ErrorApi((j && j.error) || 'Error del servidor.', j && j.codigo);
    return j;
  }

  // ---- Sesión ----
  function sesion(){
    const token = ls.get(K.token), expira = ls.get(K.expira);
    if(!token || !expira || new Date(expira).getTime() <= Date.now()) return null;
    let usuario = {};
    try{ usuario = JSON.parse(ls.get(K.usuario) || '{}'); }catch(e){}
    return { token, expira, usuario };
  }
  function guardarSesion(j){ ls.set(K.token, j.token); ls.set(K.expira, j.expira); ls.set(K.usuario, JSON.stringify(j.usuario || {})); }
  function borrarSesion(){ ls.del(K.token); ls.del(K.expira); ls.del(K.usuario); }
  function dispositivo(){
    let d = ls.get(K.disp);
    if(d) return d;
    const ua = navigator.userAgent || '';
    const so = /Android/i.test(ua) ? (/Mobile/i.test(ua) ? 'Android celular' : 'Android tablet') : /iPad|Macintosh.*Mobile/i.test(ua) ? 'iPad' : /iPhone/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /CrOS/i.test(ua) ? 'Chromebook' : /Linux/i.test(ua) ? 'Linux' : 'Otro';
    const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
    d = `${so} · ${nav} · ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    ls.set(K.disp, d);
    return d;
  }

  // ---- Cola de cambios hechos sin conexión ----
  let vaciando = null;
  async function vaciarCola(alTerminar){
    if(vaciando) return vaciando;
    vaciando = (async () => {
      const ses = sesion();
      if(!ses) return { subidos: 0, quedan: (await colaTodo()).length };
      let subidos = 0;
      const errores = [];
      for(const it of await colaTodo()){
        try{
          await api('llamar', { token: ses.token, fn: it.fn, args: it.args, opId: it.opId, dispositivo: dispositivo() }, 120000);
          await colaDel(it.n); subidos++;
        }catch(e){
          if(e.red || e.codigo === 'SESION' || e.codigo === 'CONFIG' || e.codigo === 'HTTP') break;
          // El servidor rechazó el cambio (por ejemplo, un dato que ya no existe): se saca de la cola y se avisa
          await colaDel(it.n);
          errores.push({ fn: it.fn, error: e.message, f: it.f });
        }
      }
      if(errores.length){ const prev = (await kvGet('cola_errores')) || []; await kvSet('cola_errores', prev.concat(errores).slice(-50)); }
      const quedan = (await colaTodo()).length;
      return { subidos, quedan, errores };
    })();
    try{
      const r = await vaciando;
      if(alTerminar) try{ alTerminar(r); }catch(e){}
      return r;
    } finally { vaciando = null; }
  }

  // ---- Banner de cookies (solo almacenamiento necesario) ----
  function bannerCookies(base){
    base = base || '';
    let c = null;
    try{ c = JSON.parse(ls.get(K.consentimiento) || 'null'); }catch(e){}
    if(c && c.version === CFG.VERSION_POLITICAS) return;
    const pon = () => {
      if(document.getElementById('bannerCookies')) return;
      const b = document.createElement('div');
      b.id = 'bannerCookies'; b.className = 'cookies'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Aviso de cookies');
      b.innerHTML = `<p><b>Usamos solo lo necesario.</b> Esta app guarda en tu dispositivo tu sesión, una copia de los datos para trabajar sin internet y esta elección. No usamos cookies de publicidad ni de analítica.</p>
        <details><summary>Ver qué se guarda</summary><ul>
          <li><b>Sesión</b> (almacenamiento local): un identificador que vence a los 7 días.</li>
          <li><b>Datos sin conexión</b> (IndexedDB y caché): copia del tablero y cambios pendientes por subir.</li>
          <li><b>Preferencias</b>: esta elección y filtros de pantalla.</li>
          <li><b>Terceros</b>: Google (servidor del tablero, fuentes y Drive) y las bibliotecas de cdnjs, jsDelivr y unpkg reciben la dirección IP al descargar archivos.</li>
        </ul></details>
        <div class="acciones"><button type="button" class="btn btn-primario" style="width:auto" id="ckAceptar">Entendido</button>
          <a class="btn btn-sec" href="${base}cookies.html" target="_blank" rel="noopener">Política de cookies</a></div>`;
      document.body.appendChild(b);
      b.querySelector('#ckAceptar').onclick = () => { ls.set(K.consentimiento, JSON.stringify({ version: CFG.VERSION_POLITICAS, fecha: new Date().toISOString(), necesarias: true })); b.remove(); };
    };
    if(document.body) pon(); else document.addEventListener('DOMContentLoaded', pon);
  }

  const normCodigo = s => String(s == null ? '' : s).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

  window.Tablero = { CFG, K, ls, esc, kvGet, kvSet, kvDel, colaAdd, colaTodo, colaDel, borrarTodoLocal, api, ErrorApi, sesion, guardarSesion, borrarSesion, dispositivo, vaciarCola, bannerCookies, normCodigo };
})();
