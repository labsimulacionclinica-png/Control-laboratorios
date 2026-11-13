# App instalable del Tablero de Laboratorios

Esta carpeta es la app que se instala en tablets Android y en computadores. Funciona sin internet y sube los cambios cuando vuelve la conexión. El tablero de siempre (la dirección /exec de Apps Script) sigue funcionando igual.

## Qué hay aquí

| Archivo | Para qué sirve |
|---|---|
| index.html, app.js | Pantalla de ingreso con correo y código, y arranque del tablero |
| shim.js | Conecta el tablero con el servidor, guarda copias y maneja la cola sin conexión |
| comun.js | Funciones compartidas (sesión, almacenamiento, banner de cookies) |
| config.js | **El único archivo que hay que editar**: la dirección de la API |
| sw.js | Guarda la app en el dispositivo para que abra sin internet |
| ficha.html, ficha.js | Ficha de cada equipo: es lo que abre el QR de la etiqueta |
| privacidad.html, terminos.html, cookies.html | Políticas (borradores para que los revise jurídica) |
| manifest.webmanifest, icons/ | Nombre, colores e íconos de la app instalada |

## Puesta en marcha (una sola vez)

### 1. Publicar la API en Apps Script
1. En el proyecto, ve a **Implementar → Nueva implementación → Aplicación web**.
2. Descripción: `API app`. **Ejecutar como: Yo**. **Quién tiene acceso: Cualquier usuario**.
3. Pulsa **Implementar** y autoriza los permisos que pida (incluye enviar correos, que se usa para los códigos de ingreso).
4. Copia la dirección que termina en `/exec`.

Esta implementación es distinta de la del tablero. Cuando cambies el código, actualiza las dos: **Gestionar implementaciones → lápiz → Versión nueva**.

> Si al publicar no aparece la opción "Cualquier usuario", el administrador de Google Workspace de Areandina la tiene bloqueada. En ese caso hay que pedirle a TI que la habilite para este proyecto; sin eso la app no puede conectarse.

### 2. Configurar la app
Abre `config.js` y reemplaza `PEGA_AQUI_LA_URL_EXEC_DE_LA_API` por la dirección del paso 1. Guarda.

### 3. Publicar la app en GitHub Pages (gratis)
1. Crea una cuenta en github.com (puede ser con el correo institucional).
2. **New repository** → nombre, por ejemplo `tablero-laboratorios` → **Public** → Create.
3. **Add file → Upload files** y arrastra todo el contenido de esta carpeta (incluida la carpeta `icons`). **Commit changes**.
4. **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
5. En uno o dos minutos aparece la dirección, algo como `https://tu-usuario.github.io/tablero-laboratorios/`.

### 4. Avisarle al tablero dónde está la app
En el tablero, **⚙ Administración → 📱 App instalable**, pega la dirección del paso 3 y pulsa Guardar. Desde ese momento los QR de las etiquetas de equipos abren la ficha. Las etiquetas que ya estaban impresas siguen sirviendo para escanear dentro del tablero, pero para que abran la ficha con la cámara del celular hay que reimprimirlas.

### 5. Instalar en cada dispositivo
- **Tablet Android:** abre la dirección en Chrome, entra con el correo y el código, y toca ⋮ → **Instalar app**.
- **Computador:** abre la dirección en Chrome o Edge y pulsa el ícono de instalar en la barra de direcciones.

Ábrela una vez con internet para que guarde los datos. Después ya trabaja sin conexión.

## Cómo funciona sin internet
- Se puede: ver prácticas, avanzar estados, firmar pasos, descontar del kardex, vincular nombres a insumos y agregar enlaces de documentos.
- Necesita internet: importar archivos, registrar ingresos al kardex, crear equipos, reportes que se calculan en el servidor, reinicios.
- El indicador abajo a la izquierda muestra si hay conexión y cuántos cambios esperan. Al tocarlo se pueden subir a mano o cerrar la sesión.
- Si dos personas cambian la misma práctica sin conexión, queda el último cambio que llegue al servidor.

## Actualizar la app
- Si cambias el tablero en Apps Script, basta con publicar las versiones nuevas: la app descarga el tablero nuevo sola y lo usa la siguiente vez que se abra.
- Si cambias archivos de esta carpeta, súbelos de nuevo a GitHub y en `sw.js` cambia `tablero-v1` por `tablero-v2` (y así sucesivamente) para que los dispositivos tomen la versión nueva.

## Pendiente antes de usarla con todo el personal
- Que jurídica revise y complete las políticas (NIT, dirección, correo de protección de datos, plazos). Los campos están entre corchetes.
