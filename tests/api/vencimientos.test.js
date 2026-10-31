// E2E del vencimiento automático de pedidos pendientes de pago (plazo 1 h en la prueba; la revisión
// corre cada ~1 s). Postgres desechable + Stripe falso local.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18076, PORT2 = 18077, STRIPE_PORT = 12133;
const CORREOS = path.join(SALIDAS, "correos-vencimientos");
const ENV = {
  NODE_ENV: "development", DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_SECRET_KEY: "sk_test_fake_key", STRIPE_API_HOST: "localhost", STRIPE_API_PORT: String(STRIPE_PORT), STRIPE_API_PROTOCOL: "http",
  CORREO_MODO: "archivo", CORREO_CARPETA: CORREOS, SMTP_HOST: "",
  PLAZO_PEDIDO_PENDIENTE_HORAS: "1", VENCIMIENTO_INTERVALO_MIN: "0.02",
};

// Stripe falso: payment_intents create / retrieve / cancel. El estado lo fija la prueba.
const pis = new Map(); let piSeq = 0; const cancelados = [];
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
      pis.set(id, pi);
      return send(200, pi);
    }
    const pi = pis.get(m[1]);
    if (!pi) return send(404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
    if (req.method === "GET") return send(200, pi);
    if (m[2]) {
      if (["succeeded", "processing", "canceled"].includes(pi.status)) return send(400, { error: { type: "invalid_request_error", message: `You cannot cancel this PaymentIntent because it has a status of ${pi.status}.` } });
      pi.status = "canceled"; cancelados.push(pi.id);
      return send(200, pi);
    }
    send(400, { error: { message: "no simulado" } });
  });
});

const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 600) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, p) => (await pg.query(sql, p)).rows;
const mkCall = (port) => async (method, url, body, token) => {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${port}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
};
const call = mkCall(PORT);
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
function arrancar(port, log, extra = {}) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV, ...extra, PORT: String(port) }, stdio: ["ignore", out, out] });
}
async function escuchando(port) { for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await fetch(`http://localhost:${port}/`)).ok) return true; } catch {} } return false; }
const estado = async (id) => (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [id]))[0].estado;
const esperarEstado = async (id, e, ms = 8000) => { for (let i = 0; i < ms / 200; i++) { if (await estado(id) === e) return true; await sleep(200); } return false; };
const stock = async (p) => Number((await q(`SELECT COALESCE(SUM(cantidad),0) n FROM "Inventario" WHERE id_producto=$1 AND id_sucursal=1 AND estado='DISPONIBLE'`, [p]))[0].n);
const envejecer = (id, horas = 2) => q(`UPDATE "Pedido" SET fecha_pedido = now() - ($2 || ' hours')::interval WHERE id_pedido=$1`, [id, String(horas)]);
const correos = () => (fs.existsSync(CORREOS) ? fs.readdirSync(CORREOS).map((f) => JSON.parse(fs.readFileSync(path.join(CORREOS, f), "utf8"))) : []);

(async () => {
  if (await ocupado(PORT) || await ocupado(PORT2) || await ocupado(STRIPE_PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  fs.rmSync(CORREOS, { recursive: true, force: true });
  await new Promise((r) => stripeFake.listen(STRIPE_PORT, r));
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv = arrancar(PORT, "vencimientos-servidor.log"), srv2;
  try {
    check("servidor arriba", await escuchando(PORT));
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Blusa',100,1,true,'M',1),('Falda',50,1,true,'U',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (100,1,1,'A','DISPONIBLE'),(100,2,1,'B','DISPONIBLE')`);
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "D", email: "dist@t.com", password: "Clave1234" });
    const tokD = (await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" })).data.token;
    await call("POST", "/api/auth/registro", { nombre: "Caja", apellido: "C", puesto: "CAJERO", email: "caja@t.com", password: "Clave1234", id_sucursal: 1 }, tokD);
    const tokC = (await call("POST", "/api/auth/login", { email: "caja@t.com", password: "Clave1234" })).data.token;
    // Varias clientas: la tienda limita a 3 pedidos pendientes por cuenta.
    const clientas = [];
    for (let i = 0; i < 4; i++) clientas.push((await call("POST", "/api/tienda/auth/registro", { nombre: `C${i}`, apellido: "X", email: `c${i}@x.com`, password: "12345678", direccion: "Zona 1" })).data.token);
    const maria = (await call("POST", "/api/clientes", { nombre: "María", apellido: "M", email: "maria@x.com" }, tokC)).data;
    const tienda = async (tok, detalles) => (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles }, tok)).data.pedido;
    const mostrador = async (detalles) => (await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, detalles }, tokC)).data.pedido;

    console.log("\n== Plazo visible");
    const A = await tienda(clientas[0], [{ id_producto: 1, cantidad: 3 }]);
    check("al crear, la tienda informa hasta cuándo pagar (1 h)", A && A.pago_vence && Math.abs(new Date(A.pago_vence) - Date.now() - 3600e3) < 60e3, A);
    let r = await call("GET", `/api/tienda/pedidos/${A.id_pedido}`, undefined, clientas[0]);
    check("el detalle de la tienda trae pago_vence", r.status === 200 && r.data.pago_vence === A.pago_vence, r.data.pago_vence);
    r = await call("GET", `/api/pedidos/${A.id_pedido}`, undefined, tokC);
    check("el panel también lo muestra", r.status === 200 && r.data.pago_vence, r.data.pago_vence);
    r = await call("GET", "/api/tienda/pedidos", undefined, clientas[0]);
    check("la lista de mis pedidos trae pago_vence", r.status === 200 && r.data[0].pago_vence, r.data);

    console.log("\n== Vence sin pago");
    const stockAntes = await stock(1);
    await envejecer(A.id_pedido);
    check("pedido de la tienda vencido -> CANCELADO automáticamente", await esperarEstado(A.id_pedido, "CANCELADO"));
    check("el stock reservado vuelve a estar disponible", await stock(1) === stockAntes + 3, [stockAntes, await stock(1)]);
    const aud = await q(`SELECT detalles FROM auditoria WHERE tabla_afectada='Pedido' AND registro_afectado_id=$1 AND accion='PEDIDO_ESTADO_ACTUALIZADO'`, [A.id_pedido]);
    check("queda auditado como vencimiento", aud.some((a) => /vencimiento/.test(a.detalles)), aud);
    await sleep(500);
    check("correo: pedido cancelado por falta de pago", correos().some((c) => c.etiqueta === "pedido_cancelado" && c.para === "c0@x.com" && /pago/.test(c.texto)));
    r = await call("GET", `/api/tienda/pedidos/${A.id_pedido}`, undefined, clientas[0]);
    check("cancelado ya no tiene pago_vence", r.data.estado === "CANCELADO" && r.data.pago_vence === null, r.data);
    const M = await mostrador([{ id_producto: 2, cantidad: 2 }]);
    const fresco = await mostrador([{ id_producto: 2, cantidad: 1 }]);
    await envejecer(M.id_pedido);
    check("venta de mostrador sin pagos, vencida -> CANCELADO", await esperarEstado(M.id_pedido, "CANCELADO"));
    check("un pedido dentro del plazo no se toca", await estado(fresco.id_pedido) === "PENDIENTE");

    console.log("\n== Cobro con tarjeta iniciado");
    const S1 = await tienda(clientas[1], [{ id_producto: 1, cantidad: 1 }]);
    const pago1 = (await call("POST", `/api/tienda/pedidos/${S1.id_pedido}/pago`, undefined, clientas[1])).data;
    const pi1 = pago1.client_secret.split("_secret")[0];
    await envejecer(S1.id_pedido);
    await sleep(2500);
    check("intento de tarjeta reciente (< 30 min): no se cancela (podría estar pagando)", await estado(S1.id_pedido) === "PENDIENTE" && !cancelados.includes(pi1));
    r = await call("POST", `/api/tienda/pedidos/${S1.id_pedido}/pago`, undefined, clientas[1]);
    check("vencido pero con un cobro en curso: puede retomar el pago", r.status === 200 && r.data.client_secret, r);
    await q(`UPDATE "Pago" SET fecha_pago = now() - interval '1 hour' WHERE id_pago=$1`, [pago1.id_pago]);
    check("intento viejo: se cancela en Stripe y el pedido se cancela", await esperarEstado(S1.id_pedido, "CANCELADO") && cancelados.includes(pi1) && pis.get(pi1).status === "canceled");
    check("el pago queda FALLIDO", (await q(`SELECT estado_pago FROM "Pago" WHERE id_pago=$1`, [pago1.id_pago]))[0].estado_pago === "FALLIDO");

    const S2 = await tienda(clientas[2], [{ id_producto: 1, cantidad: 1 }]);
    const pago2 = (await call("POST", `/api/tienda/pedidos/${S2.id_pedido}/pago`, undefined, clientas[2])).data;
    const pi2 = pago2.client_secret.split("_secret")[0];
    pis.get(pi2).status = "succeeded"; // Stripe cobró pero el aviso no llegó
    await q(`UPDATE "Pago" SET fecha_pago = now() - interval '1 hour' WHERE id_pago=$1`, [pago2.id_pago]);
    await envejecer(S2.id_pedido);
    check("Stripe ya había cobrado: se registra el cobro y el pedido pasa a PROCESADO (no se cancela)", await esperarEstado(S2.id_pedido, "PROCESADO"));
    check("…con el pago COMPLETADO", (await q(`SELECT estado_pago FROM "Pago" WHERE id_pago=$1`, [pago2.id_pago]))[0].estado_pago === "COMPLETADO");

    const S3 = await tienda(clientas[3], [{ id_producto: 1, cantidad: 1 }]);
    const pago3 = (await call("POST", `/api/tienda/pedidos/${S3.id_pedido}/pago`, undefined, clientas[3])).data;
    pis.get(pago3.client_secret.split("_secret")[0]).status = "processing";
    await q(`UPDATE "Pago" SET fecha_pago = now() - interval '1 hour' WHERE id_pago=$1`, [pago3.id_pago]);
    await envejecer(S3.id_pedido);
    await sleep(2500);
    check("cobro en proceso en Stripe: se espera (no se cancela)", await estado(S3.id_pedido) === "PENDIENTE");

    console.log("\n== Con pagos registrados no se cancela");
    const P1 = await mostrador([{ id_producto: 1, cantidad: 2 }]);
    await call("POST", "/api/pagos", { id_pedido: P1.id_pedido, metodo_pago: "EFECTIVO", monto: 50 }, tokC);
    const P2 = await mostrador([{ id_producto: 1, cantidad: 1 }]);
    await call("POST", "/api/pagos", { id_pedido: P2.id_pedido, metodo_pago: "PAYPAL", monto: 100 }, tokC);
    await envejecer(P1.id_pedido); await envejecer(P2.id_pedido);
    await sleep(2500);
    check("pago parcial en efectivo: sigue PENDIENTE (lo resuelve caja)", await estado(P1.id_pedido) === "PENDIENTE");
    check("PayPal por confirmar: sigue PENDIENTE", await estado(P2.id_pedido) === "PENDIENTE");
    r = await call("GET", `/api/pedidos/${P1.id_pedido}`, undefined, tokC);
    check("el panel sigue mostrando que el plazo venció", r.data.pago_vence && new Date(r.data.pago_vence) < new Date(), r.data.pago_vence);

    console.log("\n== Pagar después del plazo");
    const tokE = (await call("POST", "/api/tienda/auth/registro", { nombre: "E", apellido: "X", email: "e@x.com", password: "12345678", direccion: "Zona 1" })).data.token;
    const E = await tienda(tokE, [{ id_producto: 1, cantidad: 2 }]);
    await call("POST", "/api/pagos", { id_pedido: E.id_pedido, metodo_pago: "EFECTIVO", monto: 10 }, tokD); // abono en caja: el vencimiento no lo cancela
    await envejecer(E.id_pedido);
    r = await call("POST", `/api/tienda/pedidos/${E.id_pedido}/pago`, undefined, tokE);
    check("pedido vencido sin cobro en curso: la tienda no inicia un pago nuevo", r.status === 400 && /venció/.test(r.data.message), r);

    console.log("\n== Dos servidores revisando a la vez");
    srv2 = arrancar(PORT2, "vencimientos-servidor-2.log");
    await escuchando(PORT2);
    const lote = [];
    for (let i = 0; i < 6; i++) lote.push((await mostrador([{ id_producto: 2, cantidad: 1 }])).id_pedido);
    const stock2 = await stock(2);
    for (const id of lote) await envejecer(id);
    let todos = false;
    for (let i = 0; i < 40 && !todos; i++) { await sleep(250); todos = (await q(`SELECT count(*)::int n FROM "Pedido" WHERE id_pedido = ANY($1) AND estado='CANCELADO'`, [lote]))[0].n === lote.length; }
    await sleep(1500);
    check("todos se cancelan", todos);
    check("el stock se devuelve una sola vez por pedido", await stock(2) === stock2 + lote.length, [stock2, await stock(2)]);
    const avisos = correos().filter((c) => c.etiqueta === "pedido_cancelado" && c.para === "maria@x.com").length;
    check("un solo correo de cancelación por pedido", avisos === 1 + lote.length, avisos);

    console.log("\n== Desactivado");
    srv.kill(); srv2.kill(); await sleep(1500);
    srv = arrancar(PORT, "vencimientos-servidor-3.log", { PLAZO_PEDIDO_PENDIENTE_HORAS: "0" });
    await escuchando(PORT);
    const Z = await mostrador([{ id_producto: 2, cantidad: 1 }]);
    await envejecer(Z.id_pedido, 500);
    await sleep(3000);
    r = await call("GET", `/api/pedidos/${Z.id_pedido}`, undefined, tokC);
    check("PLAZO_PEDIDO_PENDIENTE_HORAS=0 desactiva el vencimiento", await estado(Z.id_pedido) === "PENDIENTE" && r.data.pago_vence === null, r.data.pago_vence);
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("EXCEPCIÓN", e);
  } finally {
    if (srv) srv.kill(); if (srv2) srv2.kill();
    stripeFake.close();
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
