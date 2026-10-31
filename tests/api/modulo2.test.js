// E2E del Módulo 2 (Facturación Dinámica y Estados) contra un Postgres desechable.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18080;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT),
  DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test",
  STRIPE_SECRET_KEY: "sk_test_fake_key", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  // Stripe apunta a un puerto local cerrado: la prueba nunca sale a la API real.
  STRIPE_API_HOST: "localhost", STRIPE_API_PORT: "9", STRIPE_API_PROTOCOL: "http",
  DB_PORT: "54329", CORS_ORIGIN: "http://localhost:8081",
};
Object.assign(process.env, ENV);

const fails = [];
let passes = 0;
function check(name, cond, info) {
  if (cond) { passes++; console.log("  ok  " + name); }
  else { fails.push(name); console.log("  FAIL " + name + (info !== undefined ? "  -> " + JSON.stringify(info) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, params) => (await pg.query(sql, params)).rows;

async function call(method, url, body, token, extraHeaders = {}, raw = false) {
  const headers = { ...extraHeaders };
  if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

(async () => {
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

  // Simula una BD existente creada con el ENUM anterior (sin CANCELACION).
  await pg.query(`CREATE TYPE "enum_MovimientoInventario_tipo_movimiento" AS ENUM ('VENTA','DEVOLUCION_SOLICITADA','DEVOLUCION_RECIBIDA','EN_REVISION','REINTEGRACION','CAMBIO_SALIDA','CAMBIO_ENTRADA','PRODUCTO_DANADO','PRODUCTO_DEFECTUOSO');
    CREATE TABLE "MovimientoInventario" (id_movimiento SERIAL PRIMARY KEY, id_inventario INTEGER, id_producto INTEGER NOT NULL, id_pedido INTEGER, id_devolucion INTEGER, id_empleado INTEGER,
      tipo_movimiento "enum_MovimientoInventario_tipo_movimiento" NOT NULL, cantidad INTEGER NOT NULL, estado_anterior VARCHAR(30), estado_nuevo VARCHAR(30), observacion VARCHAR(255), fecha_movimiento TIMESTAMPTZ);`);

  const logFile = path.join(SALIDAS, "modulo2-servidor.log");
  const out = fs.openSync(logFile, "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });

  try {
    // Espera a que sync({alter:true}) termine: tablas creadas + ENUM migrado.
    let listo = false;
    for (let i = 0; i < 120 && !listo; i++) {
      await sleep(500);
      try {
        const t = await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`);
        const e = await q(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='enum_MovimientoInventario_tipo_movimiento' AND e.enumlabel='CANCELACION'`);
        listo = t[0].n >= 14 && e.length === 1;
      } catch { /* aún creando */ }
    }
    await sleep(4000);
    console.log("\n== Migración");
    check("sync alter agregó CANCELACION al ENUM existente", listo);

    // ---- Seed
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','GT',true)`);
    await q(`INSERT INTO "Cliente"(nombre,apellido,email,activo,id_sucursal) VALUES ('Maria','Lopez','m@x.com',true,1),('Inactivo','X','i@x.com',false,1)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla) VALUES ('Camisa',150,5,true,'M')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_producto_padre) VALUES ('Camisa',99.99,5,true,'L',1),('Vieja',10,5,false,'S',NULL)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (3,1,1,'A','DISPONIBLE'),(40,1,1,'B','DISPONIBLE'),(40,2,1,'C','DISPONIBLE'),(4,1,2,'D','DISPONIBLE'),(50,3,1,'E','DISPONIBLE')`);
    const stock = async (p, s) => Number((await q(`SELECT COALESCE(SUM(cantidad),0) n FROM "Inventario" WHERE id_producto=$1 AND id_sucursal=$2 AND estado='DISPONIBLE'`, [p, s]))[0].n);

    console.log("\n== Seguridad: registro de empleados (punto 1)");
    const tok = {};
    let r0 = await call("POST", "/api/auth/registro", { nombre: "ADMIN", apellido: "T", puesto: "CAJERO", email: "ADMIN@t.com", password: "Clave1234" });
    check("registro inicial sin token con BD vacía 201 y forzado a DISTRITAL", r0.status === 201 && r0.data.puesto === "DISTRITAL", r0);
    tok.ADMIN = (await call("POST", "/api/auth/login", { email: "ADMIN@t.com", password: "Clave1234" })).data.token;
    r0 = await call("POST", "/api/auth/registro", { nombre: "X", apellido: "Y", puesto: "ADMIN", email: "intruso@t.com", password: "Clave1234" });
    check("registro sin token con empleados existentes -> 403", r0.status === 403, r0);
    for (const puesto of ["CAJERO", "BODEGUERO"]) {
      r0 = await call("POST", "/api/auth/registro", { nombre: puesto, apellido: "T", puesto: puesto.toLowerCase(), email: `${puesto}@t.com`, password: "Clave1234", id_sucursal: 1 }, tok.ADMIN);
      check(`ADMIN registra ${puesto} 201 (puesto normalizado)`, r0.status === 201 && r0.data.puesto === puesto, r0);
      tok[puesto] = (await call("POST", "/api/auth/login", { email: `${puesto}@t.com`, password: "Clave1234" })).data.token;
    }
    check("tokens obtenidos", tok.ADMIN && tok.CAJERO && tok.BODEGUERO);
    r0 = await call("POST", "/api/auth/registro", { nombre: "X", apellido: "Y", puesto: "ADMIN", email: "esc@t.com", password: "Clave1234" }, tok.CAJERO);
    check("CAJERO no puede registrar empleados -> 403", r0.status === 403, r0);
    r0 = await call("POST", "/api/auth/registro", { nombre: "X", apellido: "Y", puesto: "SUPERUSER", email: "su@t.com", password: "Clave1234" }, tok.ADMIN);
    check("puesto inválido -> 400", r0.status === 400, r0);
    r0 = await call("POST", "/api/auth/registro", { nombre: "X", apellido: "Y", puesto: "CAJERO", email: "CAJERO@t.com", password: "Clave1234" }, tok.ADMIN);
    check("email duplicado -> 400", r0.status === 400, r0);
    r0 = await call("POST", "/api/auth/registro", { nombre: "X", apellido: "Y", puesto: "CAJERO", email: "suc@t.com", password: "Clave1234", id_sucursal: 999 }, tok.ADMIN);
    check("sucursal inexistente -> 400", r0.status === 400, r0);
    r0 = await call("POST", "/api/empleados", { nombre: "A", apellido: "B", puesto: "ADMIN", fecha_contratacion: "2026-01-01", id_sucursal: 1, email: "e@t.com" });
    check("POST /api/empleados sin token -> 403", r0.status === 403, r0);
    r0 = await call("POST", "/api/empleados", { nombre: "A", apellido: "B", puesto: "ADMIN", fecha_contratacion: "2026-01-01", id_sucursal: 1, email: "e@t.com" }, tok.CAJERO);
    check("POST /api/empleados con CAJERO -> 403", r0.status === 403, r0);
    r0 = await call("POST", "/api/empleados", { nombre: "A", apellido: "B", puesto: "bodeguero", fecha_contratacion: "2026-01-01", id_sucursal: 1, email: "e@t.com" }, tok.ADMIN);
    check("POST /api/empleados con ADMIN 201, sin password en respuesta", r0.status === 201 && !("password" in r0.data), r0);
    r0 = await call("POST", "/api/auth/login", { email: "e@t.com", password: "cualquiera" });
    check("login de empleado sin contraseña -> 401 (no 500)", r0.status === 401, r0);
    r0 = await call("GET", "/api/empleados");
    check("GET /api/empleados sin token -> 403", r0.status === 403, r0);
    r0 = await call("GET", "/api/empleados", undefined, tok.CAJERO);
    check("GET /api/empleados con CAJERO -> 403 (solo ADMIN)", r0.status === 403, r0);
    r0 = await call("GET", "/api/empleados", undefined, tok.ADMIN);
    check("GET /api/empleados no expone password", r0.status === 200 && r0.data.length >= 4 && r0.data.every(e => !("password" in e)), r0.status);

    console.log("\n== Seguridad: sucursales (punto 2)");
    r0 = await call("PUT", "/api/sucursales/1", { activo: false });
    check("PUT sucursal sin token -> 403", r0.status === 403, r0);
    r0 = await call("PUT", "/api/sucursales/1", { activo: false }, tok.CAJERO);
    check("PUT sucursal con CAJERO -> 403", r0.status === 403, r0);
    r0 = await call("POST", "/api/sucursales", { nombre: "N", direccion: "d", ciudad: "c" });
    check("POST sucursal sin token -> 403", r0.status === 403, r0);
    r0 = await call("POST", "/api/sucursales", { nombre: "Sur", direccion: "d", ciudad: "c" }, tok.ADMIN);
    check("POST sucursal con ADMIN 201", r0.status === 201, r0);
    const idSur = r0.data.id_sucursal;
    r0 = await call("PUT", `/api/sucursales/${idSur}`, { id_sucursal: 77, telefono: "123", campo_raro: 1 }, tok.ADMIN);
    check("PUT sucursal ADMIN: aplica telefono, ignora id_sucursal", r0.status === 200 && (await q(`SELECT telefono FROM "Sucursal" WHERE id_sucursal=$1`, [idSur]))[0].telefono === "123" && (await q(`SELECT 1 FROM "Sucursal" WHERE id_sucursal=77`)).length === 0, r0);
    r0 = await call("PUT", `/api/sucursales/${idSur}`, { activo: "no" }, tok.ADMIN);
    check("PUT sucursal activo no booleano -> 400", r0.status === 400, r0);
    r0 = await call("PUT", `/api/sucursales/${idSur}`, { nombre: "  " }, tok.ADMIN);
    check("PUT sucursal nombre vacío -> 400", r0.status === 400, r0);
    r0 = await call("PUT", `/api/sucursales/${idSur}`, { id_sucursal: 5 }, tok.ADMIN);
    check("PUT sucursal sin campos editables -> 400", r0.status === 400, r0);
    r0 = await call("GET", "/api/sucursales");
    check("GET sucursales sigue público", r0.status === 200 && r0.data.length === 3, r0.status);
    const audSuc = await q(`SELECT id_empleado FROM auditoria WHERE tabla_afectada='Sucursal' ORDER BY id_auditoria`);
    check("auditoría de sucursales registra al ADMIN (antes quedaba sin empleado)", audSuc.length === 2 && audSuc.every(a => a.id_empleado != null), audSuc);

    // ---- 1. Creación de pedidos
    console.log("\n== Creación de pedido (hook afterCreate)");
    let r = await call("POST", "/api/pedidos", {
      id_cliente: 1, id_sucursal: 1, estado: "ENTREGADO", total: 1, precio_unitario: 1,
      detalles: [{ id_producto: 1, cantidad: 5 }, { id_producto: 2, cantidad: 2 }],
    }, tok.CAJERO);
    check("POST /api/pedidos multi-línea 201", r.status === 201, r);
    const p1 = r.data.pedido;
    check("ignora estado del body: nace PENDIENTE", p1 && p1.estado === "PENDIENTE", p1);
    check("total = 5*150 + 2*99.99 = 949.98 (precio del catálogo, hook)", p1 && Number(p1.total) === 949.98, p1 && p1.total);
    check("id_empleado del token, no del body", p1 && p1.id_empleado != null);
    check("FIFO: lote A agotado, lote B=38", JSON.stringify((await q(`SELECT cantidad FROM "Inventario" WHERE lote IN ('A','B') ORDER BY lote`)).map(x => x.cantidad)) === "[0,38]");
    const ventas = await q(`SELECT cantidad, id_inventario FROM "MovimientoInventario" WHERE id_pedido=$1 AND tipo_movimiento='VENTA' ORDER BY id_movimiento`, [p1.id_pedido]);
    check("3 movimientos VENTA (3+2 de P1 por lote, 2 de P2)", ventas.length === 3 && ventas.map(v => v.cantidad).join() === "3,2,2", ventas);

    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 1, cantidad: 2 }, tok.CAJERO);
    check("formato legado (id_producto/cantidad en raíz) 201 total 300", r.status === 201 && Number(r.data.pedido.total) === 300, r);
    const p2 = r.data.pedido;

    const pedidosAntes = (await q(`SELECT count(*)::int n FROM "Pedido"`))[0].n;
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }, { id_producto: 2, cantidad: 999 }] }, tok.CAJERO);
    check("stock insuficiente en 2da línea -> 400", r.status === 400 && /Stock insuficiente/.test(r.data.message), r);
    check("rollback total: no quedó pedido ni stock descontado", (await q(`SELECT count(*)::int n FROM "Pedido"`))[0].n === pedidosAntes && await stock(1, 1) === 36);
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 1, cantidad: -1 }, tok.CAJERO);
    check("cantidad negativa -> 400", r.status === 400, r);
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 1, cantidad: 1.5 }, tok.CAJERO);
    check("cantidad decimal -> 400", r.status === 400, r);
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 3, cantidad: 1 }, tok.CAJERO);
    check("producto inactivo -> 400", r.status === 400, r);
    r = await call("POST", "/api/pedidos", { id_cliente: 2, id_sucursal: 1, id_producto: 1, cantidad: 1 }, tok.CAJERO);
    check("cliente inactivo -> 400", r.status === 400, r);
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 1, cantidad: 1 }, tok.BODEGUERO);
    check("BODEGUERO no puede vender -> 403", r.status === 403, r);

    // ---- 2. Detalles
    console.log("\n== Detalles (afterCreate / afterDestroy)");
    r = await call("POST", "/api/detalles", { id_pedido: p1.id_pedido, id_producto: 1, cantidad: 1 });
    check("POST /api/detalles sin token -> 403", r.status === 403, r);
    r = await call("POST", "/api/detalles", { id_pedido: p1.id_pedido, id_producto: 1, cantidad: 1, precio_unitario: 0.01, subtotal: 0.01 }, tok.CAJERO);
    check("agregar detalle 201 + total_pedido 1099.98", r.status === 201 && Number(r.data.total_pedido) === 1099.98, r);
    check("detalle con precio del catálogo y subtotal calculado", r.data && Number(r.data.precio_unitario) === 150 && Number(r.data.subtotal) === 150, r.data);
    const idTemp = r.data.id_detalle_pedido;
    const movVentaDetalle = await q(`SELECT count(*)::int n FROM "MovimientoInventario" WHERE id_pedido=$1 AND tipo_movimiento='VENTA'`, [p1.id_pedido]);
    check("agregar detalle registra movimiento VENTA (trazabilidad)", movVentaDetalle[0].n === 4, movVentaDetalle);
    r = await call("POST", "/api/detalles", { id_pedido: p1.id_pedido, id_producto: 1, id_sucursal: 2, cantidad: 1 }, tok.CAJERO);
    check("detalle con sucursal distinta a la del pedido -> 400", r.status === 400, r);
    const stockAntesDel = await stock(1, 1);
    r = await call("DELETE", `/api/detalles/${idTemp}`, undefined, tok.CAJERO);
    check("DELETE detalle 200 y total vuelve a 949.98 (afterDestroy)", r.status === 200 && Number(r.data.total_pedido) === 949.98, r);
    check("stock devuelto al quitar detalle", await stock(1, 1) === stockAntesDel + 1);
    check("movimiento CANCELACION registrado", (await q(`SELECT count(*)::int n FROM "MovimientoInventario" WHERE id_pedido=$1 AND tipo_movimiento='CANCELACION'`, [p1.id_pedido]))[0].n === 1);
    r = await call("DELETE", `/api/detalles/999999`, undefined, tok.CAJERO);
    check("DELETE detalle inexistente -> 404", r.status === 404, r);

    // Concurrencia: 5 detalles simultáneos sobre el mismo pedido
    const conc = await Promise.all([1, 2, 3, 4, 5].map(() => call("POST", "/api/detalles", { id_pedido: p2.id_pedido, id_producto: 2, cantidad: 0 + 1 }, tok.CAJERO)));
    check("5 detalles concurrentes 201", conc.every(c => c.status === 201), conc.map(c => [c.status, c.data.message]));
    const [{ total: totP2 }] = await q(`SELECT total FROM "Pedido" WHERE id_pedido=$1`, [p2.id_pedido]);
    check("total consistente bajo concurrencia = 300 + 5*99.99 = 799.95", Number(totP2) === 799.95, totP2);

    // ---- 3. Máquina de estados + pagos
    console.log("\n== Máquina de estados y pagos");
    const put = (id, estado, t = tok.ADMIN) => call("PUT", `/api/pedidos/${id}/estado`, { estado }, t);
    r = await put(p1.id_pedido, "ENTREGADO");
    check("PENDIENTE -> ENTREGADO rechazado (PENDIENTE de pago)", r.status === 400 && /PENDIENTE de pago/.test(r.data.message), r);
    r = await put(p1.id_pedido, "ENVIADO");
    check("PENDIENTE -> ENVIADO rechazado", r.status === 400, r);
    r = await put(p1.id_pedido, "PROCESADO");
    check("PENDIENTE -> PROCESADO sin pago rechazado", r.status === 400 && /pagado 0.00 de 949.98/.test(r.data.message), r);
    r = await put(p1.id_pedido, "PENDIENTE");
    check("PENDIENTE -> PENDIENTE rechazado", r.status === 400, r);
    r = await put(p1.id_pedido, "INVENTADO");
    check("estado inválido -> 400", r.status === 400, r);

    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 2000, id_pedido: p1.id_pedido }, tok.CAJERO);
    check("pago mayor al saldo -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: -5, id_pedido: p1.id_pedido }, tok.CAJERO);
    check("pago negativo -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 500, id_pedido: p1.id_pedido }, tok.CAJERO);
    check("pago parcial PAYPAL 201 PENDIENTE", r.status === 201 && r.data.pago.estado_pago === "PENDIENTE" && r.data.estado_pedido === "PENDIENTE", r);
    const pago1 = r.data.pago;
    r = await call("PUT", `/api/pagos/${pago1.id_pago}/confirmar`, undefined, tok.CAJERO);
    check("confirmar pago parcial: COMPLETADO, pedido sigue PENDIENTE", r.status === 200 && r.data.pago.estado_pago === "COMPLETADO" && r.data.estado_pedido === "PENDIENTE", r);
    r = await call("PUT", `/api/pagos/${pago1.id_pago}/confirmar`, undefined, tok.CAJERO);
    check("confirmar dos veces -> 400", r.status === 400, r);
    r = await put(p1.id_pedido, "PROCESADO");
    check("PROCESADO con pago parcial rechazado", r.status === 400 && /pagado 500.00 de 949.98/.test(r.data.message), r);
    r = await put(p1.id_pedido, "CANCELADO");
    check("cancelar con pago completado rechazado (reembolso)", r.status === 400, r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 449.99, id_pedido: p1.id_pedido }, tok.CAJERO);
    check("pago que excede saldo por 0.01 -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 449.98, id_pedido: p1.id_pedido }, tok.CAJERO);
    const pago2 = r.data.pago;
    r = await call("PUT", `/api/pagos/${pago2.id_pago}/confirmar`, undefined, tok.CAJERO);
    check("pago que completa el total -> pedido PROCESADO automáticamente", r.status === 200 && r.data.estado_pedido === "PROCESADO", r);

    r = await call("POST", "/api/detalles", { id_pedido: p1.id_pedido, id_producto: 1, cantidad: 1 }, tok.CAJERO);
    check("agregar detalle a pedido PROCESADO -> 400", r.status === 400, r);
    const unDetalle = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 LIMIT 1`, [p1.id_pedido]))[0].id_detalle_pedido;
    r = await call("DELETE", `/api/detalles/${unDetalle}`, undefined, tok.CAJERO);
    check("quitar detalle de pedido PROCESADO -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 1, id_pedido: p1.id_pedido }, tok.CAJERO);
    check("pagar pedido ya PROCESADO -> 400", r.status === 400, r);
    r = await put(p1.id_pedido, "ENTREGADO");
    check("PROCESADO -> ENTREGADO rechazado (ENVIADO obligatorio)", r.status === 400 && /ENVIADO/.test(r.data.message), r);
    r = await put(p1.id_pedido, "CANCELADO");
    check("PROCESADO -> CANCELADO rechazado", r.status === 400, r);
    r = await put(p1.id_pedido, "ENVIADO");
    check("PROCESADO -> ENVIADO 200", r.status === 200 && r.data.pedido.estado === "ENVIADO", r);
    r = await put(p1.id_pedido, "PROCESADO");
    check("ENVIADO -> PROCESADO rechazado", r.status === 400, r);
    r = await put(p1.id_pedido, "ENTREGADO");
    check("ENVIADO -> ENTREGADO 200", r.status === 200 && r.data.pedido.estado === "ENTREGADO", r);
    r = await put(p1.id_pedido, "CANCELADO");
    check("ENTREGADO es final", r.status === 400, r);
    const auditEstados = await q(`SELECT accion FROM auditoria WHERE tabla_afectada='Pedido' AND registro_afectado_id=$1 ORDER BY id_auditoria`, [p1.id_pedido]);
    check("auditoría: creado, detalles, PROCESADO, ENVIADO, ENTREGADO", auditEstados.filter(a => a.accion === "PEDIDO_ESTADO_ACTUALIZADO").length === 3 && auditEstados[0].accion === "PEDIDO_CREADO", auditEstados);

    // ---- 4. Logística inversa sigue funcionando sobre el pedido ENTREGADO
    console.log("\n== Logística inversa / trazabilidad (no regresión)");
    const det1 = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=1 ORDER BY id_detalle_pedido LIMIT 1`, [p1.id_pedido]))[0].id_detalle_pedido;
    r = await call("GET", `/api/devoluciones/pedido/${p1.id_pedido}/devolvible`, undefined, tok.CAJERO);
    check("devolvible: permite_devolucion=true", r.status === 200 && r.data.permite_devolucion === true, r);
    r = await call("POST", "/api/devoluciones", { id_pedido: p1.id_pedido, id_cliente: 1, tipo: "DEVOLUCION", motivo: "DEFECTUOSO", detalles: [{ id_detalle_pedido: det1, cantidad: 1 }] }, tok.CAJERO);
    check("crear devolución sobre pedido ENTREGADO 201", r.status === 201, r);
    const idDev = r.data.devolucion && r.data.devolucion.id_devolucion;
    for (const [acc, t, body] of [["aprobar", tok.ADMIN], ["recibir", tok.BODEGUERO]]) {
      r = await call("PUT", `/api/devoluciones/${idDev}/${acc}`, body, t);
      check(`devolución ${acc} 200`, r.status === 200, r);
    }
    const dd = (await q(`SELECT id_detalle_devolucion FROM "DetalleDevolucion" WHERE id_devolucion=$1`, [idDev]))[0].id_detalle_devolucion;
    r = await call("PUT", `/api/devoluciones/${idDev}/revisar`, { aceptar: true, detalles: [{ id_detalle_devolucion: dd, resultado_revision: "BUEN_ESTADO" }] }, tok.BODEGUERO);
    check("devolución revisar 200", r.status === 200, r);
    r = await call("PUT", `/api/devoluciones/${idDev}/reintegrar`, undefined, tok.BODEGUERO);
    check("devolución reintegrar 200", r.status === 200, r);
    r = await call("POST", "/api/devoluciones", { id_pedido: p2.id_pedido, id_cliente: 1, tipo: "DEVOLUCION", motivo: "DEFECTUOSO", detalles: [{ id_detalle_pedido: 1, cantidad: 1 }] }, tok.CAJERO);
    check("devolución sobre pedido no ENTREGADO sigue rechazada", r.status === 400, r);
    r = await call("GET", `/api/pedidos/${p1.id_pedido}/historial`, undefined, tok.ADMIN);
    const tipos = (r.data.movimientos || []).map(m => m.tipo_movimiento);
    check("historial del pedido incluye VENTA, CANCELACION y movimientos de devolución", ["VENTA", "CANCELACION", "DEVOLUCION_SOLICITADA", "REINTEGRACION"].every(x => tipos.includes(x)), tipos);
    check("total del pedido no cambia por la devolución", Number(r.data.pedido.total) === 949.98, r.data.pedido);

    // ---- 5. Cancelación
    console.log("\n== Cancelación");
    const stockP2Antes = await stock(2, 1), stockP1Antes = await stock(1, 1);
    r = await put(p2.id_pedido, "CANCELADO", tok.CAJERO);
    check("PENDIENTE -> CANCELADO 200", r.status === 200, r);
    check("cancelación devuelve stock (P1 +2, P2 +5)", await stock(1, 1) === stockP1Antes + 2 && await stock(2, 1) === stockP2Antes + 5, [await stock(1, 1), stockP1Antes, await stock(2, 1), stockP2Antes]);
    check("6 movimientos CANCELACION del pedido cancelado", (await q(`SELECT count(*)::int n FROM "MovimientoInventario" WHERE id_pedido=$1 AND tipo_movimiento='CANCELACION'`, [p2.id_pedido]))[0].n === 6);
    r = await put(p2.id_pedido, "PROCESADO");
    check("CANCELADO es final", r.status === 400 && /cancelado/.test(r.data.message), r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 1, id_pedido: p2.id_pedido }, tok.CAJERO);
    check("pagar pedido CANCELADO -> 400", r.status === 400, r);

    // ---- 6. Webhook Stripe (body crudo + firma real)
    console.log("\n== Webhook Stripe");
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 1, cantidad: 1 }, tok.CAJERO);
    const p3 = r.data.pedido;
    await q(`INSERT INTO "Pago"(metodo_pago,monto,estado_pago,id_transaccion_externa,id_pedido) VALUES ('STRIPE',150,'PENDIENTE','pi_test_ok',$1),('STRIPE',150,'PENDIENTE','pi_test_fail',$1)`, [p3.id_pedido]);
    const stripe = require(B + "/node_modules/stripe")("sk_test_fake_key");
    const evento = (type, id) => { const payload = JSON.stringify({ id: "evt_" + id, object: "event", type, data: { object: { id, object: "payment_intent" } } }); return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" }) }; };
    let ev = evento("payment_intent.succeeded", "pi_test_ok");
    r = await call("POST", "/api/webhook", ev.payload, null, { "Content-Type": "application/json", "stripe-signature": "t=1,v1=malo" }, true);
    check("webhook con firma inválida -> 400", r.status === 400, r);
    ev = evento("payment_intent.payment_failed", "pi_test_fail");
    r = await call("POST", "/api/webhook", ev.payload, null, { "Content-Type": "application/json", "stripe-signature": ev.header }, true);
    check("webhook payment_failed 200 -> pago sigue PENDIENTE (reintento posible)", r.status === 200 && (await q(`SELECT estado_pago FROM "Pago" WHERE id_transaccion_externa='pi_test_fail'`))[0].estado_pago === "PENDIENTE", r);
    ev = evento("payment_intent.succeeded", "pi_test_ok");
    r = await call("POST", "/api/webhook", ev.payload, null, { "Content-Type": "application/json", "stripe-signature": ev.header }, true);
    check("webhook firmado 200 (body crudo llega intacto)", r.status === 200, r);
    check("webhook: pago COMPLETADO y pedido PROCESADO", (await q(`SELECT estado_pago FROM "Pago" WHERE id_transaccion_externa='pi_test_ok'`))[0].estado_pago === "COMPLETADO" && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [p3.id_pedido]))[0].estado === "PROCESADO");
    r = await call("POST", "/api/pagos", { metodo_pago: "STRIPE", monto: 1, id_pedido: p3.id_pedido }, tok.CAJERO);
    check("JSON normal sigue funcionando tras mover el webhook (400 por pedido ya pagado)", r.status === 400 && /PENDIENTES de pago/.test(r.data.message), r);
    ev = evento("payment_intent.succeeded", "pi_test_fail");
    r = await call("POST", "/api/webhook", ev.payload, null, { "Content-Type": "application/json", "stripe-signature": ev.header }, true);
    await sleep(1500); // el pedido de reembolso a Stripe corre tras confirmar
    const reCobro = await q(`SELECT r.metodo, r.monto::float monto, r.estado, r.id_devolucion FROM "Reembolso" r JOIN "Pago" p ON p.id_pago=r.id_pago WHERE p.id_transaccion_externa='pi_test_fail'`);
    check("[#1/#2] cobro tras intento fallido sobre pedido ya pagado: REEMBOLSADO + reembolso a la tarjeta",
      r.status === 200 && (await q(`SELECT estado_pago FROM "Pago" WHERE id_transaccion_externa='pi_test_fail'`))[0].estado_pago === "REEMBOLSADO"
      && (await q(`SELECT count(*)::int n FROM auditoria WHERE accion='PAGO_REQUIERE_REEMBOLSO'`))[0].n === 1
      && reCobro.length === 1 && reCobro[0].metodo === "STRIPE" && reCobro[0].monto === 150 && reCobro[0].id_devolucion === null
      // Stripe no está disponible en esta prueba: queda PENDIENTE para reintentar desde caja.
      && reCobro[0].estado === "PENDIENTE"
      && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [p3.id_pedido]))[0].estado === "PROCESADO", reCobro);

    // ---- 6b. Regresiones de la revisión adversarial
    console.log("\n== Regresiones de la revisión");
    const nuevoPedido = async (detalles) => (await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles }, tok.CAJERO)).data.pedido;
    // #0 doble DELETE simultáneo
    let px = await nuevoPedido([{ id_producto: 2, cantidad: 1 }]);
    r = await call("POST", "/api/detalles", { id_pedido: px.id_pedido, id_producto: 2, cantidad: 3 }, tok.CAJERO);
    const idDoble = r.data.id_detalle_pedido;
    const sAntes = await stock(2, 1);
    const dobles = await Promise.all([1, 2, 3].map(() => call("DELETE", `/api/detalles/${idDoble}`, undefined, tok.CAJERO)));
    check("[#0] DELETE x3 simultáneo: un 200 y el resto 404", dobles.filter(d => d.status === 200).length === 1 && dobles.filter(d => d.status === 404).length === 2, dobles.map(d => d.status));
    check("[#0] stock devuelto una sola vez (+3)", await stock(2, 1) === sAntes + 3, [await stock(2, 1), sAntes]);
    // #4 deadlock por orden de productos
    const cruzados = await Promise.all([0, 1, 2, 3, 4, 5].map(i => call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles: i % 2 ? [{ id_producto: 1, cantidad: 1 }, { id_producto: 2, cantidad: 1 }] : [{ id_producto: 2, cantidad: 1 }, { id_producto: 1, cantidad: 1 }] }, tok.CAJERO)));
    check("[#4] 6 ventas cruzadas [A,B]/[B,A] simultáneas sin deadlock", cruzados.every(c => c.status === 201), cruzados.map(c => [c.status, c.data.message]));
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 1 }, { id_producto: 2, cantidad: 2 }] }, tok.CAJERO);
    check("[#4] líneas repetidas del mismo producto se unen (1 línea de 3)", r.status === 201 && (await q(`SELECT cantidad FROM "DetallePedido" WHERE id_pedido=$1`, [r.data.pedido.id_pedido])).map(x => x.cantidad).join() === "3", r);
    // #7 roles por estado destino
    px = await nuevoPedido([{ id_producto: 2, cantidad: 1 }]);
    r = await put(px.id_pedido, "CANCELADO", tok.BODEGUERO);
    check("[#7] BODEGUERO no puede cancelar -> 403", r.status === 403, r);
    // #13 sin body
    r = await call("PUT", `/api/pedidos/${px.id_pedido}/estado`, undefined, tok.ADMIN);
    check("[#13] PUT estado sin body -> 400 (no 500)", r.status === 400, r);
    r = await call("POST", `/api/detalles`, undefined, tok.CAJERO);
    check("[#13] POST detalles sin body -> 400", r.status === 400, r);
    r = await call("POST", `/api/pagos`, undefined, tok.CAJERO);
    check("[#13] POST pagos sin body -> 400", r.status === 400, r);
    // #8 montos con más de 2 decimales
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 10.005, id_pedido: px.id_pedido }, tok.CAJERO);
    check("[#8] monto con 3 decimales -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: "10.01", id_pedido: px.id_pedido }, tok.CAJERO);
    check("[#8] monto 10.01 (string) aceptado", r.status === 201, r);
    // #1 pagos pendientes cuentan para el saldo y bloquean la cancelación
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 99.99, id_pedido: px.id_pedido }, tok.CAJERO);
    check("[#1] pago que con los PENDIENTES excede el total -> 400", r.status === 400, r);
    const pagoPend = (await q(`SELECT id_pago FROM "Pago" WHERE id_pedido=$1`, [px.id_pedido]))[0].id_pago;
    r = await put(px.id_pedido, "CANCELADO", tok.CAJERO);
    check("[#1] cancelar con pago PENDIENTE -> 400", r.status === 400 && /anular/.test(r.data.message), r);
    r = await call("PUT", `/api/pagos/${pagoPend}/anular`, undefined, tok.CAJERO);
    check("[#1] anular pago pendiente 200 -> FALLIDO", r.status === 200 && r.data.pago.estado_pago === "FALLIDO", r);
    r = await put(px.id_pedido, "CANCELADO", tok.CAJERO);
    check("[#1] tras anular, cancelar 200", r.status === 200, r);
    // #3 quitar líneas con pago parcial
    px = await nuevoPedido([{ id_producto: 1, cantidad: 1 }, { id_producto: 2, cantidad: 1 }]); // 150 + 99.99
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 150, id_pedido: px.id_pedido }, tok.CAJERO);
    await call("PUT", `/api/pagos/${r.data.pago.id_pago}/confirmar`, undefined, tok.CAJERO);
    const linea150 = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=1`, [px.id_pedido]))[0].id_detalle_pedido;
    const linea99 = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=2`, [px.id_pedido]))[0].id_detalle_pedido;
    const s1 = await stock(1, 1);
    r = await call("DELETE", `/api/detalles/${linea150}`, undefined, tok.CAJERO);
    check("[#3] quitar línea que deja total < pagado -> 400 y rollback", r.status === 400 && await stock(1, 1) === s1 && Number((await q(`SELECT total FROM "Pedido" WHERE id_pedido=$1`, [px.id_pedido]))[0].total) === 249.99, r);
    r = await call("DELETE", `/api/detalles/${linea99}`, undefined, tok.CAJERO);
    check("[#3] quitar línea que deja total = pagado -> 200 y pedido PROCESADO", r.status === 200 && r.data.estado_pedido === "PROCESADO" && Number(r.data.total_pedido) === 150, r);

    // ---- 7. Hooks masivos directos sobre el modelo
    console.log("\n== Hooks en operaciones masivas (modelo)");
    const db = require(B + "/app/models");
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, id_producto: 1, cantidad: 1 }, tok.CAJERO);
    const p4 = r.data.pedido.id_pedido;
    await db.detalle_pedido.bulkCreate([{ id_pedido: p4, id_producto: 1, cantidad: 2, precio_unitario: 10 }, { id_pedido: p4, id_producto: 2, cantidad: 3, precio_unitario: 1.1 }]);
    let tot = Number((await db.pedido.findByPk(p4)).total);
    check("bulkCreate recalcula total (150 + 20 + 3.30 = 173.30)", tot === 173.3, tot);
    await db.detalle_pedido.update({ cantidad: 4 }, { where: { id_pedido: p4, id_producto: 2 } });
    tot = Number((await db.pedido.findByPk(p4)).total);
    check("update masivo recalcula subtotal y total (150 + 20 + 4.40 = 174.40)", tot === 174.4, tot);
    const det20 = await db.detalle_pedido.findOne({ where: { id_pedido: p4, cantidad: 2 } });
    await det20.update({ cantidad: 5 });
    await det20.reload();
    tot = Number((await db.pedido.findByPk(p4)).total);
    check("[#5] instance.update guarda subtotal (50) y total (150 + 50 + 4.40 = 204.40)", Number(det20.subtotal) === 50 && tot === 204.4, [det20.subtotal, tot]);
    await det20.update({ cantidad: 2 });
    await db.detalle_pedido.destroy({ where: { id_pedido: p4, id_producto: 2 } });
    tot = Number((await db.pedido.findByPk(p4)).total);
    check("destroy masivo recalcula total (170)", tot === 170, tot);
    await db.sequelize.close();

    // ---- Invariante global
    const inv = await q(`SELECT p.id_pedido, p.total, COALESCE(SUM(d.subtotal),0) s FROM "Pedido" p LEFT JOIN "DetallePedido" d ON d.id_pedido=p.id_pedido GROUP BY p.id_pedido HAVING p.total <> COALESCE(SUM(d.subtotal),0)`);
    check("invariante: Pedido.total = SUM(subtotal) en todos los pedidos", inv.length === 0, inv);
    const neg = await q(`SELECT * FROM "Inventario" WHERE cantidad < 0`);
    check("ningún lote con stock negativo", neg.length === 0, neg);
  } catch (e) {
    console.error("ERROR EN PRUEBA:", e);
    fails.push("excepción: " + e.message);
  } finally {
    srv.kill();
    await pg.end();
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    if (fails.length) console.log("Fallos:\n - " + fails.join("\n - "));
    process.exit(fails.length ? 1 : 0);
  }
})();
