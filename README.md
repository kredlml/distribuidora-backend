# Distribuidora

Sistema web para una distribuidora de ropa para dama con varias sucursales. Integra una API REST, un panel de empleados para la operación diaria (ventas en mostrador, inventario, pedidos, devoluciones, reportes) y una tienda en línea donde las clientas compran, pagan con tarjeta y solicitan cambios o devoluciones. Este documento es la portada del repositorio: resume el sistema, indica cómo ejecutarlo en un equipo local y enlaza la documentación técnica completa ubicada en [`docs/`](docs/).

## Contenido

- [Datos académicos](#datos-académicos)
- [Sistema publicado](#sistema-publicado)
- [Capturas](#capturas)
- [Funcionalidades principales](#funcionalidades-principales)
- [Tecnologías](#tecnologías)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Inicio rápido en local](#inicio-rápido-en-local)
- [Comandos útiles](#comandos-útiles)
- [Documentación](#documentación)
- [Licencia y uso académico](#licencia-y-uso-académico)

## Datos académicos

| Campo | Valor |
|---|---|
| Universidad | Universidad Mariano Gálvez de Guatemala |
| Curso | Desarrollo Web |
| Catedrático | Elmer Josué Esteban Chilel |
| Integrantes | Oswaldo Guanche Juárez · Carlos Daniel Rojas · Kimberly Alejandra Yol Ixpata |
| Fecha | Octubre de 2026 |

## Sistema publicado

Las tres partes del sistema están desplegadas en Render:

| Parte | Dirección |
|---|---|
| Tienda en línea (clientas) | https://distribuidora-tienda.onrender.com |
| Panel de empleados | https://distribuidora-panel.onrender.com |
| API REST | https://distribuidora-api-r6rw.onrender.com |
| Verificación de salud de la API | https://distribuidora-api-r6rw.onrender.com/api/salud |

El endpoint `/api/salud` es público e informa si la API y la base de datos responden; el detalle del sistema y los últimos errores registrados (`/api/salud/detalle`, `/api/salud/errores`) están reservados al puesto DISTRITAL.

## Capturas

![Catálogo de la tienda en línea con buscador, filtros por tipo de prenda y selector de sucursal de envío](docs/img/tienda-catalogo.png)

*Catálogo de la tienda en línea: búsqueda por prenda, color o talla, filtros por tipo de prenda, selector de la sucursal desde la que se envía y aviso de prendas agotadas en esa sucursal.*

![Pantalla de reportes de ventas del panel de empleados](docs/img/panel-reportes.png)

*Reportes de ventas del panel: indicadores del periodo (ventas, ticket promedio, devoluciones, reembolsos, descuentos, envíos e IVA incluido), ventas por sucursal, por día, por prenda, por tipo de prenda, por método de pago y por vendedor, stock crítico y descarga en PDF.*

## Funcionalidades principales

- **Multi-sucursal con roles.** Cuatro puestos de empleado (DISTRITAL, ADMIN, CAJERO, BODEGUERO). El DISTRITAL opera sobre todas las sucursales; los demás puestos trabajan dentro de la sucursal asignada. Las clientas tienen una sesión independiente en la tienda.
- **Venta en tienda en línea y en mostrador.** La clienta compra desde la tienda eligiendo la sucursal de envío; el cajero registra ventas presenciales desde el panel y cobra en efectivo o con tarjeta (POS).
- **Pagos con Stripe.** Cobro con tarjeta en la tienda mediante Stripe.js, confirmación del cobro desde el backend y webhook firmado (`/api/webhook`). La clave secreta solo existe en el backend.
- **Devoluciones y cambios con logística inversa.** Una sola solicitud por pedido dentro del plazo configurado (24 horas desde la entrega por defecto). La solicitud recorre una máquina de estados (SOLICITADA, APROBADA, RECIBIDA, EN_REVISION, ACEPTADA y cierre como REINTEGRADA o CAMBIADA, o rechazo) que impide saltarse pasos; los movimientos de inventario y la bitácora de auditoría dejan la trazabilidad de cada operación.
- **Reembolsos.** Registro de reembolsos por Stripe o por otros métodos, con estados PENDIENTE, COMPLETADO y FALLIDO; los reembolsos a tarjeta pendientes se reintentan de forma periódica.
- **Cupones, envío e IVA.** Cupones por porcentaje o por monto, costo de envío a domicilio con umbral de envío gratis, e IVA incluido en los precios y desglosado en pedidos y reportes (valores configurables en `.env`).
- **Reportes con PDF.** Indicadores y desgloses de ventas por periodo y sucursal, exportables a PDF desde el panel.
- **Fotos de prendas en Cloudinary.** Carga y eliminación de fotografías de prendas almacenadas en Cloudinary.
- **Correos a clientas.** Avisos de pedido pagado, enviado, entregado y cancelado, de devoluciones y reembolsos, y recuperación de contraseña, enviados por SMTP (nodemailer).
- **Vencimiento de pedidos.** Los pedidos pendientes de pago se cancelan automáticamente al vencer su plazo (24 horas por defecto); la revisión se ejecuta cada cierto número de minutos.
- **Monitoreo.** Identificador por petición (cabecera `X-Request-Id`), registro de toda respuesta 5xx en la tabla `ErrorServidor`, manejador de errores en JSON sin exponer la pila y envío opcional a Sentry.
- **Migraciones y respaldos.** Esquema versionado con migraciones (Umzug) que el servidor aplica al arrancar, y scripts de respaldo y restauración con `pg_dump`/`pg_restore`.

## Tecnologías

Versiones tomadas de los archivos `package.json` de cada parte.

| Parte | Tecnología | Versión |
|---|---|---|
| API (raíz) | Express | ^5.2.1 |
| | Sequelize (ORM) | ^6.37.8 |
| | pg / pg-hstore (controlador PostgreSQL) | ^8.22.0 / ^2.3.4 |
| | Umzug (migraciones) | 3.8.3 |
| | jsonwebtoken (sesiones JWT) | ^9.0.3 |
| | bcryptjs (contraseñas) | ^3.0.3 |
| | stripe (SDK de pagos) | ^22.6.0 |
| | nodemailer (correos) | 10.1.0 |
| | cors · body-parser · dotenv | ^2.8.6 · ^2.3.0 · ^17.4.2 |
| | playwright-core (pruebas de interfaz, desarrollo) | 1.63.0 |
| Panel (`frontend/`) | React · React DOM | ^19.3.1 |
| | React Router DOM | ^7.18.4 |
| | jsPDF · jspdf-autotable (reportes PDF) | 4.2.1 · 5.0.8 |
| | Vite · @vitejs/plugin-react | ^8.3.4 · ^6.1.2 |
| Tienda (`tienda/`) | React · React DOM | ^19.3.1 |
| | React Router DOM | ^7.18.4 |
| | @stripe/stripe-js · @stripe/react-stripe-js | 9.17.0 · 6.12.0 |
| | Vite · @vitejs/plugin-react | ^8.3.4 · ^6.1.2 |
| Servicios externos | PostgreSQL en Neon (con pooler PgBouncer), Stripe, Cloudinary, SMTP | — |
| Hospedaje | Render (API, panel y tienda) | — |

## Estructura del repositorio

```text
distribuidora-backend/
├── server.js               Punto de entrada de la API (Express): CORS, rutas, monitoreo y migraciones al arrancar
├── app/
│   ├── config/             Configuración de base de datos, JWT, Stripe y Cloudinary
│   ├── models/             Modelos Sequelize (sucursal, empleado, cliente, producto, inventario, pedido, pago, devolución, reembolso, cupón, auditoría…)
│   ├── controllers/        Lógica de cada recurso de la API
│   ├── routes/             Definición de endpoints bajo /api
│   ├── middlewares/        Autenticación y roles (authJwt), límite de intentos, validación de ids
│   ├── utils/              Reglas compartidas: totales, precios, cupones, plazos, estados de devolución, reembolsos, vencimientos, correo, monitoreo, migrador
│   └── migraciones/        Migraciones versionadas del esquema (0001 a 0005)
├── frontend/               Panel de empleados (React + Vite, puerto 8081)
├── tienda/                 Tienda en línea para clientas (React + Vite, puerto 8082)
├── tests/
│   ├── correr.js           Ejecutor de pruebas sobre un PostgreSQL desechable
│   ├── api/                Pruebas de la API
│   ├── navegador/          Pruebas de interfaz con Chrome/Edge (playwright-core)
│   └── soporte/            Arranque de PostgreSQL de prueba, ubicación de Chrome, Cloudinary simulado
├── postman/                Colección de Postman y su generador
├── scripts/                migrar.js, respaldo.js, restaurar.js
├── docs/                   Documentación técnica y capturas (docs/img/)
└── .env.example            Plantilla de variables de entorno (sin valores reales)
```

## Inicio rápido en local

### Requisitos

- Node.js y npm. Express 5 (API) requiere Node.js 18 o superior y Vite 8 (panel y tienda) requiere Node.js 20.19 o superior dentro de la versión 20, o 22.12 o superior.
- Una base de datos PostgreSQL accesible (local o en Neon).
- Para las pruebas: binarios de PostgreSQL instalados (`pg_ctl`, `initdb`; se detectan en `C:/Program Files/PostgreSQL` o en el PATH, o se indican con `PG_BIN`) y, para las pruebas de interfaz, Chrome o Edge (ruta configurable con `CHROME_PATH`).
- Para respaldos: `pg_dump` y `pg_restore`.
- Opcional: cuentas de Stripe (modo prueba), Cloudinary y un servidor SMTP.

### 1. Instalar dependencias

```bash
npm install                 # API (raíz)
cd frontend && npm install  # panel de empleados
cd ../tienda && npm install # tienda en línea
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env.development            # API: base de datos, JWT_SECRET, Stripe, Cloudinary, SMTP
cp frontend/.env.example frontend/.env      # VITE_API_URL
cp tienda/.env.example tienda/.env          # VITE_API_URL y VITE_STRIPE_PUBLISHABLE_KEY
```

La API carga `.env.development`, o `.env.production` cuando `NODE_ENV=production`. Ningún archivo `.env` real debe subirse al repositorio (están excluidos en `.gitignore`). Aspectos relevantes de la plantilla:

- `CORS_ORIGIN` admite por defecto `http://localhost:8081` y `http://localhost:8082`.
- Con `STRIPE_SECRET_KEY=sk_test_clave_de_prueba_universidad` el backend simula los cobros (pago aprobado al instante, sin llamar a Stripe). Con claves reales de prueba se usa la tarjeta `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
- Sin `SMTP_HOST` no se envían correos; solo se muestran en consola.
- Para una base local sin SSL se define `DB_SSL=false`.

### 3. Ejecutar

```bash
npm start                    # API en http://localhost:8080 (aplica las migraciones pendientes antes de escuchar)
cd frontend && npm run dev   # panel en http://localhost:8081
cd tienda && npm run dev     # tienda en http://localhost:8082
```

Con la base vacía, el primer empleado se registra sin sesión (`POST /api/auth/registro`) y queda automáticamente con el puesto DISTRITAL; a partir de ese momento solo un ADMIN o el DISTRITAL autenticados registran empleados desde la pantalla Empleados del panel.

## Comandos útiles

Ejecutados desde la raíz del repositorio:

| Comando | Descripción |
|---|---|
| `npm start` | Inicia la API (`node server.js`). |
| `npm test` | Pruebas de la API sobre un PostgreSQL desechable (`tests/.pgdata`, puerto 54329); nunca usa la base de `.env.development`. |
| `npm run test:navegador` | Pruebas de interfaz del panel y la tienda con Chrome o Edge. |
| `npm run test:todo` | Todas las pruebas (API e interfaz). |
| `node tests/correr.js api/ventas` | Solo las suites cuyo nombre contiene el filtro indicado. |
| `npm run migrar` | Aplica las migraciones pendientes (el servidor también lo hace al arrancar). |
| `npm run migrar:estado` | Lista migraciones aplicadas y pendientes y avisa si un modelo tiene columnas sin migración. |
| `npm run respaldo` | Respaldo con `pg_dump` en `respaldos/<base>-AAAAMMDD-HHMMSS.dump`; conserva los últimos `RESPALDOS_MAX` (14 por defecto). |
| `npm run restaurar -- respaldos/<archivo>.dump --base <nombre>` | Restaura un respaldo, reemplazando el contenido de la base; antes crea un respaldo de seguridad. El servidor debe estar detenido. |

En `frontend/` y `tienda/` están disponibles `npm run dev`, `npm run build` y `npm run preview`.

## Documentación

| Documento | Contenido |
|---|---|
| [01 · Arquitectura](docs/01-arquitectura.md) | Componentes del sistema, servicios externos y capas del backend. |
| [02 · Modelo de datos](docs/02-modelo-de-datos.md) | Diagrama entidad-relación y descripción de cada tabla. |
| [03 · Roles y permisos](docs/03-roles-y-permisos.md) | Puestos de empleado, clienta y alcance por sucursal. |
| [04 · Reglas de negocio](docs/04-reglas-de-negocio.md) | Pedidos, pagos, devoluciones, reembolsos, cupones, envío, IVA y vencimientos. |
| [05 · API](docs/05-api.md) | Endpoints por módulo, autenticación, errores y colección de Postman. |
| [06 · Manual de usuario](docs/06-manual-de-usuario.md) | Guía paso a paso por rol en el panel y en la tienda. |
| [07 · Seguridad](docs/07-seguridad.md) | Contraseñas, sesiones, límite de intentos y protección de pagos. |
| [08 · Pruebas](docs/08-pruebas.md) | Estrategia, ejecución y cobertura de las pruebas. |
| [09 · Despliegue y operación](docs/09-despliegue-y-operacion.md) | Publicación en Render, variables, migraciones, respaldos y monitoreo. |

## Licencia y uso académico

Este proyecto fue desarrollado como trabajo académico del curso Desarrollo Web de la Universidad Mariano Gálvez de Guatemala. El archivo `package.json` declara la licencia ISC. Los datos que aparecen en las capturas son de prueba, y los servicios externos (Stripe, Cloudinary, SMTP) se utilizan en modo de prueba o con credenciales propias que no forman parte del repositorio. Su uso, copia o adaptación fuera del ámbito académico requiere la autorización de los integrantes del equipo.
