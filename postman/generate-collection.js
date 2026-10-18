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
    req("Registro inicial (primer ADMIN)", "POST", "/api/auth/registro", {
      body: {
        nombre: "Admin",
        apellido: "Principal",
        email: "{{admin_email}}",
        password: "{{admin_password}}",
      },
      tests: `pm.test("201 con la BD sin empleados; 403 si ya existen (se usa el ADMIN existente)", () => pm.expect(pm.response.code).to.be.oneOf([201, 403]));`,
      description:
        "Solo funciona con la base de datos SIN empleados: ese primer empleado queda siempre como ADMIN (ignora el puesto). Si ya hay empleados responde 403: en ese caso pon en las variables de coleccion admin_email/admin_password las credenciales de un ADMIN existente.",
    }),
    req("Login", "POST", "/api/auth/login", {
      body: { email: "{{admin_email}}", password: "{{admin_password}}" },
      tests: CAPTURE_LOGIN,
      description:
        "Guarda el JWT del ADMIN en la variable de coleccion `token`, usado por el resto de requests protegidas.",
    }),
    req("Registro sin token (rechazado)", "POST", "/api/auth/registro", {
      body: { nombre: "Intruso", apellido: "X", puesto: "ADMIN", email: "intruso.{{$timestamp}}@example.com", password: "Password123" },
      tests: expectStatus(403, "403 esperado: con empleados ya registrados solo un ADMIN autenticado puede registrar"),
    }),
  ],
  "Ejecutar Registro inicial y Login antes que cualquier request marcada como protegida (usa el header Authorization: Bearer {{token}}). Registrar empleados requiere un ADMIN (ver folder 5).",
);

// ---------------------------------------------------------------------------
// 1. Sucursales
// ---------------------------------------------------------------------------

const sucursales = folder("1. Sucursales", [
  req("Crear sucursal", "POST", "/api/sucursales", {
    auth: true,
    body: { nombre: "Sucursal Centro", direccion: "5ta avenida 10-20", ciudad: "Guatemala", telefono: "22334455", activo: true },
    tests: captureId("id_sucursal", "body.id_sucursal", "Sucursal creada"),
    description: "Requiere rol ADMIN.",
  }),
  req("Listar sucursales", "GET", "/api/sucursales", {
    tests: expectStatus(200),
    description: "Publico (lo usan el frontend y la tienda).",
  }),
  req("Actualizar sucursal", "PUT", "/api/sucursales/{{id_sucursal}}", {
    auth: true,
    body: { telefono: "22339999", activo: true },
    tests: expectStatus(200),
    description: "Requiere rol ADMIN. Solo aplica nombre, direccion, ciudad, telefono y activo (boolean); cualquier otro campo se ignora.",
  }),
  req("Actualizar sucursal sin token (rechazado)", "PUT", "/api/sucursales/{{id_sucursal}}", {
    body: { activo: false },
    tests: expectStatus(403, "403 esperado: modificar sucursales requiere un ADMIN autenticado"),
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
    auth: true,
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
  req("Registrar cajero (requiere ADMIN)", "POST", "/api/auth/registro", {
    auth: true,
    body: { nombre: "Carla", apellido: "Cajera", puesto: "CAJERO", email: "carla.cajera.{{$timestamp}}@example.com", password: "Password123", id_sucursal: "{{id_sucursal}}" },
    tests: expectStatus(201, "Cajero registrado por el ADMIN"),
    description: "Registro de empleados con contraseña (pueden iniciar sesion). Requiere token de ADMIN. puesto debe ser ADMIN, CAJERO o BODEGUERO.",
  }),
  req("Crear empleado", "POST", "/api/empleados", {
    auth: true,
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
    tests: expectStatus(201, "Empleado creado"),
    description: "Requiere rol ADMIN. Ficha de empleado sin contraseña (no puede iniciar sesion; para eso usar 'Registrar cajero'). email con {{$timestamp}} porque la columna email de Empleado es unica en la base de datos (aunque el modelo Sequelize no lo declare) - un valor fijo solo funciona la primera vez que se corre la coleccion.",
  }),
  req("Listar empleados", "GET", "/api/empleados", {
    auth: true,
    tests: `${expectStatus(200)}
pm.test("No expone contraseñas", () => pm.expect(pm.response.json().every(e => !("password" in e))).to.be.true);`,
    description: "Requiere estar autenticado. Nunca devuelve el hash de la contraseña.",
  }),
]);

// ---------------------------------------------------------------------------
// 6. Productos
// ---------------------------------------------------------------------------

const productos = folder("6. Productos", [
  req("Crear producto", "POST", "/api/productos", {
    auth: true,
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
    description: "Requiere rol BODEGUERO o ADMIN.",
  }),
  req("Crear variante (talla L)", "POST", "/api/productos", {
    auth: true,
    body: {
      nombre: "Camisa Manga Larga",
      descripcion: "Camisa de algodon",
      talla: "L",
      color: "Azul",
      precio_unitario: 150.0,
      id_categoria: "{{id_categoria}}",
      stock_minimo: 5,
      activo: true,
      id_producto_padre: rawVar("id_producto"),
    },
    tests: captureId("id_producto_nuevo", "body.id_producto", "Variante creada"),
    description: "Variante del producto anterior (mismo grupo por id_producto_padre). La usa 'Crear solicitud de cambio de talla/variante' como id_producto_nuevo.",
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
  req("Crear inventario de la variante", "POST", "/api/inventario", {
    auth: true,
    body: { id_producto: "{{id_producto_nuevo}}", id_sucursal: "{{id_sucursal}}", cantidad: 10, lote: "L-2026-002", estado: "DISPONIBLE" },
    tests: expectStatus(201),
    description: "Stock de la variante para que el cambio de talla de la carpeta 13 tenga disponibilidad.",
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

// Guarda el total recalculado por los hooks de DetallePedido (lo usa "Registrar pago").
const CAPTURE_TOTAL = `
const respTotal = pm.response.json();
const total = respTotal.total_pedido ?? (respTotal.pedido && respTotal.pedido.total);
if (total != null) pm.collectionVariables.set("total_pedido", Number(total));
`.trim();

const pedidos = folder("8. Pedidos", [
  req("Crear pedido / venta", "POST", "/api/pedidos", {
    auth: true,
    body: {
      id_cliente: "{{id_cliente}}",
      id_sucursal: "{{id_sucursal}}",
      detalles: [{ id_producto: "{{id_producto}}", cantidad: 2 }],
    },
    tests: `${captureId("id_pedido", "body.pedido && body.pedido.id_pedido", "Venta procesada")}
pm.test("Nace PENDIENTE de pago", () => pm.expect(body.pedido.estado).to.equal("PENDIENTE"));
pm.test("Total calculado por el hook (> 0)", () => pm.expect(Number(body.pedido.total)).to.be.above(0));
${CAPTURE_TOTAL}`,
    description:
      "Requiere rol CAJERO o ADMIN. Acepta varias lineas en `detalles` (o una sola con id_producto/cantidad en la raiz, por compatibilidad). Siempre nace PENDIENTE; el precio sale de Producto.precio_unitario y el total lo calculan los hooks afterCreate de DetallePedido (estado/total/precio_unitario del body se ignoran). Descuenta stock por FIFO (id_inventario ASC) con un movimiento VENTA por lote.",
  }),
  req("Listar pedidos", "GET", "/api/pedidos", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("Obtener pedido por id", "GET", "/api/pedidos/{{id_pedido}}", {
    auth: true,
    tests: expectStatus(200),
  }),
  req("ENTREGADO desde PENDIENTE (rechazado)", "PUT", "/api/pedidos/{{id_pedido}}/estado", {
    auth: true,
    body: { estado: "ENTREGADO" },
    tests: expectStatus(400, "400 esperado: el pedido sigue PENDIENTE de pago"),
    description: "Maquina de estados: un pedido PENDIENTE de pago no puede marcarse ENTREGADO (ni ENVIADO).",
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
    auth: true,
    body: { id_pedido: "{{id_pedido}}", id_producto: "{{id_producto}}", cantidad: 2 },
    tests: `${captureId("id_detalle_pedido", "body.id_detalle_pedido", "Detalle creado")}
${CAPTURE_TOTAL}`,
    description:
      "Requiere rol CAJERO o ADMIN y que el pedido siga PENDIENTE. Precio desde el catalogo, stock de la sucursal del pedido por FIFO con movimiento VENTA; el hook afterCreate recalcula Pedido.total (se devuelve en total_pedido). cantidad=2 a proposito: el folder 13 (Devoluciones) pide 1 unidad de este detalle para una devolucion y otra unidad para un cambio de talla, sobre el mismo detalle.",
  }),
  req("Crear detalle temporal", "POST", "/api/detalles", {
    auth: true,
    body: { id_pedido: "{{id_pedido}}", id_producto: "{{id_producto}}", cantidad: 1 },
    tests: `${captureId("id_detalle_temporal", "body.id_detalle_pedido", "Detalle temporal creado")}
${CAPTURE_TOTAL}`,
    description: "Linea que se elimina en la siguiente request para mostrar el hook afterDestroy.",
  }),
  req("Eliminar detalle temporal", "DELETE", "/api/detalles/{{id_detalle_temporal}}", {
    auth: true,
    tests: `${expectStatus(200)}
${CAPTURE_TOTAL}`,
    description: "Requiere rol CAJERO o ADMIN y pedido PENDIENTE. Devuelve las unidades a stock (movimiento CANCELACION) y el hook afterDestroy recalcula Pedido.total.",
  }),
  req("Listar detalles de pedido", "GET", "/api/detalles", {
    auth: true,
    query: { id_pedido: "{{id_pedido}}" },
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 10. Pagos
// ---------------------------------------------------------------------------

const pagos = folder("10. Pagos", [
  req("Registrar pago", "POST", "/api/pagos", {
    auth: true,
    body: { metodo_pago: "PAYPAL", monto: rawVar("total_pedido"), id_pedido: "{{id_pedido}}" },
    tests: captureId("id_pago", "body.pago && body.pago.id_pago", "Pago registrado"),
    description:
      "Requiere rol CAJERO o ADMIN y pedido PENDIENTE; el monto no puede superar el saldo pendiente (usa {{total_pedido}}, capturado de las requests anteriores). metodo_pago debe ser 'STRIPE' o 'PAYPAL' (unicos valores del ENUM en app/models/pago.model.js). Se usa PAYPAL para no depender de la API real de Stripe: queda PENDIENTE hasta 'Confirmar pago'. Con 'STRIPE' se crea un PaymentIntent real y lo confirma el webhook.",
  }),
  req("Confirmar pago", "PUT", "/api/pagos/{{id_pago}}/confirmar", {
    auth: true,
    tests: `${expectStatus(200)}
pm.test("El pedido pasa a PROCESADO", () => pm.expect(pm.response.json().estado_pedido).to.equal("PROCESADO"));`,
    description: "Requiere rol CAJERO o ADMIN. Marca el pago COMPLETADO; cuando los pagos completados cubren el total, el pedido pasa automaticamente de PENDIENTE a PROCESADO. Un pago STRIPE solo se confirma si Stripe reporta el PaymentIntent como succeeded.",
  }),
  req("Anular pago pendiente (referencia)", "PUT", "/api/pagos/{{id_pago}}/anular", {
    auth: true,
    tests: expectStatus(400, "400 esperado: {{id_pago}} ya fue confirmado; solo se anulan pagos PENDIENTES"),
    description: "Requiere rol CAJERO o ADMIN. Marca FALLIDO un pago PENDIENTE que no se completara (en STRIPE cancela tambien el PaymentIntent) y libera el saldo; es requisito para cancelar un pedido con pagos pendientes. Aqui se espera 400 porque el pago ya esta COMPLETADO.",
  }),
  req("Listar pagos", "GET", "/api/pagos", {
    auth: true,
    tests: expectStatus(200),
  }),
]);

// ---------------------------------------------------------------------------
// 11. Estados del pedido
// ---------------------------------------------------------------------------

const estadosPedido = folder(
  "11. Estados del pedido",
  [
    req("Agregar producto a pedido pagado (rechazado)", "POST", "/api/detalles", {
      auth: true,
      body: { id_pedido: "{{id_pedido}}", id_producto: "{{id_producto}}", cantidad: 1 },
      tests: expectStatus(400, "400 esperado: el pedido ya no esta PENDIENTE"),
    }),
    req("ENTREGADO desde PROCESADO (rechazado)", "PUT", "/api/pedidos/{{id_pedido}}/estado", {
      auth: true,
      body: { estado: "ENTREGADO" },
      tests: expectStatus(400, "400 esperado: ENVIADO es obligatorio antes de ENTREGADO"),
    }),
    req("Marcar ENVIADO", "PUT", "/api/pedidos/{{id_pedido}}/estado", {
      auth: true,
      body: { estado: "ENVIADO" },
      tests: expectStatus(200),
    }),
    req("Marcar ENTREGADO", "PUT", "/api/pedidos/{{id_pedido}}/estado", {
      auth: true,
      body: { estado: "ENTREGADO" },
      tests: expectStatus(200),
      description: "ENTREGADO es la precondicion para solicitar devoluciones/cambios sobre el pedido (ver folder 13).",
    }),
  ],
  "Maquina de estados: PENDIENTE (de pago) -> PROCESADO (pagado) -> ENVIADO -> ENTREGADO; PENDIENTE -> CANCELADO (devuelve el stock). ENTREGADO y CANCELADO son finales.",
);

// ---------------------------------------------------------------------------
// 12. Reportes
// ---------------------------------------------------------------------------

const reportes = folder("12. Reportes", [
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
// 13. Devoluciones
// ---------------------------------------------------------------------------

const devoluciones = folder("13. Devoluciones", [
  req("Crear solicitud de devolucion", "POST", "/api/devoluciones", {
    auth: true,
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
    auth: true,
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
    auth: true,
    tests: expectStatus(200),
  }),
  req("Obtener devolucion por id", "GET", "/api/devoluciones/{{id_devolucion}}", {
    auth: true,
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
// 14. Auditoria
// ---------------------------------------------------------------------------

const auditoria = folder("14. Auditoría", [
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
// 15. Webhook (Stripe)
// ---------------------------------------------------------------------------

const webhook = folder(
  "15. Webhook (Stripe)",
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
  item: [auth, sucursales, clientes, proveedores, categorias, empleados, productos, inventario, pedidos, detallePedido, pagos, estadosPedido, reportes, devoluciones, auditoria, webhook],
  variable: [
    { key: "baseUrl", value: "http://localhost:8080" },
    { key: "token", value: "" },
    { key: "admin_email", value: "admin@distribuidora.com" },
    { key: "admin_password", value: "Admin123!" },
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
    { key: "id_detalle_temporal", value: "1" },
    { key: "total_pedido", value: "0" },
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
