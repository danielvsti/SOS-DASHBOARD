# SOS Municipal · Dashboard Ejecutivo v1

Frontend estático para visualizar estadísticas profesionales de la plataforma SOS Municipal.

## Acceso
Usa `/auth/panel-login` con `panel_type: CONTROL_CENTER`, por lo que pueden ingresar usuarios con rol:

- `OPERATOR`
- `ADMIN`

## Endpoint requerido
El middleware debe tener el endpoint:

- `GET /dashboard/analytics?control_center_code=CC-VINA&days=30`

Incluido en `server_sos_v23_dashboard.js`.

## Despliegue sugerido
Crear un servicio estático en Render, por ejemplo:

- Repo: `SOS-DASHBOARD`
- Build Command: vacío
- Publish Directory: `.`

