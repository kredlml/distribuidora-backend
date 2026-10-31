// E2E: ventas de mostrador (pagos EFECTIVO/TARJETA/PAYPAL), listado/detalle de pedidos,
// clientes (alta, edición, código de activación web) y proveedores. BD desechable, puerto propio.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18088;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  DB_PORT: "54329", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
};
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 500) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, p) => (await pg.query(sql, p)).rows;
async function call(method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
function arrancar(log) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
}
async function esperar(cond) { for (let i = 0; i < 160; i++) { await sleep(500); try { if (await cond()) return true; } catch {} } return false; }
const enumTiene = async (tipo, v) => (await q(`SELECT count(*)::int n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname=$1 AND e.enumlabel=$2`, [tipo, v]))[0].n === 1;
const col = async (tabla, c) => (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [tabla, c]))[0].n === 1;
const indice = async (n) => (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname=$1`, [n]))[0].n === 1;

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv;
  try {
    // ---- Fase 1: esquema completo y luego se "envejece" (como la base real antes de este cambio)
    srv = arrancar("server-ventas-1.log");
    await esperar(async () => (await enumTiene("enum_Pago_metodo_pago", "EFECTIVO")) && (await col("Cliente", "codigo_activacion")) && (await indice("cliente_email_lower_unico")));
    await sleep(2000); srv.kill(); await sleep(1500);
    await q(`ALTER TABLE "Cliente" DROP COLUMN codigo_activacion, DROP COLUMN codigo_activacion_expira`);
    await q(`DROP INDEX cliente_email_lower_unico`);
    await q(`ALTER TYPE "enum_Pago_metodo_pago" RENAME TO enum_pago_viejo`);
    await q(`CREATE TYPE "enum_Pago_metodo_pago" AS ENUM ('STRIPE','PAYPAL')`);
    await q(`ALTER TABLE "Pago" ALTER COLUMN metodo_pago TYPE "enum_Pago_metodo_pago" USING metodo_pago::text::"enum_Pago_metodo_pago"`);
    await q(`DROP TYPE enum_pago_viejo`);
    // Una base de antes de las migraciones (manejada con sync alter) no tiene SequelizeMeta.
    await q(`DROP TABLE IF EXISTS "SequelizeMeta"`);
    check("base envejecida sin EFECTIVO, sin columnas de código ni índice", !(await enumTiene("enum_Pago_metodo_pago", "EFECTIVO")) && !(await col("Cliente", "codigo_activacion")));

    srv = arrancar("server-ventas-2.log");
    const migro = await esperar(async () => (await enumTiene("enum_Pago_metodo_pago", "EFECTIVO")) && (await enumTiene("enum_Pago_metodo_pago", "TARJETA")) && (await col("Cliente", "codigo_activacion_expira")) && (await indice("cliente_email_lower_unico")));
    await sleep(2000);
    check("migración automática: EFECTIVO/TARJETA, columnas de código e índice de correo", migro);

    // ---- Seed
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Camisas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Camisa',150,5,true,'M',1),('Camisa',150,5,true,'L',1),('Jeans',299.99,5,true,'32',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (20,1,1,'A','DISPONIBLE'),(20,2,1,'B','DISPONIBLE'),(10,3,1,'C','DISPONIBLE'),(5,1,2,'D','DISPONIBLE')`);
    const tok = {};
    await call("POST", "/api/auth/registro", { nombre: "Ana", apellido: "Admin", email: "admin@t.com", password: "Clave1234" });
    tok.ADMIN = (await call("POST", "/api/auth/login", { email: "admin@t.com", password: "Clave1234" })).data.token;
    for (const [puesto, email] of [["CAJERO", "caja@t.com"], ["BODEGUERO", "bodega@t.com"]]) {
      await call("POST", "/api/auth/registro", { nombre: puesto, apellido: "T", puesto, email, password: "Clave1234", id_sucursal: 1 }, tok.ADMIN);
      tok[puesto] = (await call("POST", "/api/auth/login", { email, password: "Clave1234" })).data.token;
    }

    console.log("\n== Clientes");
    let r = await call("POST", "/api/clientes", { nombre: "María", apellido: "López", email: "Maria@Correo.com", telefono: "5555", direccion: "Zona 1", activo: false }, tok.CAJERO);
    const idMaria = r.data.id_cliente;
    check("CAJERO registra cliente (correo en minúsculas, nace activo, sin cuenta web)", r.status === 201 && r.data.email === "maria@correo.com" && r.data.activo === true && r.data.tiene_cuenta_web === false && !("password" in r.data), r);
    r = await call("POST", "/api/clientes", { nombre: "Otra", apellido: "X", email: "MARIA@correo.com" }, tok.CAJERO);
    check("correo repetido (mayúsculas) -> 400", r.status === 400, r);
    r = await call("POST", "/api/clientes", { nombre: "Otra", apellido: "X", email: "no-es-correo" }, tok.CAJERO);
    check("correo inválido -> 400", r.status === 400, r);
    r = await call("POST", "/api/clientes", { nombre: "", apellido: "X" }, tok.CAJERO);
    check("sin nombre -> 400", r.status === 400, r);
    r = await call("POST", "/api/clientes", { nombre: "Sin", apellido: "Correo" }, tok.CAJERO);
    const idSinCorreo = r.data.id_cliente;
    check("cliente sin correo permitido", r.status === 201 && r.data.email === null, r);
    r = await call("POST", "/api/clientes", { nombre: "B", apellido: "X" }, tok.BODEGUERO);
    check("BODEGUERO no registra clientes -> 403", r.status === 403, r);
    r = await call("PUT", `/api/clientes/${idMaria}`, { telefono: "4444", password: "hack1234", id_cliente: 99 }, tok.CAJERO);
    check("CAJERO edita teléfono (ignora password/id)", r.status === 200 && r.data.telefono === "4444" && r.data.id_cliente === idMaria, r);
    r = await call("PUT", `/api/clientes/${idMaria}`, { activo: false }, tok.CAJERO);
    check("CAJERO no puede desactivar clientes -> 403", r.status === 403, r);
    r = await call("PUT", `/api/clientes/9999`, { telefono: "1" }, tok.CAJERO);
    check("cliente inexistente -> 404", r.status === 404, r);
    r = await call("GET", "/api/clientes", undefined, tok.BODEGUERO);
    check("listar clientes: sin hash ni código, con tiene_cuenta_web", r.status === 200 && r.data.length === 2 && r.data.every((c) => !("password" in c) && !("codigo_activacion" in c) && "tiene_cuenta_web" in c), r.data);

    console.log("\n== Venta de mostrador y pagos");
    r = await call("POST", "/api/pedidos", { id_cliente: idMaria, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 2 }, { id_producto: 3, cantidad: 1 }] }, tok.CAJERO);
    const idP1 = r.data.pedido.id_pedido;
    check("venta de mostrador: 2×150 + 299.99 = 599.99", r.status === 201 && Number(r.data.pedido.total) === 599.99, r);
    r = await call("GET", `/api/pedidos/${idP1}`, undefined, tok.BODEGUERO);
    check("detalle: origen MOSTRADOR, vendedor, saldos", r.status === 200 && r.data.origen === "MOSTRADOR" && r.data.Empleado && r.data.saldo === 599.99 && r.data.por_cobrar === 599.99 && r.data.pagado === 0 && r.data.DetallePedidos.length === 2 && r.data.DetallePedidos[0].Producto.color !== undefined, r.data);
    r = await call("GET", `/api/pedidos/abc`, undefined, tok.CAJERO);
    check("detalle con id inválido -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "BITCOIN", monto: 10 }, tok.CAJERO);
    check("método inválido -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "EFECTIVO", monto: 700 }, tok.CAJERO);
    check("monto mayor al saldo -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "TARJETA", monto: 100, referencia: "x".repeat(151) }, tok.CAJERO);
    check("referencia > 150 -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "EFECTIVO", monto: 99.99 }, tok.BODEGUERO);
    check("BODEGUERO no cobra -> 403", r.status === 403, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "PAYPAL", monto: 100 }, tok.CAJERO);
    const idPaypal = r.data.pago.id_pago;
    check("PAYPAL queda por confirmar", r.status === 201 && r.data.pago.estado_pago === "PENDIENTE" && r.data.estado_pedido === "PENDIENTE", r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "TARJETA", monto: 200, referencia: " AUT-123 " }, tok.CAJERO);
    check("TARJETA (POS) nace COMPLETADO con referencia", r.status === 201 && r.data.pago.estado_pago === "COMPLETADO" && r.data.pago.id_transaccion_externa === "AUT-123" && r.data.estado_pedido === "PENDIENTE", r);
    r = await call("GET", `/api/pedidos/${idP1}`, undefined, tok.CAJERO);
    check("saldos: pagado 200, por confirmar 100, saldo 399.99, por cobrar 299.99", r.data.pagado === 200 && r.data.por_confirmar === 100 && r.data.saldo === 399.99 && r.data.por_cobrar === 299.99, r.data);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "EFECTIVO", monto: 300 }, tok.CAJERO);
    check("no se cobra encima de lo por confirmar -> 400", r.status === 400, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "EFECTIVO", monto: 299.99 }, tok.CAJERO);
    check("EFECTIVO completo pero falta confirmar PayPal: sigue PENDIENTE", r.status === 201 && r.data.pago.estado_pago === "COMPLETADO" && r.data.estado_pedido === "PENDIENTE", r);
    r = await call("PUT", `/api/pagos/${idPaypal}/confirmar`, undefined, tok.CAJERO);
    check("confirmar PayPal -> pedido PROCESADO", r.status === 200 && r.data.estado_pedido === "PROCESADO", r);
    const audPago = await q(`SELECT count(*)::int n FROM auditoria WHERE accion='PAGO_REGISTRADO'`);
    check("auditoría de cada pago registrado", audPago[0].n === 3, audPago);
    r = await call("POST", "/api/pagos", { id_pedido: idP1, metodo_pago: "EFECTIVO", monto: 1 }, tok.CAJERO);
    check("pagar un pedido ya pagado -> 400", r.status === 400, r);
    // Estados
    r = await call("PUT", `/api/pedidos/${idP1}/estado`, { estado: "ENVIADO" }, tok.CAJERO);
    check("CAJERO no despacha -> 403", r.status === 403, r);
    r = await call("PUT", `/api/pedidos/${idP1}/estado`, { estado: "ENVIADO" }, tok.BODEGUERO);
    check("BODEGUERO marca ENVIADO", r.status === 200, r);
    r = await call("PUT", `/api/pedidos/${idP1}/estado`, { estado: "ENTREGADO" }, tok.BODEGUERO);
    check("BODEGUERO marca ENTREGADO", r.status === 200, r);
    // Venta en una sola pasada con EFECTIVO
    r = await call("POST", "/api/pedidos", { id_cliente: idSinCorreo, id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 1 }] }, tok.CAJERO);
    const idP2 = r.data.pedido.id_pedido;
    r = await call("POST", "/api/pagos", { id_pedido: idP2, metodo_pago: "EFECTIVO", monto: 150 }, tok.CAJERO);
    check("venta en efectivo por el total -> PROCESADO al instante", r.status === 201 && r.data.estado_pedido === "PROCESADO", r);
    // Pedido pendiente: agregar/quitar líneas y cancelar
    r = await call("POST", "/api/pedidos", { id_cliente: idSinCorreo, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.CAJERO);
    const idP3 = r.data.pedido.id_pedido;
    r = await call("POST", "/api/detalles", { id_pedido: idP3, id_producto: 3, cantidad: 1 }, tok.CAJERO);
    check("agregar línea a pedido pendiente recalcula total", r.status === 201 && Number(r.data.total_pedido) === 449.99, r);
    const idDet = r.data.id_detalle_pedido;
    r = await call("DELETE", `/api/detalles/${idDet}`, undefined, tok.CAJERO);
    check("quitar línea vuelve el total a 150", r.status === 200 && Number((await q(`SELECT total FROM "Pedido" WHERE id_pedido=$1`, [idP3]))[0].total) === 150, r);
    r = await call("POST", "/api/pagos", { id_pedido: idP3, metodo_pago: "PAYPAL", monto: 50 }, tok.CAJERO);
    const idPP3 = r.data.pago.id_pago;
    r = await call("PUT", `/api/pedidos/${idP3}/estado`, { estado: "CANCELADO" }, tok.CAJERO);
    check("cancelar con pago por confirmar -> 400 (anular primero)", r.status === 400, r);
    await call("PUT", `/api/pagos/${idPP3}/anular`, undefined, tok.CAJERO);
    const antes = Number((await q(`SELECT SUM(cantidad) n FROM "Inventario" WHERE id_producto=1 AND id_sucursal=1 AND estado='DISPONIBLE'`))[0].n);
    r = await call("PUT", `/api/pedidos/${idP3}/estado`, { estado: "CANCELADO" }, tok.CAJERO);
    const despues = Number((await q(`SELECT SUM(cantidad) n FROM "Inventario" WHERE id_producto=1 AND id_sucursal=1 AND estado='DISPONIBLE'`))[0].n);
    check("anulado el pago, cancelar devuelve el stock", r.status === 200 && despues === antes + 1, [r.status, antes, despues]);

    console.log("\n== Devolver cobros presenciales");
    r = await call("POST", "/api/pedidos", { id_cliente: idSinCorreo, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 2 }] }, tok.CAJERO);
    const idP4 = r.data.pedido.id_pedido;
    const pEf = (await call("POST", "/api/pagos", { id_pedido: idP4, metodo_pago: "EFECTIVO", monto: 50 }, tok.CAJERO)).data.pago.id_pago;
    const pTa = (await call("POST", "/api/pagos", { id_pedido: idP4, metodo_pago: "TARJETA", monto: 20 }, tok.CAJERO)).data.pago.id_pago;
    const pPp = (await call("POST", "/api/pagos", { id_pedido: idP4, metodo_pago: "PAYPAL", monto: 10 }, tok.CAJERO)).data.pago.id_pago;
    r = await call("PUT", `/api/pedidos/${idP4}/estado`, { estado: "CANCELADO" }, tok.CAJERO);
    check("pedido con cobro en efectivo no se cancela directo -> 400", r.status === 400, r);
    r = await call("PUT", `/api/pagos/${pEf}/devolver`, undefined, tok.BODEGUERO);
    check("BODEGUERO no devuelve pagos -> 403", r.status === 403, r);
    r = await call("PUT", `/api/pagos/${pPp}/devolver`, undefined, tok.CAJERO);
    check("PayPal no se devuelve desde caja -> 400", r.status === 400, r);
    const [d1, d2] = await Promise.all([call("PUT", `/api/pagos/${pEf}/devolver`, undefined, tok.CAJERO), call("PUT", `/api/pagos/${pEf}/devolver`, undefined, tok.ADMIN)]);
    check("devolver el mismo pago dos veces a la vez: una sola vez", [d1.status, d2.status].sort().join() === "200,400", [d1, d2]);
    r = await call("GET", `/api/pedidos/${idP4}`, undefined, tok.CAJERO);
    check("tras devolver, el efectivo ya no cuenta como pagado", r.data.pagado === 20 && r.data.Pagos.find((x) => x.id_pago === pEf).estado_pago === "REEMBOLSADO", r.data);
    await call("PUT", `/api/pagos/${pTa}/devolver`, undefined, tok.CAJERO);
    await call("PUT", `/api/pagos/${pPp}/anular`, undefined, tok.CAJERO);
    r = await call("PUT", `/api/pedidos/${idP4}/estado`, { estado: "CANCELADO" }, tok.CAJERO);
    check("devueltos los cobros y anulado el pendiente, el pedido se cancela", r.status === 200, r);
    r = await call("PUT", `/api/pagos/${pTa}/devolver`, undefined, tok.CAJERO);
    check("no se devuelve un pago ya devuelto", r.status === 400, r);
    const audDev = await q(`SELECT count(*)::int n FROM auditoria WHERE accion='PAGO_DEVUELTO'`);
    check("auditoría de devoluciones de pago", audDev[0].n === 2, audDev);
    // Pagos de un pedido ya pagado no se devuelven desde caja
    const pagoP2 = (await q(`SELECT id_pago FROM "Pago" WHERE id_pedido=$1`, [idP2]))[0].id_pago;
    r = await call("PUT", `/api/pagos/${pagoP2}/devolver`, undefined, tok.CAJERO);
    check("pago de un pedido ya pagado -> 400 (se gestiona como devolución)", r.status === 400, r);

    console.log("\n== Ids no numéricos");
    for (const [m, u] of [["PUT", "/api/clientes/abc"], ["POST", "/api/clientes/abc/codigo-web"], ["PUT", "/api/proveedores/abc"], ["PUT", "/api/pedidos/abc/estado"], ["PUT", "/api/pagos/abc/devolver"], ["PUT", "/api/sucursales/1.5"], ["DELETE", "/api/categorias/-1"]]) {
      r = await call(m, u, { telefono: "1", estado: "ENVIADO" }, tok.ADMIN);
      check(`${m} ${u} -> 400 (no 500)`, r.status === 400, r);
    }

    console.log("\n== Listado de pedidos");
    // Pedido de la tienda (cliente web)
    const reg = await call("POST", "/api/tienda/auth/registro", { nombre: "Web", apellido: "Cliente", email: "web@x.com", password: "Clave1234" });
    const rt = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, direccion_entrega: "Zona 10", detalles: [{ id_producto: 2, cantidad: 1 }] }, reg.data.token);
    check("pedido de la tienda creado", rt.status === 201, rt);
    r = await call("GET", "/api/pedidos?origen=TIENDA", undefined, tok.BODEGUERO);
    check("filtro origen=TIENDA", r.status === 200 && r.data.length === 1 && r.data[0].origen === "TIENDA" && r.data[0].Sucursal.nombre === "Centro", r.data);
    r = await call("GET", "/api/pedidos?origen=MOSTRADOR", undefined, tok.BODEGUERO);
    check("filtro origen=MOSTRADOR", r.data.length === 4 && r.data.every((p) => p.origen === "MOSTRADOR" && p.Empleado), r.data.length);
    // Día de la tienda (UTC-6): un pedido a las 23:00 de Guatemala del día 10 es el 11 a las 05:00 UTC.
    await q(`UPDATE "Pedido" SET fecha_pedido='2026-01-11T05:00:00Z' WHERE id_pedido=$1`, [idP4]);
    r = await call("GET", "/api/pedidos?desde=2026-01-10&hasta=2026-01-10", undefined, tok.CAJERO);
    const r11 = await call("GET", "/api/pedidos?desde=2026-01-11&hasta=2026-01-11", undefined, tok.CAJERO);
    check("filtro por día usa la hora de Guatemala", r.data.length === 1 && r.data[0].id_pedido === idP4 && r11.data.length === 0, [r.data.length, r11.data.length]);
    r = await call("GET", "/api/pedidos?origen=OTRO", undefined, tok.BODEGUERO);
    check("origen inválido -> 400", r.status === 400, r);
    r = await call("GET", "/api/pedidos?id_sucursal=abc", undefined, tok.BODEGUERO);
    check("id_sucursal inválido -> 400", r.status === 400, r);
    r = await call("GET", "/api/pedidos?desde=19-10-2026", undefined, tok.BODEGUERO);
    check("fecha con formato inválido -> 400", r.status === 400, r);
    r = await call("GET", `/api/pedidos?id_cliente=${idSinCorreo}&estado=PROCESADO`, undefined, tok.CAJERO);
    check("filtros combinados cliente+estado", r.data.length === 1 && r.data[0].id_pedido === idP2, r.data);
    r = await call("GET", `/api/pedidos?id_cliente=${idMaria}&estado=ENTREGADO`, undefined, tok.CAJERO);
    check("Nueva solicitud sigue funcionando (entregados del cliente)", r.status === 200 && r.data.length === 1, r.data);

    console.log("\n== Cuenta web de un cliente de mostrador");
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "María", apellido: "López", email: "maria@correo.com", password: "Clave1234" });
    check("registro web con correo de mostrador -> 400 con indicación de activar", r.status === 400 && /caja/.test(r.data.message), r);
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "W", apellido: "C", email: "web@x.com", password: "Clave1234" });
    check("registro con correo de cuenta web -> mensaje de iniciar sesión", r.status === 400 && /Inicia sesión/.test(r.data.message), r);
    r = await call("POST", `/api/clientes/${idSinCorreo}/codigo-web`, undefined, tok.CAJERO);
    check("código para cliente sin correo -> 400", r.status === 400, r);
    const idWeb = (await q(`SELECT id_cliente FROM "Cliente" WHERE email='web@x.com'`))[0].id_cliente;
    r = await call("POST", `/api/clientes/${idWeb}/codigo-web`, undefined, tok.CAJERO);
    check("código para cliente que ya tiene cuenta web -> 400", r.status === 400, r);
    r = await call("PUT", `/api/clientes/${idWeb}`, { email: "otro@x.com" }, tok.CAJERO);
    check("no se cambia el correo de un cliente con cuenta web -> 400", r.status === 400, r);
    r = await call("POST", `/api/clientes/${idMaria}/codigo-web`, undefined, tok.BODEGUERO);
    check("BODEGUERO no genera códigos -> 403", r.status === 403, r);
    r = await call("POST", `/api/clientes/${idMaria}/codigo-web`, undefined, tok.CAJERO);
    const codigo1 = r.data.codigo;
    check("CAJERO genera código XXXX-XXXX con vencimiento", r.status === 201 && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigo1) && new Date(r.data.expira) > new Date(), r);
    const guardado = (await q(`SELECT codigo_activacion FROM "Cliente" WHERE id_cliente=$1`, [idMaria]))[0].codigo_activacion;
    check("en la base solo queda el hash del código", guardado && guardado.length === 64 && !guardado.includes(codigo1.replace("-", "")), guardado);
    r = await call("GET", "/api/clientes", undefined, tok.CAJERO);
    check("el listado no expone el código", r.data.every((c) => !("codigo_activacion" in c)), r.data);
    r = await call("POST", `/api/clientes/${idMaria}/codigo-web`, undefined, tok.CAJERO);
    const codigo2 = r.data.codigo;
    r = await call("POST", "/api/tienda/auth/activar", { email: "maria@correo.com", codigo: codigo1, password: "Nueva1234" });
    check("el código anterior deja de valer al generar otro", r.status === 400, r);
    r = await call("POST", "/api/tienda/auth/activar", { email: "otra@correo.com", codigo: codigo2, password: "Nueva1234" });
    const malCorreo = r;
    r = await call("POST", "/api/tienda/auth/activar", { email: "maria@correo.com", codigo: "AAAA-AAAA", password: "Nueva1234" });
    check("correo o código incorrecto -> 400 con el mismo mensaje", malCorreo.status === 400 && r.status === 400 && malCorreo.data.message === r.data.message, [malCorreo, r]);
    r = await call("POST", "/api/tienda/auth/activar", { email: "maria@correo.com", codigo: codigo2, password: "corta" });
    check("contraseña corta -> 400", r.status === 400, r);
    await q(`UPDATE "Cliente" SET codigo_activacion_expira = NOW() - interval '1 minute' WHERE id_cliente=$1`, [idMaria]);
    r = await call("POST", "/api/tienda/auth/activar", { email: "maria@correo.com", codigo: codigo2, password: "Nueva1234" });
    check("código vencido -> 400", r.status === 400, r);
    // Desactivar invalida el código: al reactivar hace falta uno nuevo.
    r = await call("POST", `/api/clientes/${idMaria}/codigo-web`, undefined, tok.CAJERO);
    const codigoDesact = r.data.codigo;
    await call("PUT", `/api/clientes/${idMaria}`, { activo: false }, tok.ADMIN);
    await call("PUT", `/api/clientes/${idMaria}`, { activo: true }, tok.ADMIN);
    r = await call("POST", "/api/tienda/auth/activar", { email: "maria@correo.com", codigo: codigoDesact, password: "Nueva1234" });
    check("un código emitido antes de desactivar no sirve tras reactivar", r.status === 400, r);
    r = await call("POST", `/api/clientes/${idMaria}/codigo-web`, undefined, tok.CAJERO);
    const codigo3 = r.data.codigo;
    r = await call("POST", "/api/tienda/auth/activar", { email: " MARIA@correo.com ", codigo: codigo3.toLowerCase().replace("-", " "), password: "Nueva1234" });
    check("activación correcta (correo y código sin importar mayúsculas/espacios) devuelve sesión", r.status === 200 && !!r.data.token && r.data.cliente.id_cliente === idMaria && !("password" in r.data.cliente) && !("codigo_activacion" in r.data.cliente), r);
    const tokMaria = r.data.token;
    r = await call("GET", "/api/tienda/pedidos", undefined, tokMaria);
    const listaM = Array.isArray(r.data) ? r.data : r.data.pedidos || [];
    check("la cuenta activada ve sus compras de mostrador", r.status === 200 && listaM.some((p) => p.id_pedido === idP1), r.data);
    r = await call("POST", "/api/tienda/auth/activar", { email: "maria@correo.com", codigo: codigo3, password: "Otra12345" });
    check("el código no se puede reutilizar", r.status === 400, r);
    r = await call("POST", "/api/tienda/auth/login", { email: "maria@correo.com", password: "Nueva1234" });
    check("login con la contraseña creada", r.status === 200, r);
    const restos = (await q(`SELECT codigo_activacion, codigo_activacion_expira, password IS NOT NULL AS tiene FROM "Cliente" WHERE id_cliente=$1`, [idMaria]))[0];
    check("tras activar se borra el código", restos.codigo_activacion === null && restos.codigo_activacion_expira === null && restos.tiene, restos);
    r = await call("GET", "/api/clientes", undefined, tok.CAJERO);
    check("ahora figura con cuenta web", r.data.find((c) => c.id_cliente === idMaria).tiene_cuenta_web === true, r.data);
    r = await call("PUT", `/api/clientes/${idMaria}`, { activo: false }, tok.ADMIN);
    check("ADMIN desactiva cliente", r.status === 200 && r.data.activo === false, r);
    r = await call("GET", "/api/tienda/perfil", undefined, tokMaria);
    check("cliente desactivado pierde la sesión de la tienda", r.status === 401, r);
    r = await call("POST", "/api/pedidos", { id_cliente: idMaria, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.CAJERO);
    check("no se vende a un cliente desactivado", r.status === 400, r);

    console.log("\n== Proveedores");
    r = await call("POST", "/api/proveedores", { nombre_empresa: "Telas GT" }, tok.CAJERO);
    check("CAJERO no crea proveedores -> 403", r.status === 403, r);
    r = await call("POST", "/api/proveedores", { nombre_empresa: "  ", email: "x@y.com" }, tok.BODEGUERO);
    check("sin nombre -> 400", r.status === 400, r);
    r = await call("POST", "/api/proveedores", { nombre_empresa: "Telas GT", email: "malo" }, tok.BODEGUERO);
    check("correo inválido -> 400", r.status === 400, r);
    r = await call("POST", "/api/proveedores", { nombre_empresa: " Telas GT ", nombre_contacto: "Ana", email: "VENTAS@Telas.com", telefono: "2222", activo: false, id_proveedor: 50 }, tok.BODEGUERO);
    const idProv = r.data.id_proveedor;
    check("BODEGUERO crea proveedor (recorta, minúsculas, activo por defecto ignora id)", r.status === 201 && r.data.nombre_empresa === "Telas GT" && r.data.email === "ventas@telas.com" && r.data.activo === false && idProv !== 50, r);
    r = await call("PUT", `/api/proveedores/${idProv}`, { activo: true, telefono: "" }, tok.BODEGUERO);
    check("editar proveedor (teléfono vacío -> null)", r.status === 200 && r.data.activo === true && r.data.telefono === null, r);
    r = await call("PUT", `/api/proveedores/${idProv}`, { activo: "si" }, tok.BODEGUERO);
    check("activo no booleano -> 400", r.status === 400, r);
    r = await call("PUT", `/api/proveedores/999`, { telefono: "1" }, tok.BODEGUERO);
    check("editar inexistente -> 404", r.status === 404, r);
    r = await call("DELETE", `/api/proveedores/${idProv}`, undefined, tok.BODEGUERO);
    check("BODEGUERO no elimina -> 403", r.status === 403, r);
    r = await call("DELETE", `/api/proveedores/${idProv}`, undefined, tok.ADMIN);
    check("ADMIN elimina proveedor", r.status === 200 && (await q(`SELECT count(*)::int n FROM "Proveedor"`))[0].n === 0, r);
    r = await call("DELETE", `/api/proveedores/${idProv}`, undefined, tok.ADMIN);
    check("eliminar de nuevo -> 404", r.status === 404, r);
    const audProv = await q(`SELECT accion FROM auditoria WHERE tabla_afectada='Proveedor' ORDER BY id_auditoria`);
    check("auditoría de proveedores", audProv.map((a) => a.accion).join() === "PROVEEDOR_CREADO,PROVEEDOR_ACTUALIZADO,PROVEEDOR_ELIMINADO", audProv);
  } catch (e) {
    console.error(e); fails.push("excepción: " + e.message);
  } finally {
    if (srv) srv.kill();
    await pg.end();
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
