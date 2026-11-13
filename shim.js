// Se carga dentro del tablero instalado, antes del código del tablero.
// Reemplaza google.script.run por llamadas a la API, guarda copias para trabajar sin internet
// y pone en cola los cambios hechos sin conexión.
(function(){
  'use strict';
  const T = window.Tablero;
  window.__TABLERO_PWA__ = true;

  // Funciones que cambian datos: nunca se sirven desde la copia guardada
  const ESCRITURA = /^api_(guardar|importar|registrar|reiniciar|cambiar|vaciar|crear|cerrar|movimientos)/;
  const copia = o => JSON.parse(JSON.stringify(o));
  const leer = n => { try{ return (0, eval)(n); }catch(e){ return undefined; } };
  const comoObj = r => { if(typeof r !== 'string') return { o: r, txt: false }; try{ return { o: JSON.parse(r), txt: true }; }catch(e){ return { o: r, txt: false }; } };
  const comoAntes = (o, txt) => txt ? JSON.stringify(o) : o;

  // Aplica un cambio en cola sobre un paquete de datos (prácticas, inventario, activos o alias)
  function aplicarCambio(o, fn, args){
    if(!o || typeof o !== 'object') return;
    try{
      if(fn === 'api_guardarPracticas' && Array.isArray(o.practicas)){
        const d = JSON.parse(args[0]);
        const ids = new Map(o.practicas.map((p, i) => [p.id, i]));
        (d.cambios || []).forEach(p => { if(ids.has(p.id)) o.practicas[ids.get(p.id)] = p; else o.practicas.push(p); });
        const fuera = new Set(d.borrados || []);
        if(fuera.size) o.practicas = o.practicas.filter(p => !fuera.has(p.id));
      }
      if(fn === 'api_movimientos' && o.inv){
        const d = JSON.parse(args[0]);
        (d.deltas || []).forEach(x => {
          for(const k in o.inv) for(const l of (o.inv[k].lotes || [])) if(l.id === x.loteId) l.cantidad = (Number(l.cantidad) || 0) + (Number(x.delta) || 0);
        });
      }
      if(fn === 'api_guardarEnlaceActivo' && Array.isArray(o.activos)){
        const a = o.activos.find(x => x.codigo === args[0]);
        if(a) a.enlace = args[1] || '';
      }
      if(fn === 'api_guardarAlias' && o.alias && typeof o.alias === 'object'){
        if(args[2]) o.alias[args[0]] = { tipo: args[1], clave: args[2] }; else delete o.alias[args[0]];
      }
    }catch(e){ console.warn('No se pudo aplicar un cambio en cola', fn, e); }
  }
  // Respuesta inmediata cuando el cambio queda en cola: la misma forma que daría el servidor
  const EN_COLA = {
    api_guardarPracticas: () => ({ practicas: copia(leer('practicas') || []) }),
    api_movimientos: (args) => { const o = { inv: copia(leer('INV') || {}) }; aplicarCambio(o, 'api_movimientos', args); return o; },
    api_guardarEnlaceActivo: (args) => { const o = { activos: copia(leer('ACTIVOS') || []), cambios: 1 }; aplicarCambio(o, 'api_guardarEnlaceActivo', args); return o; },
    api_guardarAlias: (args) => { const o = { alias: copia(leer('ALIAS') || {}) }; aplicarCambio(o, 'api_guardarAlias', args); return o; }
  };
  async function superponer(r){
    const cola = await T.colaTodo();
    if(!cola.length) return r;
    const { o, txt } = comoObj(r);
    if(!o || typeof o !== 'object') return r;
    cola.forEach(it => aplicarCambio(o, it.fn, it.args));
    return comoAntes(o, txt);
  }
  const nuevoOp = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  async function encolar(fn, args, opId){
    await T.colaAdd({ fn, args: copia(args), opId: opId || nuevoOp(), f: Date.now() });
    estado();
    return EN_COLA[fn](args);
  }

  function irAIngreso(motivo){
    T.borrarSesion();
    location.replace('index.html?' + (motivo === 'salir' ? 'salir=1' : 'vencida=1'));
  }

  async function llamar(fn, args){
    const ses = T.sesion();
    if(!ses){ irAIngreso('vencida'); throw new Error('Tu sesión venció.'); }
    const clave = 'r:' + fn + ':' + JSON.stringify(args);
    const escribe = ESCRITURA.test(fn);
    let pend = 0;
    try{ pend = (await T.colaTodo()).length; }catch(e){}
    if(pend && navigator.onLine){ await T.vaciarCola(alSubir); try{ pend = (await T.colaTodo()).length; }catch(e){} }
    // Mientras haya cambios sin subir, los nuevos van detrás para respetar el orden
    if(EN_COLA[fn] && (pend || !navigator.onLine)) return encolar(fn, args);
    const opId = escribe ? nuevoOp() : '';
    try{
      const j = await T.api('llamar', { token: ses.token, fn, args, opId, dispositivo: T.dispositivo() }, escribe ? 180000 : 120000);
      conectado(true);
      if(!escribe) T.kvSet(clave, { r: j.r, f: Date.now() }).catch(() => {});
      if(fn === 'api_sync') T.kvSet('r:api_init:[]', { r: j.r, f: Date.now() }).catch(() => {});
      return j.r;
    }catch(e){
      if(e.codigo === 'SESION'){ irAIngreso('vencida'); throw e; }
      if(!e.red) throw e;
      conectado(false);
      if(EN_COLA[fn]) return encolar(fn, args, opId);
      if(!escribe){
        let c = await T.kvGet(clave);
        if(!c && fn === 'api_sync') c = await T.kvGet('r:api_init:[]');
        if(!c && fn === 'api_init') c = await T.kvGet('r:api_sync:[]');
        if(c){ marcarCopia(c.f); return superponer(c.r); }
      }
      throw new Error(escribe ? 'No hay internet. Esta acción necesita conexión; inténtalo cuando vuelva la señal.' : 'No hay internet y no hay una copia guardada de esta información.');
    }
  }

  // ---- google.script.run ----
  function corredor(ok, fallo, usuario){
    const base = {
      withSuccessHandler: f => corredor(f, fallo, usuario),
      withFailureHandler: f => corredor(ok, f, usuario),
      withUserObject: u => corredor(ok, fallo, u)
    };
    return new Proxy(base, { get(t, p){
      if(p in t) return t[p];
      if(typeof p !== 'string' || p === 'then') return undefined;
      return (...args) => {
        llamar(p, args).then(r => { if(ok) ok(r, usuario); }, e => {
          const err = e instanceof Error ? e : new Error(String(e));
          if(fallo) fallo(err, usuario); else console.error(err);
        });
      };
    } });
  }
  window.google = window.google || {};
  window.google.script = {
    run: corredor(null, null, undefined),
    host: { close(){}, setHeight(){}, setWidth(){}, editor: { focus(){} } },
    url: { getLocation(cb){ const p = {}; new URLSearchParams(location.search).forEach((v, k) => p[k] = v); cb({ hash: location.hash.slice(1), parameter: p, parameters: {} }); } }
  };

  // ---- Indicador de conexión y cola ----
  let enLinea = navigator.onLine, fechaCopia = 0;
  const est = document.createElement('style');
  est.textContent = `
    #tabRed{ position:fixed; left:10px; bottom:10px; z-index:2147483001; font:600 12px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
    #tabRed > button{ border:1px solid #DCE3DF; background:#fff; color:#4D5551; border-radius:999px; padding:6px 12px; box-shadow:0 3px 10px rgba(0,0,0,.10); cursor:pointer; font:inherit; display:flex; gap:6px; align-items:center; }
    #tabRed > button i{ width:8px; height:8px; border-radius:50%; background:#78B038; display:inline-block; }
    #tabRed.sin > button{ background:#FCE8F1; color:#8A0049; border-color:#F2B8D2; } #tabRed.sin > button i{ background:#D80078; }
    #tabRed.cola > button{ background:#FDF3E2; color:#7A4A00; border-color:#F2D29B; } #tabRed.cola > button i{ background:#E89008; }
    #tabRed .menu{ position:absolute; left:0; bottom:38px; background:#fff; border:1px solid #DCE3DF; border-radius:12px; box-shadow:0 10px 28px rgba(0,0,0,.16); padding:6px; min-width:250px; }
    #tabRed .menu button{ display:block; width:100%; text-align:left; border:0; background:none; padding:9px 10px; border-radius:8px; font:500 13px system-ui,sans-serif; color:#1F2A26; cursor:pointer; }
    #tabRed .menu button:hover{ background:#F2F6F4; }
    #tabRed .menu .info{ padding:8px 10px; font:400 12px system-ui,sans-serif; color:#5F6662; border-bottom:1px solid #EEF2F0; margin-bottom:4px; }
  `;
  function pill(){
    let p = document.getElementById('tabRed');
    if(p || !document.body) return p;
    document.head.appendChild(est);
    p = document.createElement('div'); p.id = 'tabRed';
    p.innerHTML = '<button type="button" aria-haspopup="true"><i></i><span>En línea</span></button>';
    document.body.appendChild(p);
    p.firstChild.onclick = (e) => { e.stopPropagation(); menu(); };
    document.addEventListener('click', () => { const m = p.querySelector('.menu'); if(m) m.remove(); });
    return p;
  }
  async function menu(){
    const p = pill(); if(!p) return;
    let m = p.querySelector('.menu');
    if(m){ m.remove(); return; }
    const ses = T.sesion() || { usuario: {} };
    const n = (await T.colaTodo()).length;
    const errs = (await T.kvGet('cola_errores')) || [];
    m = document.createElement('div'); m.className = 'menu';
    m.innerHTML = `<div class="info">${T.esc(ses.usuario.correo || '')}<br>${enLinea ? 'Conectado' : 'Sin conexión'}${fechaCopia && !enLinea ? ' · datos guardados el ' + new Date(fechaCopia).toLocaleString('es-CO') : ''}<br>${n ? n + ' cambio(s) esperan para subir' : 'Todo está al día'}${ses.expira ? '<br>La sesión vence el ' + new Date(ses.expira).toLocaleDateString('es-CO') : ''}</div>
      <button type="button" data-a="sync">🔄 Subir cambios y actualizar</button>
      ${errs.length ? `<button type="button" data-a="errs">⚠ Ver ${errs.length} cambio(s) que el servidor rechazó</button>` : ''}
      <button type="button" data-a="pol">📄 Políticas y términos</button>
      <button type="button" data-a="salir">🚪 Cerrar sesión en este dispositivo</button>`;
    m.onclick = e => e.stopPropagation();
    p.appendChild(m);
    m.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a; m.remove();
      if(a === 'sync'){ const r = await T.vaciarCola(alSubir); if(!r.subidos && typeof window.sincronizar === 'function') window.sincronizar(false); }
      if(a === 'pol') window.open('privacidad.html', '_blank', 'noopener');
      if(a === 'errs'){ alert(errs.map(x => `${new Date(x.f).toLocaleString('es-CO')} · ${x.fn}: ${x.error}`).join('\n')); await T.kvDel('cola_errores'); }
      if(a === 'salir') salir();
    });
  }
  async function salir(){
    const n = (await T.colaTodo()).length;
    if(n && !confirm(`Hay ${n} cambio(s) sin subir. Si cierras la sesión ahora se pierden. ¿Cerrar de todas formas?`)) return;
    const ses = T.sesion();
    if(ses) T.api('auth_salir', { token: ses.token, dispositivo: T.dispositivo() }, 8000).catch(() => {});
    await T.borrarTodoLocal();
    irAIngreso('salir');
  }
  async function estado(){
    const p = pill(); if(!p) return;
    let n = 0; try{ n = (await T.colaTodo()).length; }catch(e){}
    p.className = !enLinea ? 'sin' : n ? 'cola' : '';
    p.querySelector('span').textContent = !enLinea ? (n ? `Sin conexión · ${n} cambio(s) en cola` : 'Sin conexión') : n ? `${n} cambio(s) por subir` : 'En línea';
  }
  function conectado(v){ if(v !== enLinea){ enLinea = v; estado(); if(v) T.vaciarCola(alSubir); } }
  function marcarCopia(f){ fechaCopia = f || fechaCopia; }
  function alSubir(r){
    estado();
    if(r && r.subidos && typeof window.sincronizar === 'function') setTimeout(() => window.sincronizar(true), 300);
    if(r && r.errores && r.errores.length && typeof window.aviso === 'function') window.aviso(`${r.errores.length} cambio(s) hechos sin conexión no se pudieron guardar. Revisa el detalle en el indicador de conexión.`, 'err');
  }
  window.addEventListener('online', () => { enLinea = true; estado(); T.vaciarCola(alSubir); });
  window.addEventListener('offline', () => { enLinea = false; estado(); });
  setInterval(async () => { if(navigator.onLine && (await T.colaTodo()).length) T.vaciarCola(alSubir); }, 30000);
  document.addEventListener('DOMContentLoaded', () => { estado(); T.bannerCookies(); });

  // Descarga en segundo plano la versión más reciente del tablero (se usa al volver a abrir)
  setTimeout(async () => {
    const ses = T.sesion();
    if(!ses || !navigator.onLine) return;
    try{
      const j = await T.api('app', { token: ses.token, dispositivo: T.dispositivo() }, 90000);
      const prev = await T.kvGet('app_html');
      if(!prev || prev.version !== j.version){
        await T.kvSet('app_html', { html: j.html, version: j.version, fecha: Date.now() });
        if(prev && typeof window.aviso === 'function') window.aviso('Hay una versión nueva del tablero. Se cargará la próxima vez que abras la app.', 'ok');
      }
    }catch(e){ if(e.codigo === 'SESION') irAIngreso('vencida'); }
  }, 8000);
})();
