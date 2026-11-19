# Diseño BATMON CROWD — Skill de diseño propia

Repositorio: https://github.com/arancibiafloreserickmanuel-dotcom/batmon
Archivos de estilo: `src/app/app.css` (app), `src/styles.css` y `src/app/*.js` (marcado por módulo).

## Concepto: combinamos tres estilos

| Estilo | Qué aporta a BATMON |
|---|---|
| **Soft UI / Neumorphism** | Tarjetas, botones y controles con sombras suaves (luz arriba‑izquierda, sombra abajo‑derecha), relieves y superficies ligeramente elevadas. Al pulsar el elemento se "hunde" (sombra interior). |
| **Textured UI** | Fondo con textura de papel / concreto fino (`/theme-light.png`, `/theme-dark.png`) sobre `body.appbody`. La superficie de las tarjetas es lisa para que el relieve se note sobre la textura. |
| **Monochrome Minimalism** | Solo blanco, grises y negro. Tipografía condensada (Anton) para títulos y números; Inter para texto. El único color de acento es el **negro** (en oscuro, el blanco). Rojo `#d92727` / `#fc5d7c` solo para alertas o peligro; verde `#4ecda6` solo para confirmaciones. |

### Regla de oro
> Todo es gris‑blanco‑negro. Lo **seleccionado/activo** se marca **negro con letra blanca** (en modo oscuro: negro con letra blanca y **borde blanco** para que se vea). Lo **no seleccionado** es una pieza neumórfica en relieve.

---

## Tokens

### Tipografía
- **Anton** (condensada, MAYÚSCULAS en `h1`): títulos `h1` 34 px, números grandes `.stat b` 26 px, marca 17 px.
- **Inter**: todo el texto (400/500/600/700). Etiquetas pequeñas en 11–12 px, `font-weight:700`, `letter-spacing:.06em`, mayúsculas.
- Campos de texto en móvil: **16 px** (evita zoom en iOS).

### Color (modo claro / oscuro)
| Token | Claro | Oscuro |
|---|---|---|
| Fondo página (`--surface`) | `#fff` | `#101010` |
| Superficie de tarjeta (`--card-surface`) | `#e0e0e0` | `#212121` |
| Texto (`--ink`) | `#10100e` | `#f4f4f2` |
| Texto secundario (`--muted`) | `#52524d` | `#c1c1bd` |
| Línea (`--line`) | `#deded8` | `#484846` |
| Cara de botón (`--button-face`) | `#e8e8e8` | `#212121` |
| Texto de botón (`--button-ink`) | `#090909` | `#fff` |
| Luz (`--light`) | `#fff` | `#2c2c2c` |
| Sombra (`--dark`) | `#bebebe` | `#121212` |
| **Activo / seleccionado** | `#000` + texto `#fff` | `#000` + texto `#fff` + borde `#fff` |

Tema por atributo: `body.appbody[data-theme="light" | "dark"]`. Siempre definir **ambos** modos.

### Sombras neumórficas
- Relieve botón: `6px 6px 12px #c5c5c5, -6px -6px 12px #fff` (oscuro: `6px 6px 12px #000, -6px -6px 12px #2f2f2f`).
- Pulsado / hundido: `inset 4px 4px 12px #c5c5c5, inset -4px -4px 12px #fff` (oscuro: `inset … #000 / #1f1f1f`).
- Tarjeta: `--card-shadow-a` + `--card-shadow-b` (claro `20px 20px 60px #bebebe, -12px -12px 32px #ededed`; oscuro `10px 10px 24px rgb(12,12,12), -8px -8px 20px rgb(37,37,37)`).
- Pequeñas: `--shadow-out-sm`, `--shadow-in-sm`.

### Forma y espacio
- Radio: tarjetas 16 px (`--card-radius`), botones 8 px, chips y círculos 99 px, hojas modales 20 px arriba.
- Separación entre bloques: 12–16 px. Margen lateral de pantalla: 16 px. Sin scroll horizontal.
- Zona táctil mínima: 44 px de alto.

---

## Componentes

> Para cada componente: **aspecto**, **estados**, **modo oscuro** y **clase CSS**.

### Botón principal `.btn`
- **Aspecto:** cara `--button-face`, texto `--button-ink`, radio 8 px, sombra de relieve.
- **Estados:** `:active` → sombra interior (hundido). `:disabled` → opacidad .55, cursor `not-allowed`.
- **Oscuro:** cara `#212121`, texto blanco, sombra `#000 / #2f2f2f`.
- **Variante activa** (ej. "Agregar 2" cuando hay ejercicios elegidos): `#ok.btn.on` → fondo `#000`, texto `#fff`; oscuro: borde `#fff`.

### Botón de texto `button.link`
- Sin placa ni relieve; texto `--ink`, sin borde. Para "Cerrar", "Cancelar", enlaces dentro de hojas.
- `:active` sin transformación.

### Botón de acción con icono `.pd-newex` ("+ Crear ejercicio propio")
- Ancho completo, borde discontinuo `1.5px dashed var(--line)`, fondo `--surface`, icono **+** de 18 px y el nombre al lado, `font:700 14px Inter`.
- Va **arriba** de la lista, nunca oculto abajo. `:active` → negro con texto blanco.

### Botón icono (sin placa)
- Hamburguesa `.settings-hamburger`, `.stepper button`, papelera, flechas: **sin sombra ni borde**, solo el símbolo; `:active` → `scale(.92–.96)`.

### Círculo de ejercicio `.pd-circle`
- Círculo con foto del ejercicio y número `i`; `.on` = anillo negro (blanco en oscuro). `.pd-circle--add` = círculo con **+** para añadir ejercicios (abre directo el selector; si el día está vacío, el selector se abre solo).

### Botones circulares de running `.run-circle-btn`
- Grandes (`--big`) con icono; el primario (`:not(--outline)`) va en negro con icono blanco; `--outline` en relieve claro. `:active` → `scale(.96)`.

### Tarjeta `.card`
- Fondo `--card-surface`, radio 16 px, doble sombra neumórfica, borde de 8 % de `--ink`.
- Nunca más de un nivel de tarjeta dentro de otra; para agrupar dentro usar líneas `--line`.

### Campo de texto / buscador `input`, `input[type=search]`
- Alto 46–48 px, ancho completo, 16 px, borde fino `--line`, fondo `--surface`, texto `--ink`.
- Placeholder en `--muted`. Foco: contorno de 2 px `--ink`.

### Desplegable `select`
- Mismo alto y borde que el campo de texto (46 px, 15 px de letra). Siempre con una **etiqueta pequeña encima** en mayúsculas (`.pd-f span`): Grupo · Nivel · Equipo.
- Todas las opciones **en español** (ej. Sin equipo, Peso corporal, Balón medicinal, Pesa rusa). Cuadrícula de 2 columnas; el último (Equipo) a ancho completo; en pantallas < 420 px, 1 columna.

### Chip `.pd-chip` (grupos, filtros)
- Píldora 99 px, borde `--line`, fondo `--surface`, `font:600 12px Inter`, sin relieve.
- **Seleccionado `.on`:** fondo `#000`, texto `#fff`, borde `#000` (oscuro: borde y halo blanco `0 0 0 1px #fff`).

### Píldora de acción `.pd-pill` (Descanso, Nota, Solo reps)
- Igual que chip; `.on` negro/blanco. Variante `--danger` (papelera) en rojo solo al icono.

### Tarjeta de ejercicio `.ecard` (cuadrícula `.egrid`)
- Miniatura cuadrada + nombre en español. Cuadrícula `repeat(auto-fill,minmax(132px,1fr))`, separación 12 px.
- **Seleccionada `.sel`:** fondo `#000`, texto `#fff`, borde 3 px `#000` (oscuro: borde `#fff`).
- Estado vacío: "Sin resultados. Prueba con otro nombre, en español o inglés."

### Hoja modal `.modal > .sheet`
- Sube desde abajo, radio 20 px arriba, fondo `--surface`, texto `--ink`; sigue el tema (también en diálogos de **Descartar** y **Finalizar**).
- Cabecera `.sheet-h`: título en negrita + `button.link` "Cerrar". Pie `.sheet-f` fijo con el botón principal.
- Fondo oscurecido `rgba(0,0,0,.5)`.

### Selector de ejercicios (pantalla compuesta)
Orden vertical con 14–16 px entre bloques:
1. `+ Crear ejercicio propio` (`.pd-newex`)
2. Buscador (bilingüe español/inglés, sinónimos, sin tildes, tolera errores)
3. Filtros Grupo / Nivel / Equipo (desplegables con etiqueta)
4. Contador "N ejercicios"
5. Cuadrícula `.egrid` de `.ecard`
6. Pie: botón **Agregar** (blanco → negro con letra blanca al elegir)

### Barra inferior (dock) `.tabs.main`
- Flotante, centrada, ancho máx. 720 px, radio 16 px, relieve neumórfico, 9 px sobre el borde inferior (respeta `safe-area`).
- Ítem activo: sombra **interior** (hundido), texto `--button-ink`; inactivo: `--muted`.

### Pestañas / selector de periodo `.tabs button`, `.period-switch button`
- Relieve; `.on` = hundido (sombra interior) y texto `--button-ink`.
- Pestañas de perfil `.profile-media-tabs`: sin placa, **subrayado de 2 px** en la activa.

### Interruptor de tema `.theme-switch`
- Control tipo sol/luna (claro ↔ oscuro) en Configuración; transición .5 s.

### Casilla `input[type=checkbox]`
- Redonda 1.3em, cara `--button-face`, relieve; marcada → sombra interior y check `#174a35`.

### Barra de progreso `.membership-progress`
- Pista `#f5f5f5` con borde interior; relleno `#101010`; urgente → `#d92727`.

### Tabla de series `.pd-table`
- Columnas Serie · Antes · Peso · Reps · ✕. Entradas numéricas de 16 px; botón "+ Añadir serie" en relieve, ancho completo.

### Mapa y Running
- Flechas de navegación entre páginas **discretas** a los lados (Contador ← → Configuración), sin botones de zoom.
- Controles del mapa (`.run-maptools`) con tinta y fondo semitransparente; `mt-dark` para mapa oscuro.

### Campo de subida de imagen / video `.up` (`src/app/upload-field.js` + `.css`)
- **Se aplica solo** a todo `<input type="file">` (salvo `hidden` o `data-no-upload-field`) con `autoEnhanceFileInputs()`. No hay que marcarlo a mano; el input real queda dentro y el formulario lo lee igual (`input.files`).
- Base: "Image upload field" de Animorio. **Respetar la animación tal cual**: el campo (148 px) se encoge a una fila (96 px) con miniatura 72 px; la vista previa se **revela de arriba hacia abajo** (velo desenfocado 7 px + `clip-path`) mientras avanza la barra y el porcentaje (ease `slow(0.4,0.6)`, 2,2 s); al terminar: brillo que cruza, rebote, check verde que se dibuja, texto "Cargando" → "Listo". Quitar (✕) devuelve el campo inicial.
- Aspecto actual: **oscuro en ambos temas** (`#111318`, acento `#7c9cff`, ok `#5fe0a2`), variables propias `--u-*` para no chocar con la app. Por ahora no se adapta a la paleta gris/negro; se hará después.
- Varias fotos: muestra la primera con "+N". Video: fotograma como miniatura. La barra es visual; la subida real ocurre al guardar el formulario.
- GSAP se carga bajo demanda (import dinámico) en la primera selección. Respeta `prefers-reduced-motion`. Texto en español.
- Sin cursor fantasma ni bucle de demostración.

### Zona de documentos con pila (pendiente, sin uso aún)
- Base: "Piling upload zone" de Animorio (GSAP + Matter.js): los archivos caen con física, se apilan, se apartan al pasar el puntero y se pueden lanzar; "Subir" los envía uno a uno desde arriba de la pila.
- **Reservada para documentos** (PDF, etc.). Hoy no existe ningún campo de documentos; cuando aparezca, usar esta animación sin cambiarla y añadir `matter-js` al proyecto. Imágenes/videos usan siempre el campo `.up`.

### Compartir actividad `.share-box` (`src/app/share.js`)
- Aparece al terminar una carrera o sesión de pliometría. Interruptor `.share-switch` **apagado por defecto** (naranja `#fc4c02` al activar). Nada se publica solo.
- Campos al activar: título, descripción, lugar (autocompletado por GPS, editable), fotos (campo `.up`), autoevaluación. Visible solo para amigos aceptados; las notas personales nunca se comparten.

### Tarjeta de actividad `.act-card`
- Orden: cabecera (avatar 46 px, nombre, fecha, lugar con icono) → título → estadísticas (distancia/ritmo/tiempo; en pliometría tiempo/series/ejercicios) → caja de logros → **mapa** (230 px, Leaflet, trazo naranja) → descripción → fotos → "¡Sé el primero en dar like!" → barra de acciones (me gusta · comentar · compartir).
- **Sin mapa** (pliometría, carrera manual): la tarjeta sale solo con estadísticas, sin hueco.
- Acciones: botones sin placa; "me gusta" activo en naranja con relleno suave. Comentarios se despliegan dentro de la tarjeta.
- Vive en Running → pestaña **Actividades** (4.ª pestaña; `.tabs-pill--4`, indicador al 25 %).

### Logros `.logro` / `.act-logro`
- Tres niveles por color de trofeo SVG: bronce `#c4723a`, plata `#8f98a3`, oro `#e5a60b`. Conseguido: fondo suave y "Conseguido" en verde; pendiente: gris con barra de progreso.
- Se calculan en el cliente con los datos reales (sin tabla). Perfil → pestaña **Logros**; en la tarjeta salen los de esa actividad ("Tu carrera más larga…").

---

## Reglas para crear algo nuevo
1. Solo grises + negro + blanco. Sin colores nuevos de marca.
2. Elementos **no activos** → relieve neumórfico. Elementos **activos** → negro/blanco (o hundido si es navegación).
3. Siempre probar **claro y oscuro**; si el estilo global pisa el tuyo, usar `body.appbody …` y `!important`.
4. Móvil primero: 16 px de margen, 44 px de alto táctil, separaciones de 12–16 px, sin scroll horizontal.
5. Todo texto de la interfaz en **español** (los nombres en inglés solo se usan para buscar).
6. Títulos en Anton, mayúsculas; texto en Inter.
7. Iconos de trazo (`stroke="currentColor"`, 2–2.4 px), nunca emojis.
8. Subida de archivos: imagen/video → campo `.up` (automático); documentos → zona de pila. No crear otros selectores de archivo.
