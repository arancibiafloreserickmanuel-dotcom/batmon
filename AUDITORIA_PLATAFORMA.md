# Auditoría de BATMON CROWD

Fecha: 15 de noviembre de 2026. Revisión del código del repositorio, sin acceso directo al proyecto de Supabase ni a la consola de Vercel.

## Arquitectura actual

- Vite 5 multipágina; JavaScript ES modules sin framework.
- `index.html` y `src/main.js` contienen landing/cursor; `app.html` carga `src/app/app.js`; `admin.html` carga `src/app/admin.js`.
- Supabase JS proporciona Auth, Postgres y Storage. RLS se define en `supabase/schema.sql` y `supabase/migrations/0002` a `0012`.
- Estilos de app y admin centralizados en `src/app/app.css`; landing en `src/style.css`.
- Sin suite de pruebas configurada en `package.json`; `npm run build` es la verificación automatizada disponible.

## Mapa e inventario funcional

| Área | Estado | Qué existe | Falta / riesgo | Acción recomendada |
|---|---|---|---|---|
| Landing | Completo | Landing responsive y cursor WebGL | Requiere revisión visual en dispositivos | Conservar; no tocar shaders |
| Inicio/calendario | Parcial | Calendario cal10, actividades y eventos de Supabase | Resumen de disciplina/carga limitado; estado de notificaciones debe seguir coordinado | Conservar un solo calendario; integrar datos existentes |
| Running | Parcial funcional | Registro manual/GPS, cronómetro, distancia, ritmo actual/promedio, pausa/reanudación, ruta, persistencia e historial por páginas | Sin objetivos ni parciales por km; web no garantiza GPS en segundo plano | Validar en móvil; completar objetivos/detalle cuando haya datos y UX confirmados |
| Ciclismo | Parcial | Registro, edición/borrado, historial y métricas/resumen por página de disciplina | Sin GPS para bici ni métricas propias de elevación/cadencia | Conservar; definir métricas sin rehacer el flujo compartido |
| Natación | Parcial | Registros de distancia/duración, historial y ritmo min/100 m | No hay largos/estilo ni datos de piscina | Conservar; agregar métricas específicas cuando se defina el modelo |
| Pliometría | Parcial funcional | Catálogo, constructor, series, descanso, borrador aislado por usuario, historial filtrado y evaluaciones manuales CMJ/SJ/Drop Jump | Sin calentamiento/avance guiado ni sincronización del borrador entre dispositivos | Completar ejecución guiada sin sustituir el constructor existente |
| Entrenamiento | Parcial funcional | Plan semanal, sesión, series, temporizador e historial | Catálogo pequeño y sin periodización avanzada | Conservar; no duplicar tracker |
| Membresía | Completo funcional | Solicitud QR/efectivo y revisión admin | Pago con tarjeta es solo maqueta | Mantener como no disponible |
| Perfil/Progreso | Parcial | Avatar, amistades, accesos, gráfico por módulo, medidas y membresía | Estadística no siempre se filtra por disciplina y no hay privacidad configurable completa | No crear otra página de progreso; corregir filtros y reutilizar perfil |
| Comunidad | Parcial funcional (entrega local) | Club con Actividad/Miembros/Retos; publicaciones, comentarios, reacciones, amistades y rankings por reto con datos reales | Depende de migraciones 0014/0015; faltan anuncios admin y notificaciones sociales | Aplicar migraciones; validar privacidad/RLS y uso móvil |
| Eventos | Parcial funcional | Admin CRUD, Storage, RSVP, notificaciones y calendario único en Inicio | No se verifican aquí policies remotas ni deploy actual | Conservar `events` como fuente única y validar flujos |
| Admin | Parcial funcional | Pagos, socios, módulos, ejercicios, eventos y CRUD de retos | Retos dependen de migración 0015 y conexión real | Reutilizar secciones y componentes actuales |
| Auth | Parcial funcional | Login usuario/correo, Google, recuperación por usuario/teléfono | No se comprobó proveedor/Edge Functions en producción | No cambiar auth sin pruebas con sesión real |

## Modelo de datos y componentes reutilizables

- `activities` guarda running, ciclismo y natación; las métricas comunes son distancia, duración y fecha.
- `workouts` y `workout_sets` guardan pliometría y entrenamiento de fuerza. No conviene convertirlos en una métrica deportiva común.
- `exercises` permite catálogo y ejercicios propios; la UI de `plyo.js` ya tiene biblioteca, ficha, picker, borrador e historial.
- `training_plans` y `profile_modules` soportan planificación y acceso granular.
- `events`, `event_rsvps` y `event_notifications` comparten eventos/calendario; no crear otro calendario ni tabla duplicada.
- `profile_posts`, `friendships`, `post_reactions` y `post_comments` soportan el feed y la interacción entre amistades. `club_challenges`/`challenge_participants` y el RPC de clasificación reúnen retos; las puntuaciones se consultan de los registros reales.
- Reutilizables: tokens `.card`, `.btn`, `.tabs`, hojas `.modal/.sheet`, `notify`, `confirmDialog`, calendarios, métricas e historial.
- Estado técnico: `running.js` y `plyo.js` concentran vista y negocio en módulos vanilla; mantener patrón actual y extraer solo lógica pequeña cuando reduzca duplicación real.

## Orden de trabajo

1. Running: tracker foreground y páginas de resumen/inicio/historial; faltan objetivos, parciales y validación móvil.
2. Pliometría: conservar biblioteca/constructor/historial/evaluaciones; falta ejecución guiada y continuidad entre dispositivos.
3. Inicio y calendario: conservar la única fuente de sesiones/eventos.
4. Perfil: mantener Progreso en su ubicación; no crear otra analítica.
5. Club: aplicar migraciones y validar feed/miembros/retos con RLS; no inventar avisos sociales.
6. Natación/Ciclismo/Entrenamiento: mejorar métricas solo con los datos que cada disciplina realmente registra.

## Límites y decisiones

- El navegador requiere HTTPS y permiso de ubicación; el seguimiento en segundo plano no se puede garantizar en una web móvil. La carrera indicará que debe permanecer abierta y conservará el borrador mientras siga viva la pestaña.
- No se detectaron paquetes de mapas ni un servicio cartográfico. La primera entrega puede registrar puntos y dibujar una polilínea local SVG; un mapa de calles requiere proveedor/configuración externa.
- No se ejecutaron cambios directos sobre Supabase. El usuario confirmó la aplicación de 0013; 0014/0015 quedan pendientes en esta entrega. El historial anterior contiene reportes contradictorios en `PROGRESS.md`.
- Sin datos de usuario/sesión real no se pueden validar RLS, permisos GPS ni persistencia remota; el build no sustituye esa validación manual.
