// GitHub Pages no conoce las rutas de la app (/dash, /gantt…): al recargar sirve 404.html, que es una copia de index.html.
import { copyFileSync, existsSync } from "node:fs";
if (existsSync("dist/index.html")) { copyFileSync("dist/index.html", "dist/404.html"); console.log("dist/404.html creado (fallback SPA)"); }
