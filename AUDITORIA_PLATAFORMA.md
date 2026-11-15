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
| Running | Parcial | Registro manual, edición/borrado, récords, km semanal/mensual, historial | Sin cronómetro, GPS, pausa/reanudación, resumen de carrera o estado persistente durante ruta | Prioridad 1: tracker GPS con degradación clara y persistencia |
| Ciclismo | Parcial | Usa formulario e historial compartidos de `activities` | Se trata casi igual a Running y no ofrece métricas específicas suficientes | Mantener registro; diseñar métricas separadas en fase posterior |
| Natación | Parcial | Registros de distancia/duración e historial | No hay largos/estilo ni métricas de piscina; velocidad es promedio genérico | No reconstruir; definir campos específicos después |
| Pliometría | Parcial funcional | Catálogo con filtros/detalle; constructor de sesión; series; descanso; borrador local; historial y récords | Sin flujo de calentamiento/avance guiado ni evaluaciones CMJ/SJ/Drop Jump; borrador no sincroniza entre dispositivos | Prioridad 2: evaluación manual explícita y mejorar continuidad |
| Entrenamiento | Parcial funcional | Plan semanal, sesión, series, temporizador e historial | Catálogo pequeño y sin periodización avanzada | Conservar; no duplicar tracker |
| Membresía | Completo funcional | Solicitud QR/efectivo y revisión admin | Pago con tarjeta es solo maqueta | Mantener como no disponible |
| Perfil/Progreso | Parcial | Avatar, amistades, accesos, gráfico por módulo, medidas y membresía | Estadística no siempre se filtra por disciplina y no hay privacidad configurable completa | No crear otra página de progreso; corregir filtros y reutilizar perfil |
| Comunidad | Parcial/incompleto | Amistades, publicaciones de medios y eventos/avisos | No hay feed de comunidad, comentarios, reacciones, retos ni rankings | Fases posteriores; no mostrar como completados |
| Eventos | Parcial funcional | Admin CRUD, Storage, RSVP, notificaciones y calendario; migración 0012 | No se verifican en este entorno RLS ni despliegue actuales; dependencias Supabase externas | Conservar la fuente única `events`; validar flujos reales |
| Admin | Completo parcial | Pagos, socios, módulos, ejercicios, eventos | Eventos y RSVP dependen de migración aplicada y Storage/config real | Reutilizar tabs y modales actuales |
| Auth | Parcial funcional | Login usuario/correo, Google, recuperación por usuario/teléfono | No se comprobó proveedor/Edge Functions en producción | No cambiar auth sin pruebas con sesión real |

## Modelo de datos y componentes reutilizables

- `activities` guarda running, ciclismo y natación; las métricas comunes son distancia, duración y fecha.
- `workouts` y `workout_sets` guardan pliometría y entrenamiento de fuerza. No conviene convertirlos en una métrica deportiva común.
- `exercises` permite catálogo y ejercicios propios; la UI de `plyo.js` ya tiene biblioteca, ficha, picker, borrador e historial.
- `training_plans` y `profile_modules` soportan planificación y acceso granular.
- `events`, `event_rsvps` y `event_notifications` comparten eventos/calendario; no crear otro calendario ni tabla duplicada.
- Reutilizables: tokens `.card`, `.btn`, `.tabs`, hojas `.modal/.sheet`, `notify`, `confirmDialog`, calendarios, métricas e historial.
- Estado técnico: `running.js` y `plyo.js` concentran vista y negocio en módulos vanilla; mantener patrón actual y extraer solo lógica pequeña cuando reduzca duplicación real.

## Orden de trabajo

1. Running: registro rápido y GPS foreground con pausa/reanudación/finalización, avisos de permiso/señal y guardado.
2. Pliometría: evaluación manual (valores declarados por el atleta, sin simular sensores), registro e historial diferenciando cada prueba.
3. Inicio y calendario: integrar solo sesiones/eventos reales ya persistidos.
4. Corregir consistencia del filtro de Progreso por módulo.
5. Comunidad/feed, retos y ranking solo después de definir políticas de privacidad, métricas y migraciones.
6. Evaluar ciclismo/natación/fuerza en sus propios términos; no rehacer páginas que ya guardan datos.

## Límites y decisiones

- El navegador requiere HTTPS y permiso de ubicación; el seguimiento en segundo plano no se puede garantizar en una web móvil. La carrera indicará que debe permanecer abierta y conservará el borrador mientras siga viva la pestaña.
- No se detectaron paquetes de mapas ni un servicio cartográfico. La primera entrega puede registrar puntos y dibujar una polilínea local SVG; un mapa de calles requiere proveedor/configuración externa.
- No se ejecutaron cambios directos sobre Supabase. La migración 0012 se marca aplicada solo por el reporte de verificación adjunto por el usuario; falta verificación independiente.
- Sin datos de usuario/sesión real no se pueden validar RLS, permisos GPS ni persistencia remota; el build no sustituye esa validación manual.
