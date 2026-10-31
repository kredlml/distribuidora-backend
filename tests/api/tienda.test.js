// E2E de la tienda en línea contra Postgres desechable + Stripe falso (HTTP local).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18080, PORT_SIM = 18081, STRIPE_PORT = 12111;
const BASE_ENV = {
  NODE_ENV: "development", DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  DB_PORT: "54329", CORS_ORIGIN: "http://localhost:8081,http://localhost:8082",
};
const ENV = { ...BASE_ENV, PORT: String(PORT), STRIPE_SECRET_KEY: "sk_test_fake_key", STRIPE_API_HOST: "localhost", STRIPE_API_PORT: String(STRIPE_PORT), STRIPE_API_PROTOCOL: "http" };
const ENV_SIM = { ...BASE_ENV, PORT: String(PORT_SIM), STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad" };

// ---- Stripe falso: payment_intents create / retrieve / cancel
const pis = new Map();
let piSeq = 0, piCreados = 0;
const stripeFake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const m = req.url.match(/^\/v1\/payment_intents(?:\/([^/?]+))?(\/cancel)?/);
    if (!m) return send(404, { error: { message: "ruta no simulada " + req.url } });
    if (req.method === "POST" && !m[1]) {
      const p = new URLSearchParams(body);
      const id = "pi_fake_" + (++piSeq);
      const pi = { id, object: "payment_intent", amount: Number(p.get("amount")), currency: p.get("currency"), status: "requires_payment_method", client_secret: id + "_secret_x", metadata: {} };
      pis.set(id, pi); piCreados++;
      return send(200, pi);
    }
    const pi = pis.get(m[1]);
    if (!pi) return send(404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
    if (req.method === "GET") return send(200, pi);
    if (req.method === "POST" && m[2]) {
      if (pi.status === "succeeded" || pi.status === "processing") return send(400, { error: { type: "invalid_request_error", message: `You cannot cancel this PaymentIntent because it has a status of ${pi.status}.` } });
      pi.status = "canceled";
      return send(200, pi);
    }
    send(400, { error: { message: "no simulado" } });
  });
});

const fails = [];
let passes = 0;
function check(name, cond, info) {
  if (cond) { passes++; console.log("  ok  " + name); }
  else { fails.push(name); console.log("  FAIL " + name + (info !== undefined ? "  -> " + JSON.stringify(info).slice(0, 600) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, params) => (await pg.query(sql, params)).rows;

function mkCall(port) {
  return async (method, url, body, token, extra = {}, raw = false) => {
    const headers = { ...extra };
    if (body !== undefined && !raw) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    const r = await fetch(`http://localhost:${port}${url}`, { method, headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, headers: r.headers };
  };
}
const call = mkCall(PORT), callSim = mkCall(PORT_SIM);

function arrancar(env, log) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...env }, stdio: ["ignore", out, out] });
}
async function esperar(port) {
  for (let i = 0; i < 120; i++) { await sleep(500); try { const r = await fetch(`http://localhost:${port}/`); if (r.ok) return true; } catch {} }
  return false;
}

(async () => {
  await new Promise((r) => stripeFake.listen(STRIPE_PORT, r));
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const srv = arrancar(ENV, "server-tienda.log");
  let srvSim;
  try {
    await esperar(PORT);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if ((await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Cliente' AND column_name='password'`))[0].n === 1 && (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`))[0].n >= 14) break; } catch {} }
    await sleep(3000);

    // ---- Seed
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true),('Cerrada','z','GT',false)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Camisas'),('Pantalones')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria,imagen_url) VALUES ('Camisa Oxford',150,5,true,'M','Azul',1,'https://img.example.com/oxford.jpg')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria,id_producto_padre) VALUES ('Camisa Oxford',150,5,true,'L','Azul',1,1),('Camisa Oxford',160,5,true,'M','Blanco',1,1),('Camisa Oxford',150,5,false,'XL','Azul',1,1)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Jeans Slim',300,5,true,'32',2)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (30,1,1,'A','DISPONIBLE'),(30,2,1,'B','DISPONIBLE'),(5,3,1,'C','DISPONIBLE'),(2,1,2,'D','DISPONIBLE'),(9,1,3,'E','DISPONIBLE'),(4,1,1,'F','DANADA'),(30,5,1,'G','DISPONIBLE')`);
    await q(`INSERT INTO "Cliente"(nombre,apellido,email,activo) VALUES ('Mostrador','Sin Cuenta','mostrador@x.com',true)`);
    const stock = async (p, s) => Number((await q(`SELECT COALESCE(SUM(cantidad),0) n FROM "Inventario" WHERE id_producto=$1 AND id_sucursal=$2 AND estado='DISPONIBLE'`, [p, s]))[0].n);

    await call("POST", "/api/auth/registro", { nombre: "Admin", apellido: "T", email: "admin@t.com", password: "Clave1234" });
    const tokAdmin = (await call("POST", "/api/auth/login", { email: "admin@t.com", password: "Clave1234" })).data.token;

    // ---- Cuentas
    console.log("\n== Cuentas de cliente");
    let r = await call("POST", "/api/tienda/auth/registro", { nombre: "Ana", apellido: "Lopez", email: "ANA@x.com", password: "corta" });
    check("registro con contraseña corta -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "Ana", apellido: "Lopez", email: "no-es-email", password: "12345678" });
    check("registro con email inválido -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "M", apellido: "S", email: "MOSTRADOR@x.com", password: "12345678" });
    check("registro con email de cliente de mostrador existente -> 400 (no se toma la ficha)", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "Ana", apellido: "Lopez", email: "ANA@x.com", password: "12345678", direccion: "Zona 10" });
    check("registro 201 con token y sin password en respuesta", r.status === 201 && r.data.token && !("password" in r.data.cliente) && r.data.cliente.email === "ana@x.com", r.data);
    const tokAna = r.data.token, idAna = r.data.cliente.id_cliente;
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "Ana", apellido: "Lopez", email: "ana@X.com", password: "12345678" });
    check("registro duplicado (mayúsculas distintas) -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/auth/login", { email: "ana@x.com", password: "mala-clave" });
    check("login con clave incorrecta -> 401", r.status === 401, r.data);
    r = await call("POST", "/api/tienda/auth/login", { email: "mostrador@x.com", password: "12345678" });
    check("login de cliente sin cuenta web -> 401 (no 500)", r.status === 401, r.data);
    r = await call("POST", "/api/tienda/auth/login", { email: " Ana@X.com ", password: "12345678" });
    check("login 200 (email sin distinguir mayúsculas)", r.status === 200 && r.data.token, r.data);
    const tokBeto = (await call("POST", "/api/tienda/auth/registro", { nombre: "Beto", apellido: "Ruiz", email: "beto@x.com", password: "12345678", direccion: "Zona 1" })).data.token;
    r = await call("GET", "/api/tienda/perfil", undefined, tokAna);
    check("perfil 200 sin password", r.status === 200 && r.data.nombre === "Ana" && !("password" in r.data), r.data);
    r = await call("PUT", "/api/tienda/perfil", { telefono: "5555", email: "otro@x.com", nombre: "  " }, tokAna);
    check("perfil con nombre vacío -> 400", r.status === 400, r.data);
    r = await call("PUT", "/api/tienda/perfil", { telefono: "5555", email: "otro@x.com" }, tokAna);
    check("perfil actualiza teléfono e ignora email", r.status === 200 && r.data.telefono === "5555" && r.data.email === "ana@x.com", r.data);

    console.log("\n== Separación de tokens / datos personales");
    for (const url of ["/api/pedidos", "/api/devoluciones", "/api/clientes", "/api/empleados", "/api/inventario"]) {
      r = await call("GET", url, undefined, tokAna);
      check(`token de cliente rechazado en ${url} -> 403`, r.status === 403, r.data);
    }
    r = await call("GET", "/api/tienda/pedidos", undefined, tokAdmin);
    check("token de empleado rechazado en la tienda -> 403", r.status === 403, r.data);
    r = await call("GET", "/api/clientes");
    check("GET /api/clientes sin token -> 403", r.status === 403, r.data);
    r = await call("GET", "/api/clientes", undefined, tokAdmin);
    check("GET /api/clientes con empleado: sin hashes de contraseña", r.status === 200 && r.data.length === 3 && r.data.every(c => !("password" in c)), r.data);
    r = await call("POST", "/api/clientes", { nombre: "X", apellido: "Y" });
    check("POST /api/clientes sin token -> 403", r.status === 403, r.data);

    // ---- Catálogo
    console.log("\n== Catálogo");
    r = await call("GET", "/api/tienda/catalogo?id_sucursal=1");
    const oxford = r.data.find(p => p.id_prenda === 1);
    check("catálogo agrupa variantes activas (3 de Oxford; XL inactiva excluida)", r.status === 200 && oxford && oxford.variantes.length === 3 && !oxford.variantes.some(v => v.id_producto === 4), oxford);
    check("stock por sucursal solo DISPONIBLE (M Azul = 30 en Centro, ignora DANADA)", oxford.variantes.find(v => v.id_producto === 1).stock === 30, oxford.variantes);
    check("stock_por_sucursal excluye sucursal inactiva", oxford.variantes.find(v => v.id_producto === 1).stock_por_sucursal[3] === undefined && oxford.variantes.find(v => v.id_producto === 1).stock_por_sucursal[2] === 2, oxford.variantes[0]);
    check("precio_min/max e imagen y categoría", oxford.precio_min === 150 && oxford.precio_max === 160 && oxford.imagen_url && oxford.categoria.nombre === "Camisas", oxford);
    r = await call("GET", "/api/tienda/catalogo?q=blanco");
    check("búsqueda por color", r.data.length === 1 && r.data[0].id_prenda === 1, r.data.map(p => p.nombre));
    r = await call("GET", "/api/tienda/catalogo?id_categoria=2");
    check("filtro por categoría", r.data.length === 1 && r.data[0].nombre === "Jeans Slim", r.data.map(p => p.nombre));
    r = await call("GET", "/api/tienda/catalogo/3");
    check("detalle desde una variante devuelve el grupo + sucursales activas", r.status === 200 && r.data.id_prenda === 1 && r.data.variantes.length === 3 && r.data.sucursales.length === 2, r.data);
    r = await call("GET", "/api/tienda/catalogo/999");
    check("detalle inexistente -> 404", r.status === 404, r.data);

    // ---- Pedidos
    console.log("\n== Pedidos de la tienda");
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 2 }] });
    check("crear pedido sin sesión -> 403", r.status === 403, r.data);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [] }, tokAna);
    check("carrito vacío -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 21 }] }, tokAna);
    check("más de 20 unidades por prenda -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 3, detalles: [{ id_producto: 1, cantidad: 1 }] }, tokAna);
    check("sucursal inactiva -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 4, cantidad: 1 }] }, tokAna);
    check("prenda inactiva -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, id_cliente: 999, detalles: [{ id_producto: 1, cantidad: 2 }, { id_producto: 3, cantidad: 1 }] }, tokAna);
    check("crear pedido 201 (cliente del token, dirección del perfil, total por hooks)", r.status === 201 && r.data.pedido.id_cliente === idAna && r.data.pedido.direccion_entrega === "Zona 10" && Number(r.data.pedido.total) === 460 && r.data.pedido.id_empleado === null, r.data);
    const p1 = r.data.pedido.id_pedido;
    check("stock descontado y movimientos VENTA sin empleado", await stock(1, 1) === 28 && (await q(`SELECT count(*)::int n FROM "MovimientoInventario" WHERE id_pedido=$1 AND tipo_movimiento='VENTA' AND id_empleado IS NULL`, [p1]))[0].n === 2);
    r = await call("GET", "/api/tienda/pedidos", undefined, tokAna);
    check("mis pedidos lista solo los propios", r.status === 200 && r.data.length === 1 && r.data[0].id_pedido === p1, r.data);
    r = await call("GET", `/api/tienda/pedidos/${p1}`, undefined, tokBeto);
    check("pedido de otro cliente -> 404", r.status === 404, r.data);
    r = await call("GET", `/api/tienda/pedidos/${p1}`, undefined, tokAna);
    check("detalle del pedido con saldo 460 y sin id_transaccion", r.status === 200 && r.data.saldo === 460 && r.data.DetallePedidos.length === 2, r.data);

    // ---- Pago con Stripe (falso)
    console.log("\n== Pago con tarjeta (Stripe)");
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago`, undefined, tokBeto);
    check("pagar pedido ajeno -> 404", r.status === 404, r.data);
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago`, undefined, tokAna);
    check("iniciar pago 201 con client_secret por el saldo", r.status === 201 && r.data.client_secret && r.data.monto === 460 && pis.get(r.data.client_secret.split("_secret")[0]).amount === 46000, r.data);
    const pago1 = r.data.id_pago, pi1 = r.data.client_secret.split("_secret")[0];
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago`, undefined, tokAna);
    check("reintento (doble clic) reutiliza el mismo PaymentIntent", r.status === 200 && r.data.id_pago === pago1 && piCreados === 1, [r.data, piCreados]);
    r = await call("POST", `/api/pagos`, { metodo_pago: "PAYPAL", monto: 1, id_pedido: p1 }, tokAdmin);
    check("caja no puede cobrar encima del pago en curso (saldo comprometido) -> 400", r.status === 400, r.data);
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago/confirmar`, { id_pago: pago1 }, tokAna);
    check("confirmar sin cobro aún: pedido sigue PENDIENTE", r.status === 200 && r.data.estado_pedido === "PENDIENTE" && r.data.estado_pago === "PENDIENTE", r.data);
    pis.get(pi1).status = "processing";
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago`, undefined, tokAna);
    check("PaymentIntent en processing -> procesando:true", r.data.procesando === true, r.data);
    pis.get(pi1).status = "succeeded";
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago/confirmar`, { id_pago: pago1 }, tokAna);
    check("confirmar tras cobro: pago COMPLETADO y pedido PROCESADO", r.status === 200 && r.data.estado_pedido === "PROCESADO" && r.data.estado_pago === "COMPLETADO", r.data);
    // El webhook llega después: no debe duplicar nada.
    const stripeLib = require(B + "/node_modules/stripe")("sk_test_fake_key");
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "payment_intent.succeeded", data: { object: { id: pi1, object: "payment_intent" } } });
    r = await call("POST", "/api/webhook", payload, null, { "Content-Type": "application/json", "stripe-signature": stripeLib.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" }) }, true);
    check("webhook tardío idempotente (200, sin reembolso ni doble cobro)", r.status === 200 && (await q(`SELECT count(*)::int n FROM auditoria WHERE accion='PAGO_REQUIERE_REEMBOLSO'`))[0].n === 0 && (await q(`SELECT count(*)::int n FROM "Pago" WHERE id_pedido=$1 AND estado_pago='COMPLETADO'`, [p1]))[0].n === 1);
    r = await call("POST", `/api/tienda/pedidos/${p1}/pago`, undefined, tokAna);
    check("pagar pedido ya PROCESADO -> 400", r.status === 400, r.data);
    r = await call("POST", `/api/tienda/pedidos/${p1}/cancelar`, undefined, tokAna);
    check("cancelar pedido pagado -> 400", r.status === 400, r.data);

    // Pago vía webhook (sin confirmar desde la tienda)
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, direccion_entrega: "Otra dirección", detalles: [{ id_producto: 5, cantidad: 1 }] }, tokBeto);
    const p2 = r.data.pedido.id_pedido;
    check("pedido con dirección distinta a la del perfil", r.data.pedido.direccion_entrega === "Otra dirección", r.data);
    r = await call("POST", `/api/tienda/pedidos/${p2}/pago`, undefined, tokBeto);
    const pi2 = r.data.client_secret.split("_secret")[0];
    pis.get(pi2).status = "succeeded";
    const payload2 = JSON.stringify({ id: "evt_2", object: "event", type: "payment_intent.succeeded", data: { object: { id: pi2, object: "payment_intent" } } });
    r = await call("POST", "/api/webhook", payload2, null, { "Content-Type": "application/json", "stripe-signature": stripeLib.webhooks.generateTestHeaderString({ payload: payload2, secret: "whsec_test_secret" }) }, true);
    check("webhook procesa el pago de la tienda -> PROCESADO", r.status === 200 && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [p2]))[0].estado === "PROCESADO");

    // Monto que ya no corresponde: se reemplaza el PaymentIntent
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 5, cantidad: 1 }] }, tokBeto);
    const p3 = r.data.pedido.id_pedido;
    r = await call("POST", `/api/tienda/pedidos/${p3}/pago`, undefined, tokBeto);
    const pi3 = r.data.client_secret.split("_secret")[0], pago3 = r.data.id_pago;
    pis.get(pi3).status = "canceled";
    r = await call("POST", `/api/tienda/pedidos/${p3}/pago`, undefined, tokBeto);
    check("PaymentIntent cancelado en Stripe: se anula y se crea uno nuevo", r.status === 201 && r.data.id_pago !== pago3 && (await q(`SELECT estado_pago FROM "Pago" WHERE id_pago=$1`, [pago3]))[0].estado_pago === "FALLIDO", r.data);

    // ---- Cancelación desde la tienda
    console.log("\n== Cancelación desde la tienda");
    const s1 = await stock(5, 1);
    r = await call("POST", `/api/tienda/pedidos/${p3}/cancelar`, undefined, tokAna);
    check("cancelar pedido ajeno -> 404", r.status === 404, r.data);
    r = await call("POST", `/api/tienda/pedidos/${p3}/cancelar`, undefined, tokBeto);
    const piNuevo = [...pis.values()].pop();
    check("cancelar con pago en curso: PaymentIntent cancelado en Stripe, pago FALLIDO, pedido CANCELADO", r.status === 200 && piNuevo.status === "canceled" && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [p3]))[0].estado === "CANCELADO" && (await q(`SELECT count(*)::int n FROM "Pago" WHERE id_pedido=$1 AND estado_pago='PENDIENTE'`, [p3]))[0].n === 0, r.data);
    check("stock devuelto al cancelar (+1)", await stock(5, 1) === s1 + 1);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 5, cantidad: 1 }] }, tokBeto);
    const p4 = r.data.pedido.id_pedido;
    r = await call("POST", `/api/tienda/pedidos/${p4}/pago`, undefined, tokBeto);
    pis.get(r.data.client_secret.split("_secret")[0]).status = "succeeded";
    const s2 = await stock(5, 1);
    r = await call("POST", `/api/tienda/pedidos/${p4}/cancelar`, undefined, tokBeto);
    check("[#4] cancelar cuando Stripe ya cobró -> 409, registra el cobro (PROCESADO) y no devuelve stock", r.status === 409 && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [p4]))[0].estado === "PROCESADO" && await stock(5, 1) === s2, r.data);
    await call("POST", `/api/tienda/pedidos/${p4}/pago/confirmar`, {}, tokBeto);
    check("…y confirmar después no duplica nada", (await q(`SELECT count(*)::int n FROM "Pago" WHERE id_pedido=$1 AND estado_pago='COMPLETADO'`, [p4]))[0].n === 1);

    // ---- Regresiones de la revisión adversarial de la tienda
    console.log("\n== Regresiones de la revisión (tienda)");
    const tokCaro = (await call("POST", "/api/tienda/auth/registro", { nombre: "Caro", apellido: "Paz", email: "caro@x.com", password: "12345678", direccion: "Zona 4" })).data.token;
    const nuevoP = async (tok, detalles) => (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles }, tok)).data.pedido.id_pedido;
    // #1 tope por producto tras unir líneas repetidas
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 15 }, { id_producto: 2, cantidad: 15 }] }, tokCaro);
    check("[#1] 15+15 del mismo producto en líneas repetidas -> 400", r.status === 400, r.data);
    // #4 PaymentIntent ya cancelado en Stripe pero PENDIENTE en BD: se puede cancelar el pedido
    let px = await nuevoP(tokCaro, [{ id_producto: 5, cantidad: 1 }]);
    r = await call("POST", `/api/tienda/pedidos/${px}/pago`, undefined, tokCaro);
    pis.get(r.data.client_secret.split("_secret")[0]).status = "canceled";
    r = await call("POST", `/api/tienda/pedidos/${px}/cancelar`, undefined, tokCaro);
    check("[#4] PI ya cancelado en Stripe: cancelar el pedido 200", r.status === 200 && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [px]))[0].estado === "CANCELADO", r.data);
    // #4 (panel) anular un pago cuyo PI ya se cobró -> se registra como COMPLETADO
    px = await nuevoP(tokCaro, [{ id_producto: 5, cantidad: 1 }]);
    r = await call("POST", `/api/tienda/pedidos/${px}/pago`, undefined, tokCaro);
    pis.get(r.data.client_secret.split("_secret")[0]).status = "succeeded";
    r = await call("PUT", `/api/pagos/${r.data.id_pago}/anular`, undefined, tokAdmin);
    check("[#4] panel: anular un pago que Stripe ya cobró -> 409 y queda COMPLETADO/PROCESADO", r.status === 409 && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [px]))[0].estado === "PROCESADO", r.data);
    // #5 cancelar con un pago de caja ya completado: se rechaza SIN cancelar el PI en Stripe
    px = await nuevoP(tokCaro, [{ id_producto: 5, cantidad: 1 }]);
    r = await call("POST", "/api/pagos", { metodo_pago: "PAYPAL", monto: 100, id_pedido: px }, tokAdmin);
    await call("PUT", `/api/pagos/${r.data.pago.id_pago}/confirmar`, undefined, tokAdmin);
    r = await call("POST", `/api/tienda/pedidos/${px}/pago`, undefined, tokCaro);
    const pi5 = r.data.client_secret.split("_secret")[0];
    check("[#7] el PaymentIntent cobra solo el resto (200)", pis.get(pi5).amount === 20000, pis.get(pi5).amount);
    r = await call("POST", `/api/tienda/pedidos/${px}/cancelar`, undefined, tokCaro);
    check("[#5] cancelar con pago completado -> 400 y el PI sigue vivo en Stripe", r.status === 400 && pis.get(pi5).status === "requires_payment_method", [r.data, pis.get(pi5).status]);
    // #7 el total cambia (el panel agrega una línea): no se reutiliza el PI viejo
    const pagoViejo = (await q(`SELECT id_pago FROM "Pago" WHERE id_transaccion_externa=$1`, [pi5]))[0].id_pago;
    r = await call("POST", "/api/detalles", { id_pedido: px, id_producto: 2, cantidad: 1 }, tokAdmin);
    check("panel agrega una línea al pedido pendiente", r.status === 201, r.data);
    r = await call("GET", `/api/tienda/pedidos/${px}`, undefined, tokCaro);
    check("[#7] a_pagar_con_tarjeta = 450 - 100 = 350", r.data.a_pagar_con_tarjeta === 350 && r.data.saldo === 350, [r.data.saldo, r.data.a_pagar_con_tarjeta]);
    r = await call("POST", `/api/tienda/pedidos/${px}/pago`, undefined, tokCaro);
    check("[#7] monto cambió: PI nuevo por 350 y el viejo cancelado/anulado",
      r.status === 201 && r.data.id_pago !== pagoViejo && r.data.monto === 350 && pis.get(pi5).status === "canceled"
      && (await q(`SELECT estado_pago FROM "Pago" WHERE id_pago=$1`, [pagoViejo]))[0].estado_pago === "FALLIDO", r.data);
    // #6 pagar y cancelar a la vez: sin errores 500 ni estados inconsistentes
    let incoherentes = 0, errores500 = 0;
    for (let i = 0; i < 4; i++) {
      const pc = await nuevoP(tokAna, [{ id_producto: 5, cantidad: 1 }]);
      await call("POST", `/api/tienda/pedidos/${pc}/pago`, undefined, tokAna);
      const rs = await Promise.all([call("POST", `/api/tienda/pedidos/${pc}/pago`, undefined, tokAna), call("POST", `/api/tienda/pedidos/${pc}/cancelar`, undefined, tokAna), call("POST", `/api/tienda/pedidos/${pc}/pago`, undefined, tokAna)]);
      errores500 += rs.filter(x => x.status >= 500).length;
      const est = (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [pc]))[0].estado;
      const vivos = (await q(`SELECT id_transaccion_externa t FROM "Pago" WHERE id_pedido=$1 AND estado_pago='PENDIENTE'`, [pc])).map(x => x.t);
      // Un pedido CANCELADO no puede conservar pagos pendientes; cada PENDIENTE debe tener su PI vivo en Stripe.
      if ((est === "CANCELADO" && vivos.length) || vivos.some(t => pis.get(t).status === "canceled")) incoherentes++;
      if (est === "PENDIENTE") await call("POST", `/api/tienda/pedidos/${pc}/cancelar`, undefined, tokAna);
    }
    check("[#6] pagar+cancelar simultáneos: sin 500 (deadlock) ni pagos/PI desincronizados", errores500 === 0 && incoherentes === 0, { errores500, incoherentes });

    // Límite de pedidos pendientes
    const pend = [];
    for (let i = 0; i < 3; i++) pend.push((await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 1 }] }, tokBeto)).status);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 1 }] }, tokBeto);
    check("máximo 3 pedidos pendientes por cliente (4.º -> 400)", pend.every(s => s === 201) && r.status === 400, [pend, r.data]);

    // ---- Devoluciones desde la tienda
    console.log("\n== Cambio de talla desde la tienda (Logística inversa)");
    r = await call("GET", `/api/tienda/pedidos/${p1}/devolvible`, undefined, tokAna);
    check("devolvible antes de entregar: permite_devolucion=false", r.status === 200 && r.data.permite_devolucion === false, r.data);
    for (const e of ["ENVIADO", "ENTREGADO"]) await call("PUT", `/api/pedidos/${p1}/estado`, { estado: e }, tokAdmin);
    r = await call("GET", `/api/tienda/pedidos/${p1}/devolvible`, undefined, tokBeto);
    check("devolvible de pedido ajeno -> 404", r.status === 404, r.data);
    r = await call("GET", `/api/tienda/pedidos/${p1}/devolvible`, undefined, tokAna);
    check("devolvible tras ENTREGADO", r.status === 200 && r.data.permite_devolucion === true, r.data);
    const linM = r.data.detalles.find(d => d.id_producto === 1).id_detalle_pedido;
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: p1, id_cliente: 999, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", observacion: "x".repeat(256), detalles: [{ id_detalle_pedido: linM, cantidad: 1, id_producto_nuevo: 2 }] }, tokAna);
    check("comentario > 255 -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: p1, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: linM, cantidad: 1, id_producto_nuevo: 5 }] }, tokAna);
    check("cambio por prenda de otro grupo -> 400 (regla de Logística inversa)", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: p1, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: linM, cantidad: 1, id_producto_nuevo: 2 }] }, tokBeto);
    check("devolución sobre pedido ajeno -> 400", r.status === 400, r.data);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: p1, id_cliente: 999, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", observacion: "Me queda pequeña", detalles: [{ id_detalle_pedido: linM, cantidad: 1, id_producto_nuevo: 2 }] }, tokAna);
    check("solicitud de cambio 201 (id_cliente del token)", r.status === 201 && r.data.devolucion.id_cliente === idAna, r.data);
    const idDev = r.data.devolucion.id_devolucion;
    check("movimiento DEVOLUCION_SOLICITADA sin empleado (lo originó el cliente)", (await q(`SELECT id_empleado FROM "MovimientoInventario" WHERE id_devolucion=$1`, [idDev]))[0].id_empleado === null);
    r = await call("GET", "/api/devoluciones", undefined, tokAdmin);
    check("el panel ve la solicitud de la tienda", r.status === 200 && r.data.some(d => d.id_devolucion === idDev), r.status);
    await call("PUT", `/api/devoluciones/${idDev}/aprobar`, undefined, tokAdmin);
    await call("PUT", `/api/devoluciones/${idDev}/recibir`, undefined, tokAdmin);
    const ddv = (await q(`SELECT id_detalle_devolucion FROM "DetalleDevolucion" WHERE id_devolucion=$1`, [idDev]))[0].id_detalle_devolucion;
    await call("PUT", `/api/devoluciones/${idDev}/revisar`, { aceptar: true, detalles: [{ id_detalle_devolucion: ddv, resultado_revision: "BUEN_ESTADO" }] }, tokAdmin);
    r = await call("PUT", `/api/devoluciones/${idDev}/cambiar`, undefined, tokAdmin);
    check("el panel procesa el cambio (CAMBIADA)", r.status === 200, r.data);
    r = await call("GET", "/api/tienda/devoluciones", undefined, tokAna);
    check("mis devoluciones: CAMBIADA con producto nuevo", r.status === 200 && r.data.length === 1 && r.data[0].estado === "CAMBIADA" && r.data[0].DetalleDevolucions[0].ProductoNuevo.talla === "L", r.data);
    r = await call("GET", `/api/tienda/devoluciones/${idDev}`, undefined, tokAna);
    check("detalle con historial SOLICITADA→APROBADA→RECIBIDA→ACEPTADA→CAMBIADA", r.status === 200 && r.data.historial.map(h => h.estado).join(">") === "SOLICITADA>APROBADA>RECIBIDA>ACEPTADA>CAMBIADA", r.data.historial);
    r = await call("GET", `/api/tienda/devoluciones/${idDev}`, undefined, tokBeto);
    check("devolución ajena -> 404", r.status === 404, r.data);
    // #0 cambio por variante más cara (Blanco M a 160 > 150 pagado) -> rechazado
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: p1, tipo: "CAMBIO_VARIANTE", motivo: "OTRO", detalles: [{ id_detalle_pedido: linM, cantidad: 1, id_producto_nuevo: 3 }] }, tokAna);
    check("[#0] cambio por una variante más cara -> 400", r.status === 400 && /cuesta/.test(r.data.message), r.data);
    // #2 dos solicitudes simultáneas por la última unidad de la línea -> solo una pasa
    const sim = await Promise.all([1, 2, 3].map(() => call("POST", "/api/tienda/devoluciones", { id_pedido: p1, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: linM, cantidad: 1 }] }, tokAna)));
    const solicitadas = (await q(`SELECT COALESCE(SUM(dd.cantidad),0)::int n FROM "DetalleDevolucion" dd JOIN "Devolucion" d ON d.id_devolucion=dd.id_devolucion WHERE dd.id_detalle_pedido=$1 AND d.estado NOT IN ('RECHAZADA','RECHAZADA_EN_REVISION')`, [linM]))[0].n;
    check("[#2] un pedido que ya tuvo su solicitud no admite otra (ni simultáneas)", sim.every(s => s.status === 400) && solicitadas === 1, [sim.map(s => s.status), solicitadas]);
    r = await call("GET", `/api/tienda/pedidos/${p1}`, undefined, tokAna);
    check("detalle del pedido muestra su única devolución", (r.data.Devolucions || []).length === 1 && r.data.devolucion_permitida === false, r.data.Devolucions);

    // ---- Imagen de producto (panel)
    console.log("\n== Imagen de producto (panel)");
    r = await call("PUT", "/api/productos/5", { imagen_url: "javascript:alert(1)" }, tokAdmin);
    check("imagen_url con protocolo no http -> 400", r.status === 400, r.data);
    r = await call("PUT", "/api/productos/5", { imagen_url: "https://img.example.com/jeans.jpg" }, tokAdmin);
    check("imagen_url https se guarda", r.status === 200 && r.data.imagen_url === "https://img.example.com/jeans.jpg", r.data);
    r = await call("POST", "/api/productos", { nombre: "Gorra", precio_unitario: 50, id_categoria: 1, imagen_url: "nota-url" }, tokAdmin);
    check("alta con imagen_url inválida -> 400", r.status === 400, r.data);
    r = await call("PUT", "/api/productos/5", { imagen_url: "" }, tokAdmin);
    check("imagen_url vacía la borra", r.status === 200 && r.data.imagen_url === null, r.data);

    // ---- CORS
    r = await call("GET", "/api/tienda/catalogo", undefined, null, { Origin: "http://localhost:8082" });
    check("CORS permite la tienda (8082)", r.headers.get("access-control-allow-origin") === "http://localhost:8082", r.headers.get("access-control-allow-origin"));

    // ---- Modo simulado
    console.log("\n== Pago en modo simulado (clave de pruebas)");
    srvSim = arrancar(ENV_SIM, "server-tienda-sim.log");
    await esperar(PORT_SIM);
    await sleep(3000);
    await q(`UPDATE "Pedido" SET estado='CANCELADO' WHERE id_cliente=(SELECT id_cliente FROM "Cliente" WHERE email='beto@x.com') AND estado='PENDIENTE'`);
    r = await callSim("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 1 }] }, tokBeto);
    const pSim = r.data.pedido.id_pedido;
    r = await callSim("POST", `/api/tienda/pedidos/${pSim}/pago`, undefined, tokBeto);
    check("modo simulado: pago inmediato y pedido PROCESADO", r.status === 201 && r.data.modo === "simulado" && r.data.estado_pedido === "PROCESADO", r.data);

    // #3 límite de intentos de registro/login por IP (servidor principal: ya hubo 7 registros)
    const intentos = [];
    for (let i = 0; i < 4; i++) intentos.push((await call("POST", "/api/tienda/auth/registro", { nombre: "X", apellido: "Y", email: `spam${i}@x.com`, password: "12345678" })).status);
    check("[#3] el 11.º intento de registro desde la misma IP -> 429", intentos.slice(0, 3).every(s => s === 201) && intentos[3] === 429, intentos);

    // ---- Invariantes
    const inv = await q(`SELECT p.id_pedido FROM "Pedido" p LEFT JOIN "DetallePedido" d ON d.id_pedido=p.id_pedido GROUP BY p.id_pedido HAVING p.total <> GREATEST(COALESCE(SUM(d.subtotal),0) - p.descuento, 0) + p.costo_envio`);
    check("invariante: Pedido.total = SUM(subtotal) − descuento + envío", inv.length === 0, inv);
    const sobre = await q(`SELECT p.id_pedido FROM "Pedido" p JOIN "Pago" g ON g.id_pedido=p.id_pedido AND g.estado_pago='COMPLETADO' GROUP BY p.id_pedido, p.total HAVING SUM(g.monto) > p.total`);
    check("invariante: ningún pedido cobrado de más", sobre.length === 0, sobre);
  } catch (e) {
    console.error("ERROR EN PRUEBA:", e);
    fails.push("excepción: " + e.message);
  } finally {
    srv.kill(); if (srvSim) srvSim.kill();
    stripeFake.close();
    await pg.end();
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    if (fails.length) console.log("Fallos:\n - " + fails.join("\n - "));
    process.exit(fails.length ? 1 : 0);
  }
})();
