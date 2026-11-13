// Ficha de un equipo: se abre al escanear el QR de la etiqueta con la cámara del celular o la tablet.
(function(){
  'use strict';
  const T = window.Tablero;
  const $ = id => document.getElementById(id);
  const cont = $('contenido');
  const codigo = (new URLSearchParams(location.search).get('c') || '').trim();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  T.bannerCookies();

  const ses = T.sesion();
  if(!codigo){ cont.innerHTML = '<p class="mensaje err">El enlace no trae el código del equipo.</p>'; return; }
  // Para ver la ficha hay que entrar con el correo institucional
  if(!ses){ location.replace('index.html?volver=' + encodeURIComponent('ficha.html?c=' + encodeURIComponent(codigo))); return; }

  const esEnlace = v => /^https:\/\/([a-z0-9-]+\.)*google\.com\/\S*$/i.test(String(v || '').trim());
  const FILAS = [['placa', 'Placa de inventario'], ['serie', 'Serie'], ['marca', 'Marca'], ['modelo', 'Modelo'], ['tipo', 'Tipo'],
    ['laboratorio', 'Ubicación'], ['sede', 'Sede'], ['piso', 'Piso'], ['descripcion', 'Detalle'], ['observacion', 'Observación'], ['cantidad', 'Cantidad']];

  function pintar(a, puedeEditar, aviso, tipo){
    cont.innerHTML = `<article class="ficha">
      ${aviso ? `<p class="mensaje ${tipo || 'info'}" style="margin:0 0 12px">${T.esc(aviso)}</p>` : ''}
      <div class="codigo">${T.esc(a.codigo)}</div>
      <h1>${T.esc(a.nombre)}</h1>
      ${a.enlace ? `<a class="btn-docs" href="${T.esc(a.enlace)}" target="_blank" rel="noopener">📁 Documentos del equipo</a>`
        : `<p><span class="pendiente">Documentos pendientes</span> Este equipo todavía no tiene enlace a su carpeta de Drive.</p>`}
      <dl>${FILAS.filter(([k]) => a[k] !== '' && a[k] != null).map(([k, l]) => `<dt>${l}</dt><dd>${T.esc(a[k])}</dd>`).join('')}</dl>
      ${puedeEditar ? `<form id="fEnlace" novalidate>
        <div class="campo"><label for="enlace">${a.enlace ? 'Cambiar el enlace de documentos' : 'Agregar el enlace de documentos'} (Google Drive)</label>
        <input type="url" id="enlace" value="${T.esc(a.enlace || '')}" placeholder="https://drive.google.com/drive/folders/..."></div>
        <button class="btn btn-primario" type="submit" id="bEnlace">Guardar enlace</button>
        <div id="msgEnlace" class="mensaje oculto"></div></form>` : ''}
    </article>`;
    const f = $('fEnlace');
    if(f) f.addEventListener('submit', async e => {
      e.preventDefault();
      const v = $('enlace').value.trim(), m = $('msgEnlace'), b = $('bEnlace');
      const di = (t, c) => { m.className = 'mensaje ' + c; m.textContent = t; };
      if(v && !esEnlace(v)) return di('El enlace debe ser de Google Drive (empieza por https://drive.google.com/).', 'err');
      b.disabled = true;
      const opId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      try{
        await T.api('llamar', { token: ses.token, fn: 'api_guardarEnlaceActivo', args: [a.codigo, v], opId, dispositivo: T.dispositivo() }, 60000);
        a.enlace = v; await T.kvSet('ficha:' + T.normCodigo(codigo), { activo: a, puedeEditar, f: Date.now() });
        pintar(a, puedeEditar, 'Enlace guardado.', 'ok');
      }catch(err){
        if(err.red){
          await T.colaAdd({ fn: 'api_guardarEnlaceActivo', args: [a.codigo, v], opId, f: Date.now() });
          a.enlace = v; await T.kvSet('ficha:' + T.normCodigo(codigo), { activo: a, puedeEditar, f: Date.now() });
          pintar(a, puedeEditar, 'Sin conexión: el enlace quedó guardado en este dispositivo y se subirá cuando vuelva el internet.');
        } else { di(err.message, 'err'); b.disabled = false; }
      }
    });
  }

  async function desdeCopias(){
    const k = T.normCodigo(codigo);
    const f = await T.kvGet('ficha:' + k);
    if(f) return f;
    // Si el tablero ya se abrió en este dispositivo, la lista de equipos está guardada
    for(const clave of ['r:api_sync:[]', 'r:api_init:[]']){
      const c = await T.kvGet(clave);
      if(!c) continue;
      let d = c.r; try{ if(typeof d === 'string') d = JSON.parse(d); }catch(e){ continue; }
      const a = (d.activos || []).find(x => T.normCodigo(x.codigo) === k);
      if(a) return { activo: a, puedeEditar: (Number(ses.usuario.nivel) || 0) >= 2 };
    }
    return null;
  }

  (async () => {
    try{
      const j = await T.api('llamar', { token: ses.token, fn: 'api_fichaActivo', args: [codigo], dispositivo: T.dispositivo() }, 45000);
      const d = typeof j.r === 'string' ? JSON.parse(j.r) : j.r;
      await T.kvSet('ficha:' + T.normCodigo(codigo), { activo: d.activo, puedeEditar: d.puedeEditar, f: Date.now() });
      pintar(d.activo, d.puedeEditar);
      if((await T.colaTodo()).length) T.vaciarCola();
    }catch(e){
      if(e.codigo === 'SESION'){ T.borrarSesion(); location.replace('index.html?vencida=1&volver=' + encodeURIComponent('ficha.html?c=' + encodeURIComponent(codigo))); return; }
      if(e.red){
        const c = await desdeCopias();
        if(c) return pintar(c.activo, c.puedeEditar, 'Sin conexión: se muestra la información guardada en este dispositivo. Los documentos de Drive necesitan internet.');
        cont.innerHTML = `<p class="mensaje err">No hay internet y este dispositivo no tiene guardada la ficha de ${T.esc(codigo)}. Intenta cuando vuelva la conexión.</p>`;
        return;
      }
      cont.innerHTML = `<p class="mensaje err">${T.esc(e.message)}</p>`;
    }
  })();
  window.addEventListener('online', () => T.vaciarCola());
})();
