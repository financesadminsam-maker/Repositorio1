# Mis Finanzas

Página web personal para llevar registro de ingresos y gastos, hacer presupuestos de compras y ver gráficas. Funciona en el celular (se puede instalar como app) y en la laptop.

## Qué hace

- **Movimientos**: gastos, ingresos y transferencias entre cuentas, en MXN o USD.
- **Semana de citas**: pones cuántas citas tuviste y calcula el pago ($100 por cita, mínimo $1,500; se cambia en Ajustes).
- **Categorías editables** con ícono, color y límite mensual (avisa al 80% y al 100%).
- **Cuentas**: efectivo, débito, crédito, ahorro.
- **Recurrentes**: renta, Netflix, etc. se registran solos cuando llega la fecha.
- **Presupuesto de compra**: cuánto ahorrar y en cuántas semanas, con tres escenarios (semana floja, promedio y buena) según tu historial.
- **Metas de ahorro** con barra de progreso.
- **Análisis**: resumen del mes vs. el anterior, gráficas mensuales y semanales, proyección a 6 meses.
- **Importar CSV** del banco (detecta columnas, categorías y duplicados) y **exportar** a Excel, CSV o respaldo JSON.
- **Copiar resumen** en texto para pegárselo a Claude.

## Dónde se guardan los datos

Por defecto, en el navegador del dispositivo. Para sincronizar celular y laptop se usa [Supabase](https://supabase.com) (gratis):

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, pega y ejecuta [`supabase/schema.sql`](supabase/schema.sql).
3. En **Project Settings → API** copia la *Project URL* y la *anon public key* y ponlas en [`js/config.js`](js/config.js).
4. Abre la app → **Ajustes → Sincronización** → crea tu cuenta e inicia sesión en cada dispositivo.

Lo que ya tengas guardado en el dispositivo se sube a la nube al iniciar sesión.

## Publicar en GitHub Pages

Repositorio → **Settings → Pages** → *Deploy from a branch* → elige la rama y la carpeta `/ (root)`. No necesita compilar nada.

## Probar en tu computadora

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Estructura

| Archivo | Qué contiene |
| --- | --- |
| `index.html`, `css/styles.css` | Estructura y diseño |
| `js/app.js` | Vistas, formularios y acciones |
| `js/calc.js` | Cálculos: totales, presupuestos, proyecciones |
| `js/store.js` | Guardado local y sincronización con Supabase |
| `js/charts.js` | Gráficas (Chart.js) |
| `js/csv.js` | Importar/exportar CSV y Excel |
| `vendor/` | Librerías incluidas (Chart.js, Supabase, SheetJS) |
| `sw.js`, `manifest.webmanifest` | Instalación como app y uso sin internet |
