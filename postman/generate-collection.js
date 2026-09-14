#!/usr/bin/env node
/**
 * Genera distribuidora-backend.postman_collection.json (Postman v2.1) a partir
 * de una definicion declarativa de cada endpoint real del backend. Se
 * regenera este archivo, no se edita el JSON a mano, cada vez que se
 * agregue/cambie un endpoint.
 *
 * Formato basado en el generador que SI importa correctamente en el entorno
 * del usuario (ver docs/api-testing/generate-collection.js del proyecto
 * Lumiere): url como string plano (NO objeto {raw,host,path} - rompe la
 * resolucion de variables {{...}} en algunos clientes), "id" por item,
 * "response": [] en cada request, variables sin campo "type".
 *
 * Uso: node postman/generate-collection.js
 */
const fs = require("node:fs");
const path = require("node:path");

let itemIdCounter = 0;
function uid() {
  itemIdCounter += 1;
  return `distribuidora-${itemIdCounter}`;
}

// Marca un campo del body para que se sustituya como {{variable}} SIN comillas
// (numero/boolean crudo) en vez de como string JSON - necesario cuando el
// controlador compara el valor con === contra un campo numerico de la BD.
function rawVar(name) {
  return `__RAWVAR__${name}__RAWVAR__`;
}

function jsonBody(obj) {
  let raw = JSON.stringify(obj, null, 2);
  raw = raw.replace(/"__RAWVAR__([a-zA-Z0-9_]+)__RAWVAR__"/g, "{{$1}}");
  return {
    mode: "raw",
    raw,
    options: { raw: { language: "json" } },
  };
}

/**
 * @param {string} name
 * @param {"GET"|"POST"|"PUT"|"DELETE"} method
 * @param {string} urlPath - relativo a {{baseUrl}}, ej "/api/productos/{{id_producto}}/historial"
 */
function req(name, method, urlPath, opts = {}) {
  const { body, auth, description, tests, query, prerequest } = opts;

  const headers = [];
  if (body) headers.push({ key: "Content-Type", value: "application/json" });
  if (auth) headers.push({ key: "Authorization", value: "Bearer {{token}}" });

  const encodeQueryValue = (v) => (/^\{\{.*\}\}$/.test(String(v)) ? v : encodeURIComponent(v));

  let rawUrl = `{{baseUrl}}${urlPath}`;
  if (query) {
    const qs = Object.entries(query)
      .map(([k, v]) => `${k}=${encodeQueryValue(v)}`)
      .join("&");
    rawUrl += `?${qs}`;
  }

  const event = [];
  if (prerequest) {
    event.push({
      listen: "prerequest",
      script: { type: "text/javascript", exec: prerequest.split("\n") },
    });
  }
  if (tests) {
    event.push({
      listen: "test",
      script: { type: "text/javascript", exec: tests.split("\n") },
    });
  }

  return {
    id: uid(),
    name,
    event: event.length ? event : undefined,
    request: {
      method,
      header: headers,
      body: body ? jsonBody(body) : undefined,
      url: rawUrl,
      description,
    },
    response: [],
  };
}

function folder(name, items, description) {
  return { id: uid(), name, description, item: items };
}

function expectStatus(code, label) {
  return `pm.test("${label ?? `Responde ${code}`}", () => pm.response.to.have.status(${code}));`;
}

function captureId(varName, jsonPath, label) {
  return `
pm.test("${label ?? "Creado correctamente"}", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));
const body = pm.response.json();
const value = ${jsonPath};
if (value) pm.collectionVariables.set("${varName}", value);
`.trim();
}

// ---------------------------------------------------------------------------
// 0. Autenticacion
// ---------------------------------------------------------------------------

const CAPTURE_LOGIN = `
pm.test("Login exitoso", () => pm.response.to.have.status(200));
const body = pm.response.json();
if (body.token) pm.collectionVariables.set("token", body.token);
if (body.id_sucursal) pm.collectionVariables.set("id_sucursal", body.id_sucursal);
if (body.id) pm.collectionVariables.set("id_empleado", body.id);
`.trim();

const auth = folder(
  "0. Autenticación",
  [
    req("Registro de empleado", "POST", "/api/auth/registro", {
      prerequest: 'pm.collectionVariables.set("empleado_email", `juan.perez.${Date.now()}@example.com`);',
      body: {
        nombre: "Juan",
        apellido: "Perez",
        puesto: "ADMIN",
        email: "{{empleado_email}}",
        password: "Password123",
        id_sucursal: "{{id_sucursal}}",
      },
      tests: expectStatus(201, "Empleado registrado"),
      description:
        "Crea un empleado. El puesto determina los permisos (ADMIN, CAJERO, BODEGUERO). El email se genera dinamicamente (empleado_email) para poder correr la coleccion varias veces sin chocar con el email de una corrida anterior (email es unico a nivel de base de datos aunque el modelo Empleado no lo declare explicitamente).",
    }),
    req("Login", "POST", "/api/auth/login", {
      body: { email: "{{empleado_email}}", password: "Password123" },
      tests: CAPTURE_LOGIN,
      description:
        "Guarda el JWT en la variable de coleccion `token`, usado por el resto de requests protegidas. Depende de haber corrido 'Registro de empleado' antes en la misma ejecucion (usa el email generado ahi).",
    }),
  ],
  "Ejecutar Registro y Login antes que cualquier request marcada como protegida (usa el header Authorization: Bearer {{token}}).",
);

// ---------------------------------------------------------------------------
// 1. Sucursales
// ---------------------------------------------------------------------------

const sucursales = folder("1. Sucursales", [
  req("Crear sucursal", "POST", "/api/sucursales", {
    body: { nombre: "Sucursal Centro", direccion: "5ta avenida 10-20", ciudad: "Guatemala", telefono: "22334455", activo: true },
    tests: captureId("id_sucursal", "body.id_sucursal", "Sucursal creada"),
  }),
  req("Listar sucursales", "GET", "/api/sucursales", {
    tests: expectStatus(200),
  }),
  req("Actualizar sucursal", "PUT", "/api/sucursales/{{id_sucursal}}", {
    body: { telefono: "22339999", activo: true },
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 2. Clientes
// ---------------------------------------------------------------------------

const clientes = folder("2. Clientes", [
  req("Crear cliente", "POST", "/api/clientes", {
    body: { nombre: "Maria", apellido: "Lopez", telefono: "55667788", email: "maria.lopez.{{$timestamp}}@example.com", direccion: "Zona 10, Guatemala", activo: true },
    tests: captureId("id_cliente", "body.id_cliente", "Cliente creado"),
    description: "email con {{$timestamp}} porque Cliente.email es unique en el modelo (app/models/cliente.model.js) - un valor fijo solo funciona la primera vez que se corre la coleccion.",
  }),
  req("Listar clientes", "GET", "/api/clientes", {
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 3. Proveedores
// ---------------------------------------------------------------------------

const proveedores = folder("3. Proveedores", [
  req("Crear proveedor", "POST", "/api/proveedores", {
    body: { nombre_empresa: "Textiles S.A.", nombre_contacto: "Carlos Ramirez", telefono: "22221111", email: "contacto@textiles.com", direccion: "Zona 4, Guatemala", activo: true },
    tests: captureId("id_proveedor", "body.id_proveedor", "Proveedor creado"),
  }),
  req("Listar proveedores", "GET", "/api/proveedores", {
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 4. Categorias
// ---------------------------------------------------------------------------

const categorias = folder("4. Categorías", [
  req("Crear categoria", "POST", "/api/categorias", {
    body: { nombre: "Camisas-{{$timestamp}}", descripcion: "Camisas de vestir y casuales" },
    tests: captureId("id_categoria", "body.id_categoria", "Categoria creada"),
    description: "nombre con {{$timestamp}} porque Categoria.nombre es unique en el modelo (app/models/categoria.model.js) - un valor fijo solo funciona la primera vez que se corre la coleccion.",
  }),
  req("Listar categorias", "GET", "/api/categorias", {
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 5. Empleados
// ---------------------------------------------------------------------------

const empleados = folder("5. Empleados", [
  req("Crear empleado", "POST", "/api/empleados", {
    body: {
      nombre: "Ana",
      apellido: "Gomez",
      puesto: "CAJERO",
      telefono: "41234567",
      email: "ana.gomez.{{$timestamp}}@example.com",
      fecha_contratacion: "2026-01-15",
      id_sucursal: "{{id_sucursal}}",
      activo: true,
    },
    tests: captureId("id_empleado", "body.id_empleado", "Empleado creado"),
    description: "email con {{$timestamp}} porque la columna email de Empleado es unica en la base de datos (aunque el modelo Sequelize no lo declare) - un valor fijo solo funciona la primera vez que se corre la coleccion.",
  }),
  req("Listar empleados", "GET", "/api/empleados", {
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 6. Productos
// ---------------------------------------------------------------------------

const productos = folder("6. Productos", [
  req("Crear producto", "POST", "/api/productos", {
    body: {
      nombre: "Camisa Manga Larga",
      descripcion: "Camisa de algodon",
      talla: "M",
      color: "Azul",
      precio_unitario: 150.0,
      id_categoria: "{{id_categoria}}",
      stock_minimo: 5,
      activo: true,
    },
    tests: captureId("id_producto", "body.id_producto", "Producto creado"),
  }),
  req("Listar productos", "GET", "/api/productos", {
    tests: expectStatus(200),
  }),
  req("Historial de producto", "GET", "/api/productos/{{id_producto}}/historial", {
    auth: true,
    tests: expectStatus(200),
    description: "Requiere estar autenticado (cualquier empleado).",
  }),
]);

// ---------------------------------------------------------------------------
// 7. Inventario
// ---------------------------------------------------------------------------

const inventario = folder("7. Inventario", [
  req("Crear registro de inventario", "POST", "/api/inventario", {
    auth: true,
    body: { id_producto: "{{id_producto}}", id_sucursal: "{{id_sucursal}}", cantidad: 50, lote: "L-2026-001", estado: "DISPONIBLE" },
    tests: captureId("id_inventario", "body.id_inventario", "Inventario registrado"),
    description: "Requiere rol BODEGUERO o ADMIN.",
  }),
  req("Listar inventario", "GET", "/api/inventario", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("Stock global", "GET", "/api/inventario/stock", {
    auth: true,
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 8. Pedidos
// ---------------------------------------------------------------------------

const pedidos = folder("8. Pedidos", [
  req("Crear pedido / venta", "POST", "/api/pedidos", {
    auth: true,
    body: {
      id_cliente: "{{id_cliente}}",
      id_sucursal: "{{id_sucursal}}",
      id_producto: "{{id_producto}}",
      cantidad: 2,
      precio_unitario: 150.0,
      total: 300.0,
      id_empleado: "{{id_empleado}}",
    },
    tests: captureId("id_pedido", "body.pedido && body.pedido.id_pedido", "Venta procesada"),
    description: "Requiere rol CAJERO o ADMIN. Descuenta stock de Inventario usando FIFO por orden de ingreso (id_inventario ASC).",
  }),
  req("Listar pedidos", "GET", "/api/pedidos", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("Obtener pedido por id", "GET", "/api/pedidos/{{id_pedido}}", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("Actualizar estado de pedido", "PUT", "/api/pedidos/{{id_pedido}}/estado", {
    auth: true,
    body: { estado: "ENTREGADO" },
    tests: expectStatus(200),
    description:
      "Marca el pedido como ENTREGADO - precondición para poder solicitar devoluciones/cambios sobre él (ver folder 12). Estados válidos: PENDIENTE, PROCESADO, ENVIADO, ENTREGADO, CANCELADO.",
  }),
  req("Historial de pedido", "GET", "/api/pedidos/{{id_pedido}}/historial", {
    auth: true,
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 9. Detalle Pedido
// ---------------------------------------------------------------------------

const detallePedido = folder("9. Detalle Pedido", [
  req("Crear detalle de pedido", "POST", "/api/detalles", {
    body: { id_pedido: "{{id_pedido}}", id_producto: "{{id_producto}}", id_sucursal: "{{id_sucursal}}", cantidad: 2, precio_unitario: 150.0 },
    tests: captureId("id_detalle_pedido", "body.id_detalle_pedido", "Detalle creado"),
    description:
      "Descuenta directamente de Inventario (no usa FIFO ni crea movimiento de inventario, a diferencia de POST /api/pedidos). cantidad=2 a propósito: el folder 12 (Devoluciones) pide 1 unidad de este detalle para una devolución y otra unidad para un cambio de talla, sobre el mismo detalle.",
  }),
  req("Listar detalles de pedido", "GET", "/api/detalles", {
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 10. Pagos
// ---------------------------------------------------------------------------

const pagos = folder("10. Pagos", [
  req("Registrar pago", "POST", "/api/pagos", {
    auth: true,
    body: { metodo_pago: "PAYPAL", monto: 300.0, id_pedido: "{{id_pedido}}" },
    tests: captureId("id_pago", "body.pago && body.pago.id_pago", "Pago registrado"),
    description:
      "Requiere rol CAJERO o ADMIN. metodo_pago debe ser 'STRIPE' o 'PAYPAL' (unicos valores del ENUM en app/models/pago.model.js - cualquier otro valor, como 'EFECTIVO', falla con 400). Se usa PAYPAL por defecto para no depender de la API real de Stripe; cambiar a 'STRIPE' intenta crear un PaymentIntent real con STRIPE_SECRET_KEY.",
  }),
  req("Listar pagos", "GET", "/api/pagos", {
    auth: true,
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 11. Reportes
// ---------------------------------------------------------------------------

const reportes = folder("11. Reportes", [
  req("Historial de ventas", "GET", "/api/reportes/ventas", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("Stock critico", "GET", "/api/reportes/stock-critico", {
    auth: true,
    tests: expectStatus(200),
    description: "Suma el stock DISPONIBLE por producto/sucursal y lo compara contra Producto.stock_minimo. Con los datos de esta coleccion normalmente da un arreglo vacio (el stock creado supera el minimo); para verlo con resultados, crea un producto con stock_minimo alto o registra poco inventario.",
  }),
]);

// ---------------------------------------------------------------------------
// 12. Devoluciones
// ---------------------------------------------------------------------------

const devoluciones = folder("12. Devoluciones", [
  req("Crear solicitud de devolucion", "POST", "/api/devoluciones", {
    body: {
      id_pedido: "{{id_pedido}}",
      id_cliente: "{{id_cliente}}",
      tipo: "DEVOLUCION",
      motivo: "DEFECTUOSO",
      observacion: "El cliente indica una costura suelta",
      detalles: [{ id_detalle_pedido: "{{id_detalle_pedido}}", cantidad: 1 }],
    },
    tests: captureId("id_devolucion", "body.devolucion && body.devolucion.id_devolucion", "Devolucion solicitada"),
    description: "El pedido debe existir, pertenecer a id_cliente y estar en estado ENTREGADO. motivo es un ENUM (DEFECTUOSO, TALLA_INCORRECTA, PRODUCTO_INCORRECTO, DANADO_ENVIO, OTRO) - ver app/models/devolucion.model.js.",
  }),
  req("Crear solicitud de cambio de talla/variante", "POST", "/api/devoluciones", {
    body: {
      id_pedido: "{{id_pedido}}",
      id_cliente: "{{id_cliente}}",
      tipo: "CAMBIO_TALLA",
      motivo: "TALLA_INCORRECTA",
      observacion: "Cliente solicita talla mas grande",
      detalles: [{ id_detalle_pedido: "{{id_detalle_pedido}}", cantidad: 1, id_producto_nuevo: "{{id_producto_nuevo}}" }],
    },
    tests: expectStatus(201),
  }),
  req("Listar devoluciones", "GET", "/api/devoluciones", {
    tests: expectStatus(200),
  }),
  req("Obtener devolucion por id", "GET", "/api/devoluciones/{{id_devolucion}}", {
    tests: `
pm.test("Responde 200", () => pm.response.to.have.status(200));
const body = pm.response.json();
if (body.DetalleDevolucions && body.DetalleDevolucions.length) {
  pm.collectionVariables.set("id_detalle_devolucion", body.DetalleDevolucions[0].id_detalle_devolucion);
}
`.trim(),
    description: "Tambien captura id_detalle_devolucion (necesario, sin comillas, para 'Revisar devolucion').",
  }),
  req("Aprobar devolucion", "PUT", "/api/devoluciones/{{id_devolucion}}/aprobar", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("Rechazar devolucion", "PUT", "/api/devoluciones/{{id_devolucion}}/rechazar", {
    auth: true,
    tests: expectStatus(400, "400 esperado: esta misma devolucion ya fue APROBADA por la request anterior, y la maquina de estados solo permite APROBADA -> RECIBIDA (rechazar solo es valido desde SOLICITADA)"),
    description: "Se espera 400 aqui: es la rama alterna a 'Aprobar', no un paso posterior. Ver app/utils/estadosDevolucion.js.",
  }),
  req("Recibir devolucion", "PUT", "/api/devoluciones/{{id_devolucion}}/recibir", {
    auth: true,
    tests: expectStatus(200),
    description: "La prenda fisica llega de vuelta a la sucursal. Requiere que la devolucion este APROBADA.",
  }),
  req("Revisar devolucion", "PUT", "/api/devoluciones/{{id_devolucion}}/revisar", {
    auth: true,
    body: { aceptar: true, detalles: [{ id_detalle_devolucion: rawVar("id_detalle_devolucion"), resultado_revision: "BUEN_ESTADO" }] },
    tests: expectStatus(200),
    description: "resultado_revision debe ser uno de: BUEN_ESTADO, DANADO, DEFECTUOSO. Requiere que la devolucion este RECIBIDA.",
  }),
  req("Reintegrar devolucion a inventario", "PUT", "/api/devoluciones/{{id_devolucion}}/reintegrar", {
    auth: true,
    tests: expectStatus(200),
    description: "Solo para tipo=DEVOLUCION en estado ACEPTADA.",
  }),
  req("Procesar cambio de talla/variante", "PUT", "/api/devoluciones/{{id_devolucion}}/cambiar", {
    auth: true,
    tests: expectStatus(400, "400 esperado: {{id_devolucion}} es la devolucion tipo=DEVOLUCION creada al inicio del folder (ya REINTEGRADA por el paso anterior); esta accion es solo para CAMBIO_TALLA/CAMBIO_VARIANTE"),
    description: "Se espera 400 aqui con el flujo de esta coleccion: solo aplica a tipo=CAMBIO_TALLA/CAMBIO_VARIANTE en estado ACEPTADA, y {{id_devolucion}} ya quedo REINTEGRADA (y es tipo=DEVOLUCION) por los pasos anteriores del folder.",
  }),
]);

// ---------------------------------------------------------------------------
// 13. Auditoria
// ---------------------------------------------------------------------------

const auditoria = folder("13. Auditoría", [
  req("Registrar auditoria manual", "POST", "/api/auditoria", {
    auth: true,
    body: { accion: "ACCION_MANUAL", tabla_afectada: "Producto", registro_afectado_id: "{{id_producto}}", detalles: "Registro de auditoria manual desde Postman" },
    tests: expectStatus(201),
  }),
  req("Listar auditoria", "GET", "/api/auditoria", {
    auth: true,
    query: { tabla_afectada: "Producto", registro_afectado_id: "{{id_producto}}" },
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 14. Webhook (Stripe)
// ---------------------------------------------------------------------------

const webhook = folder(
  "14. Webhook (Stripe)",
  [
    req("Stripe webhook (referencia, no ejecutar desde Postman)", "POST", "/api/webhook", {
      tests: `pm.test("Firma invalida rechazada", () => pm.expect(pm.response.code).to.equal(400));`,
      description:
        "Este endpoint valida la firma real de Stripe contra STRIPE_WEBHOOK_SECRET usando el body crudo. Llamado desde Postman con una firma inventada siempre respondera 400. Para probarlo de verdad usa el Stripe CLI: `stripe listen --forward-to localhost:8080/api/webhook` y `stripe trigger payment_intent.succeeded`.",
    }),
  ],
  "Endpoint de uso interno de Stripe. Se deja documentado por completitud, no para ejecutarse tal cual desde Postman.",
);
// Se agrega manualmente el header stripe-signature en la request de arriba mediante el body ya que
// `req()` no soporta headers custom - ver ajuste puntual debajo.
webhook.item[0].request.header.push({ key: "stripe-signature", value: "t=0,v1=firma_invalida_de_ejemplo" });
webhook.item[0].request.body = jsonBody({ id: "evt_ejemplo", type: "payment_intent.succeeded", data: { object: { id: "pi_ejemplo" } } });

// ---------------------------------------------------------------------------

const collection = {
  info: {
    _postman_id: "d1b1a2f0-0000-4000-8000-000000000001",
    name: "Distribuidora Backend — API completa",
    description:
      "Colección importable en Postman con todos los endpoints reales del backend distribuidora-backend (Express + Sequelize + PostgreSQL), agrupados por módulo.\n\nRequiere el backend corriendo (`npm start`, puerto definido en .env.development, por defecto 8080). Ejecutar primero '0. Autenticación > Registro' y 'Login' - el token JWT se guarda automáticamente en la variable de colección `token` y las requests protegidas lo usan vía el header Authorization.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [auth, sucursales, clientes, proveedores, categorias, empleados, productos, inventario, pedidos, detallePedido, pagos, reportes, devoluciones, auditoria, webhook],
  variable: [
    { key: "baseUrl", value: "http://localhost:8080" },
    { key: "token", value: "" },
    { key: "empleado_email", value: "" },
    { key: "id_sucursal", value: "1" },
    { key: "id_cliente", value: "1" },
    { key: "id_proveedor", value: "1" },
    { key: "id_categoria", value: "1" },
    { key: "id_empleado", value: "1" },
    { key: "id_producto", value: "1" },
    { key: "id_producto_nuevo", value: "2" },
    { key: "id_inventario", value: "1" },
    { key: "id_pedido", value: "1" },
    { key: "id_detalle_pedido", value: "1" },
    { key: "id_pago", value: "1" },
    { key: "id_devolucion", value: "1" },
    { key: "id_detalle_devolucion", value: "1" },
  ],
};

const outPath = path.join(__dirname, "distribuidora-backend.postman_collection.json");
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2) + "\n");

const totalRequests = collection.item.reduce((sum, f) => sum + f.item.length, 0);
console.log(`Generado: ${outPath}`);
console.log(`Folders: ${collection.item.length} · Requests totales: ${totalRequests}`);
