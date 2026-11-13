// Pantalla de ingreso y arranque del tablero instalado.
(function(){
  'use strict';
  const T = window.Tablero;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  // Después de entrar se puede volver a una ficha de equipo (solo rutas internas)
  const volver = /^ficha\.html\?c=[A-Za-z0-9%._-]+$/.test(params.get('volver') || '') ? params.get('volver') : '';

  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));

  // Si el dispositivo tiene internet pero el servidor no responde, casi siempre es el permiso de la API
  const sinRed = (txtSin) => navigator.onLine ? 'No se pudo conectar con el servidor del tablero. Revisa que la implementación "API app" esté publicada con acceso para "Cualquier usuario" y que la dirección en config.js sea la correcta.' : txtSin;
  function mensaje(txt, tipo){ const m = $('msg'); m.className = 'mensaje ' + (tipo || 'info'); m.textContent = txt; m.classList.toggle('oculto', !txt); }
  function vista(cual){ $('vCarga').classList.toggle('oculto', cual !== 'carga'); $('vIngreso').classList.toggle('oculto', cual !== 'ingreso'); }

  // ---- Ingreso con correo y código ----
  let correo = '';
  function mostrarIngreso(aviso){
    vista('ingreso');
    T.bannerCookies();
    if(aviso) mensaje(aviso, 'info');
    const ult = T.ls.get('tablero_ultimo_correo');
    if(ult && !$('correo').value) $('correo').value = ult;
    setTimeout(() => $('correo').focus(), 60);
  }
  const dominio = new RegExp('^[a-z0-9._%+-]+@([a-z0-9-]+\\.)?' + (T.CFG.DOMINIO || 'areandina.edu.co').replace(/\./g, '\\.') + '$', 'i');
  async function pedirCodigo(){
    correo = $('correo').value.trim().toLowerCase();
    if(!dominio.test(correo)) return mensaje('Usa tu correo institucional (@' + (T.CFG.DOMINIO || 'areandina.edu.co') + ').', 'err');
    if(!$('acepto').checked) return mensaje('Para entrar debes aceptar las políticas.', 'err');
    const b = $('bPedir'); b.disabled = true; b.textContent = 'Enviando…';
    try{
      const j = await T.api('auth_pedir', { correo, dispositivo: T.dispositivo() }, 30000);
      T.ls.set('tablero_ultimo_correo', correo);
      $('correoTxt').textContent = correo;
      $('fCorreo').classList.add('oculto'); $('fCodigo').classList.remove('oculto');
      mensaje(j.mensaje || 'Revisa tu correo.', 'ok');
      $('codigo').value = ''; $('codigo').focus();
    }catch(e){ mensaje(e.red ? sinRed('No hay internet. Para entrar la primera vez necesitas conexión.') : e.message, 'err'); }
    finally{ b.disabled = false; b.textContent = 'Enviarme un código'; }
  }
  async function verificar(){
    const codigo = $('codigo').value.replace(/\D/g, '');
    if(codigo.length !== 6) return mensaje('El código tiene 6 cifras.', 'err');
    const b = $('bVerificar'); b.disabled = true; b.textContent = 'Verificando…';
    try{
      const acepto = `privacidad, términos y cookies v${T.CFG.VERSION_POLITICAS} (${new Date().toISOString().slice(0, 10)})`;
      const j = await T.api('auth_verificar', { correo, codigo, dispositivo: T.dispositivo(), acepto }, 30000);
      // Si entra otra persona en este dispositivo, no se mezclan sus datos guardados
      const anterior = T.ls.get('tablero_dueno');
      if(anterior && anterior !== correo) await T.borrarTodoLocal();
      T.ls.set('tablero_dueno', correo);
      T.guardarSesion(j);
      T.ls.set(T.K.consentimiento, JSON.stringify({ version: T.CFG.VERSION_POLITICAS, fecha: new Date().toISOString(), necesarias: true }));
      const bc = $('bannerCookies'); if(bc) bc.remove();
      mensaje('', '');
      if(volver){ location.replace(volver); return; }
      arrancar();
    }catch(e){ mensaje(e.red ? sinRed('Se perdió la conexión. Intenta de nuevo.') : e.message, 'err'); }
    finally{ b.disabled = false; b.textContent = 'Entrar'; }
  }
  $('fCorreo').addEventListener('submit', e => { e.preventDefault(); pedirCodigo(); });
  $('fCodigo').addEventListener('submit', e => { e.preventDefault(); verificar(); });
  $('codigo').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if(e.target.value.length === 6) verificar(); });
  $('bOtroCorreo').onclick = () => { $('fCodigo').classList.add('oculto'); $('fCorreo').classList.remove('oculto'); mensaje('', ''); $('correo').focus(); };
  $('bReenviar').onclick = () => { $('acepto').checked = true; pedirCodigo(); };

  // ---- Arranque del tablero ----
  function pintarTablero(html){
    const cabeza = [
      '<script src="config.js"><\/script>', '<script src="comun.js"><\/script>', '<script src="shim.js"><\/script>',
      '<link rel="manifest" href="manifest.webmanifest">', '<meta name="theme-color" content="#78B038">',
      '<link rel="icon" type="image/png" href="icons/favicon-32.png">', '<link rel="apple-touch-icon" href="icons/apple-180.png">'
    ].join('');
    // La etiqueta <base target="_top"> de Apps Script no hace falta aquí
    let h = String(html).replace(/<base[^>]*>/i, '');
    h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, m => m + cabeza) : cabeza + h;
    document.open();
    document.write(h);
    document.close();
  }
  async function arrancar(){
    vista('carga');
    const ses = T.sesion();
    if(!ses) return mostrarIngreso();
    let copia = null;
    try{ copia = await T.kvGet('app_html'); }catch(e){}
    // Con una copia guardada se abre de inmediato; la versión nueva se descarga en segundo plano desde el tablero
    if(copia && copia.html) return pintarTablero(copia.html);
    $('cargaTxt').textContent = 'Descargando el tablero por primera vez…';
    try{
      const j = await T.api('app', { token: ses.token, dispositivo: T.dispositivo() }, 60000);
      await T.kvSet('app_html', { html: j.html, version: j.version, fecha: Date.now() });
      pintarTablero(j.html);
    }catch(e){
      if(e.codigo === 'SESION'){ T.borrarSesion(); return mostrarIngreso(e.message); }
      vista('carga');
      $('cargaTxt').innerHTML = e.red ? 'No hay internet y este dispositivo todavía no tiene una copia del tablero.<br>Conéctate una vez para descargarlo.' : T.esc(e.message);
      document.querySelector('.giro').style.display = 'none';
      window.addEventListener('online', () => location.reload(), { once: true });
    }
  }

  if(params.get('salir') === '1'){ history.replaceState(null, '', location.pathname); mostrarIngreso('Cerraste la sesión en este dispositivo.'); }
  else if(T.sesion()) arrancar();
  else mostrarIngreso(params.get('vencida') ? 'Tu sesión venció. Entra de nuevo con tu correo.' : '');
})();
