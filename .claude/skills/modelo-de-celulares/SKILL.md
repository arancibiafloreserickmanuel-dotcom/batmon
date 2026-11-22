---
name: modelo-de-celulares
description: Modelo de celulares (iPhone 15 Pro Max 3D) para poner capturas de la app dentro de un celular. Úsala cuando pidan mockups de celular, capturas en un iPhone o actualizar la sección "App" de la landing.
---

# Modelo de celulares

Herramienta: https://github.com/quentin-pla/phone-mockup-studio
(app en vivo: https://quentin-pla.github.io/phone-mockup-studio/)

Es una página con Three.js: se carga una captura, se mapea sobre un iPhone 3D y se exporta un PNG transparente.
El modelo usado es `source/apple_iphone_15_pro_max_black(2).glb` (iPhone 15 Pro, de Sketcher @jnanbr07, CC BY 4.0: hay que dar crédito, ya está al pie de la landing).

## Cómo se hizo en la landing
1. Descargar `index.html` y el `.glb` del repo y servirlos en local (`python -m http.server`).
2. Preset "Frontal"; por cada captura poner el archivo en `#file-shot`, disparar `change` y pulsar `#btn-download` (capturando el blob PNG).
3. Convertir a WebP (~720px de ancho) en `public/app/phone-N.webp`.
4. Se muestran en la sección `#app` de `index.html` (carrusel horizontal), estilos al final de `src/style.css`.

Para cambiar las capturas, repetir el proceso con las nuevas imágenes y reemplazar `public/app/phone-N.webp`.
