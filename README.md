# SOS Dashboard v3 · Mapa de calor territorial

Incluye actualización en vivo del Dashboard Ejecutivo y un nuevo mapa territorial con:

- Capa de calor de eventos georreferenciados.
- Puntos individuales de tickets.
- Tabla de zonas con mayor recurrencia.
- Selector: Calor + puntos / Solo calor / Solo puntos.
- Botón para recentrar el mapa.
- Compatible con el endpoint `/dashboard/analytics` v25.

## Archivos frontend

Copiar en el repo `SOS-DASHBOARD`:

```bash
cp sos_dashboard_v3_heatmap/index.html index.html
cp sos_dashboard_v3_heatmap/app.js app.js
cp sos_dashboard_v3_heatmap/styles.css styles.css
cp sos_dashboard_v3_heatmap/manifest.json manifest.json

git add .
git commit -m "add municipal heatmap to executive dashboard"
git push
```

## Middleware

Copiar `server_sos_v25_dashboard_heatmap.js` como `server.js` en el repo del middleware/API.

```bash
cp server_sos_v25_dashboard_heatmap.js server.js
git add server.js
git commit -m "add dashboard territorial heatmap analytics"
git push
```
