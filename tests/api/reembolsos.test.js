// E2E de reembolsos por devoluciones y cambios: Stripe (automático, pendiente, rechazado, reintento),
// caja (efectivo / POS / PayPal), pagos mixtos, diferencia de un cambio por una variante más barata,
// alcance por sucursal, concurrencia y avisos por correo. Postgres desechable + Stripe falso local.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18070, STRIPE_PORT = 12131;
const CORREOS = path.join(SALIDAS, "correos-reembolsos");
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_SECRET_KEY: "sk_test_fake_key", STRIPE_API_HOST: "localhost", STRIPE_API_PORT: String(STRIPE_PORT), STRIPE_API_PROTOCOL: "http",
  CORREO_MODO: "archivo", CORREO_CARPETA: CORREOS, SMTP_HOST: "",
};

// ---- Stripe falso: payment_intents (create/retrieve) y refunds (create/retrieve/list).
// modoRefund: "ok" (succeeded), "pendiente" (pending), "rechazo" (400 de Stripe, definitivo),
// "fallido" (status failed), "caido" (500, transitorio), "pierde" (lo crea pero responde 500).
const pis = new Map(), refunds = new Map(), porClave = new Map();
let piSeq = 0, reSeq = 0, modoRefund = "ok", demoraConsulta = 0, consultas = 0;
const llamadasRefund = [];
const stripeFake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const lista = req.url.match(/^\/v1\/refunds\?(.*)$/);
    if (lista && req.method === "GET") {
      const pi = new URLSearchParams(lista[1]).get("payment_intent");
      return send(200, { object: "list", has_more: false, data: [...refunds.values()].filter((x) => x.payment_intent === pi) });
    }
    let m = req.url.match(/^\/v1\/payment_intents(?:\/([^/?]+))?/);
    if (m) {
      if (req.method === "POST" && !m[1]) {
        const p = new URLSearchParams(body);
        const id = "pi_fake_" + (++piSeq);
        const pi = { id, object: "payment_intent", amount: Number(p.get("amount")), currency: p.get("currency"), status: "requires_payment_method", client_secret: id + "_secret_x", metadata: {} };
        pis.set(id, pi);
        return send(200, pi);
      }
      const pi = pis.get(m[1]);
      if (!pi) return send(404, { error: { type: "invalid_request_error", message: "No such payment_intent" } });
      return send(200, pi);
    }
    m = req.url.match(/^\/v1\/refunds(?:\/([^/?]+))?/);
    if (m) {
      if (req.method === "POST" && !m[1]) {
        const p = new URLSearchParams(body);
        const clave = req.headers["idempotency-key"];
        llamadasRefund.push({ clave, payment_intent: p.get("payment_intent"), amount: Number(p.get("amount")), id_reembolso: p.get("metadata[id_reembolso]") });
        if (modoRefund === "pierde" && clave && porClave.has(clave)) return send(500, { error: { type: "api_error", message: "timeout" } });
        if (clave && porClave.has(clave)) return send(200, refunds.get(porClave.get(clave))); // idempotencia
        if (modoRefund === "rechazo") return send(400, { error: { type: "invalid_request_error", message: "Charge has already been refunded." } });
        if (modoRefund === "caido") return send(500, { error: { type: "api_error", message: "Stripe caído" } });
        const pi = pis.get(p.get("payment_intent"));
        if (!pi || pi.status !== "succeeded") return send(400, { error: { type: "invalid_request_error", message: "PaymentIntent sin cobro" } });
        const re = { id: "re_fake_" + (++reSeq), object: "refund", amount: Number(p.get("amount")), payment_intent: pi.id,
          metadata: { id_reembolso: p.get("metadata[id_reembolso]"), id_pedido: p.get("metadata[id_pedido]") },
          status: modoRefund === "pendiente" ? "pending" : modoRefund === "fallido" ? "failed" : "succeeded" };
        refunds.set(re.id, re);
        if (clave) porClave.set(clave, re.id);
        // "pierde": Stripe sí lo hizo, pero la respuesta no llega.
        if (modoRefund === "pierde") return send(500, { error: { type: "api_error", message: "timeout" } });
        return send(200, re);
      }
      consultas++;
      if (demoraConsulta) await new Promise((ok) => setTimeout(ok, demoraConsulta));
      const re = refunds.get(m[1]);
      if (!re) return send(404, { error: { type: "invalid_request_error", message: "No such refund" } });
      return send(200, re);
    }
    send(404, { error: { message: "ruta no simulada " + req.url } });
  });
});

const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 700) : "")); } };
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
const correos = () => (fs.existsSync(CORREOS) ? fs.readdirSync(CORREOS).map((f) => JSON.parse(fs.readFileSync(path.join(CORREOS, f), "utf8"))) : []);
const esperarCorreo = async (cond) => { for (let i = 0; i < 20; i++) { const c = correos().find(cond); if (c) return c; await sleep(150); } return null; };
const stock = async (p, s) => Number((await q(`SELECT COALESCE(SUM(cantidad),0) n FROM "Inventario" WHERE id_producto=$1 AND id_sucursal=$2 AND estado='DISPONIBLE'`, [p, s]))[0].n);

(async () => {
  if (await ocupado(PORT) || await ocupado(STRIPE_PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  fs.rmSync(CORREOS, { recursive: true, force: true });
  await new Promise((r) => stripeFake.listen(STRIPE_PORT, r));
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const out = fs.openSync(path.join(SALIDAS, "reembolsos-servidor.log"), "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
  try {
    let listo = false;
    for (let i = 0; i < 160 && !listo; i++) {
      await sleep(500);
      try { listo = (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name='Reembolso'`))[0].n === 1 && (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1; } catch {}
    }
    check("el servidor crea la tabla Reembolso", listo);
    await sleep(1500);

    // ---- Seed: Blusa (M 200, L 200, S 150, XL 250) y Falda 100; Centro (1) y Norte (2).
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Blusa',200,1,true,'M',1)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria,id_producto_padre) VALUES ('Blusa',200,1,true,'L',1,1),('Blusa',150,1,true,'S',1,1),('Blusa',250,1,true,'XL',1,1)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Falda',100,1,true,'U',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (50,1,1,'A','DISPONIBLE'),(20,2,1,'B','DISPONIBLE'),(20,3,1,'C','DISPONIBLE'),(20,4,1,'D','DISPONIBLE'),(50,5,1,'E','DISPONIBLE'),(20,1,2,'F','DISPONIBLE')`);

    const tok = {};
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dist@t.com", password: "Clave1234" });
    tok.DIST = (await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" })).data.token;
    for (const [k, puesto, suc] of [["CAJ1", "CAJERO", 1], ["BOD1", "BODEGUERO", 1], ["CAJ2", "CAJERO", 2]]) {
      await call("POST", "/api/auth/registro", { nombre: k, apellido: "T", puesto, email: `${k.toLowerCase()}@t.com`, password: "Clave1234", id_sucursal: suc }, tok.DIST);
      tok[k] = (await call("POST", "/api/auth/login", { email: `${k.toLowerCase()}@t.com`, password: "Clave1234" })).data.token;
    }
    check("tokens de DISTRITAL, cajero y bodeguero", tok.DIST && tok.CAJ1 && tok.BOD1 && tok.CAJ2);
    const ana = (await call("POST", "/api/tienda/auth/registro", { nombre: "Ana", apellido: "Web", email: "ana@x.com", password: "12345678", direccion: "Zona 10" })).data;
    const tokAna = ana.token;
    const maria = (await call("POST", "/api/clientes", { nombre: "María", apellido: "Mostrador", email: "maria@x.com" }, tok.CAJ1)).data;

    const entregar = async (id) => { for (const estado of ["ENVIADO", "ENTREGADO"]) await call("PUT", `/api/pedidos/${id}/estado`, { estado }, tok.DIST); };
    const linea = async (idPedido, idProducto) => (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=$2`, [idPedido, idProducto]))[0].id_detalle_pedido;
    // Aprobar, recibir y revisar (todo en buen estado) una devolución.
    async function hastaAceptada(idDev) {
      await call("PUT", `/api/devoluciones/${idDev}/aprobar`, {}, tok.DIST);
      await call("PUT", `/api/devoluciones/${idDev}/recibir`, {}, tok.BOD1);
      const dets = await q(`SELECT id_detalle_devolucion FROM "DetalleDevolucion" WHERE id_devolucion=$1`, [idDev]);
      const r = await call("PUT", `/api/devoluciones/${idDev}/revisar`, { aceptar: true, detalles: dets.map((d) => ({ id_detalle_devolucion: d.id_detalle_devolucion, resultado_revision: "BUEN_ESTADO" })) }, tok.BOD1);
      return r.status === 200;
    }
    // Pedido de la tienda pagado con Stripe (falso): crear, iniciar pago, cobrar y confirmar.
    async function pedidoTiendaPagado(detalles) {
      const p = (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles }, tokAna)).data.pedido;
      const pago = (await call("POST", `/api/tienda/pedidos/${p.id_pedido}/pago`, undefined, tokAna)).data;
      pis.get(pago.client_secret.split("_secret")[0]).status = "succeeded";
      const c = await call("POST", `/api/tienda/pedidos/${p.id_pedido}/pago/confirmar`, { id_pago: pago.id_pago }, tokAna);
      return { id: p.id_pedido, pi: pago.client_secret.split("_secret")[0], procesado: c.data.estado_pedido === "PROCESADO" };
    }
    // Venta de mostrador en Centro con los pagos indicados.
    async function ventaMostrador(detalles, pagos) {
      const p = (await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, detalles }, tok.CAJ1)).data.pedido;
      let ultimo;
      for (const [metodo_pago, monto] of pagos) {
        ultimo = await call("POST", "/api/pagos", { id_pedido: p.id_pedido, metodo_pago, monto }, tok.CAJ1);
        if (metodo_pago === "PAYPAL") ultimo = await call("PUT", `/api/pagos/${ultimo.data.pago.id_pago}/confirmar`, undefined, tok.CAJ1);
      }
      return { id: p.id_pedido, procesado: ultimo.data.estado_pedido === "PROCESADO" };
    }

    // ==== A. Devolución de un pedido en línea: reembolso automático a la tarjeta
    console.log("\n== A. Devolución pagada con tarjeta en línea (Stripe)");
    const A = await pedidoTiendaPagado([{ id_producto: 1, cantidad: 2 }]);
    check("pedido de la tienda pagado con Stripe -> PROCESADO", A.procesado);
    await entregar(A.id);
    let r = await call("POST", "/api/tienda/devoluciones", { id_pedido: A.id, tipo: "DEVOLUCION", motivo: "DEFECTUOSO", detalles: [{ id_detalle_pedido: await linea(A.id, 1), cantidad: 1 }] }, tokAna);
    const devA = r.data.devolucion.id_devolucion;
    check("la clienta solicita devolver 1 de 2 blusas", r.status === 201, r);
    check("revisión aceptada", await hastaAceptada(devA));
    r = await call("PUT", `/api/devoluciones/${devA}/reintegrar`, undefined, tok.BOD1);
    const reA = (r.data.reembolsos || [])[0];
    check("reintegrar 200 devuelve un reembolso STRIPE COMPLETADO de 200", r.status === 200 && r.data.reembolsos.length === 1 && reA.metodo === "STRIPE" && Number(reA.monto) === 200 && reA.estado === "COMPLETADO" && reA.id_transaccion_externa.startsWith("re_fake_"), r.data);
    check("el mensaje lo dice", /reembolsaron Q200\.00 a la tarjeta/.test(r.data.message), r.data.message);
    const llamadaA = llamadasRefund[llamadasRefund.length - 1];
    check("Stripe recibió el reembolso sobre el PaymentIntent correcto, 20000 centavos e idempotencia", llamadaA && llamadaA.payment_intent === A.pi && llamadaA.amount === 20000 && llamadaA.clave === `reembolso-${reA.id_reembolso}` && llamadaA.id_reembolso === String(reA.id_reembolso), llamadaA);
    check("stock: la blusa vuelve a DISPONIBLE (50-2+1)", await stock(1, 1) === 49);
    const audA = (await q(`SELECT accion FROM auditoria WHERE tabla_afectada='Reembolso' AND registro_afectado_id=$1 ORDER BY id_auditoria`, [reA.id_reembolso])).map((x) => x.accion);
    check("auditoría: REEMBOLSO_CREADO y REEMBOLSO_COMPLETADO", audA.join() === "REEMBOLSO_CREADO,REEMBOLSO_COMPLETADO", audA);
    r = await call("GET", `/api/tienda/devoluciones/${devA}`, undefined, tokAna);
    check("la tienda muestra el reembolso sin ids internos", r.status === 200 && r.data.Reembolsos.length === 1 && r.data.Reembolsos[0].estado === "COMPLETADO" && !("id_transaccion_externa" in r.data.Reembolsos[0]) && !("observacion" in r.data.Reembolsos[0]), r.data.Reembolsos);
    r = await call("GET", `/api/tienda/pedidos/${A.id}`, undefined, tokAna);
    check("el pedido de la tienda también lista el reembolso", r.status === 200 && r.data.Reembolsos.length === 1 && Number(r.data.Reembolsos[0].monto) === 200, r.data.Reembolsos);
    r = await call("GET", `/api/devoluciones/${devA}`, undefined, tok.CAJ1);
    check("el panel incluye Reembolsos en el detalle de la devolución", r.status === 200 && r.data.Reembolsos.length === 1, r.data);
    check("correo: reembolso completado a la tarjeta", !!(await esperarCorreo((c) => c.etiqueta === "reembolso_completado" && c.para === "ana@x.com" && /Q200\.00/.test(c.asunto) && /tarjeta/.test(c.texto))));
    check("correo: devolución reintegrada", !!(await esperarCorreo((c) => c.etiqueta === "devolucion_reintegrada" && c.para === "ana@x.com")));
    check("correo: devolución aprobada (transición simple)", !!(await esperarCorreo((c) => c.etiqueta === "devolucion_aprobada" && c.para === "ana@x.com")));
    r = await call("PUT", `/api/devoluciones/${devA}/reintegrar`, undefined, tok.BOD1);
    const nA = (await q(`SELECT count(*)::int n FROM "Reembolso" WHERE id_devolucion=$1`, [devA]))[0].n;
    check("reintegrar otra vez -> 400 y no crea otro reembolso", r.status === 400 && nA === 1, [r, nA]);
    r = await call("PUT", `/api/reembolsos/${reA.id_reembolso}/completar`, {}, tok.CAJ1);
    check("completar a mano un reembolso de Stripe ya completado -> 400", r.status === 400, r);

    // ==== B. Stripe deja el reembolso "pending": queda PENDIENTE y se reintenta (consulta)
    console.log("\n== B. Reembolso pendiente en Stripe y reintento");
    const Bp = await pedidoTiendaPagado([{ id_producto: 5, cantidad: 1 }]);
    await entregar(Bp.id);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: Bp.id, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: await linea(Bp.id, 5), cantidad: 1 }] }, tokAna);
    const devB = r.data.devolucion.id_devolucion;
    await hastaAceptada(devB);
    modoRefund = "pendiente";
    r = await call("PUT", `/api/devoluciones/${devB}/reintegrar`, undefined, tok.BOD1);
    const reB = r.data.reembolsos[0];
    check("Stripe 'pending' -> reembolso PENDIENTE con id de Stripe", r.status === 200 && reB.estado === "PENDIENTE" && reB.id_transaccion_externa && /pendiente en Stripe/.test(r.data.message), r.data);
    const llamadasAntes = llamadasRefund.length;
    r = await call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    check("reintentar mientras sigue pending -> PENDIENTE, solo consulta (no crea otro)", r.status === 200 && r.data.reembolso.estado === "PENDIENTE" && llamadasRefund.length === llamadasAntes && /aún lo está procesando/.test(r.data.message), [r.data, llamadasRefund.length - llamadasAntes]);
    demoraConsulta = 800; const consultasAntes = consultas;
    const [x1, x2] = await Promise.all([call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.CAJ1), call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.DIST)]);
    demoraConsulta = 0;
    check("dos «Reintentar» a la vez: solo uno va a Stripe, el otro avisa que se está procesando", consultas - consultasAntes === 1 && [x1, x2].some((x) => /Otra persona/.test(x.data.message)), [consultas - consultasAntes, x1.data.message, x2.data.message]);
    refunds.get(reB.id_transaccion_externa).status = "succeeded";
    r = await call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.BOD1);
    check("BODEGUERO no reintenta -> 403", r.status === 403, r);
    r = await call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.CAJ2);
    check("cajero de otra sucursal -> 404", r.status === 404, r);
    r = await call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    check("ya succeeded en Stripe -> reintentar lo completa", r.status === 200 && r.data.reembolso.estado === "COMPLETADO" && r.data.reembolso.fecha_completado, r.data);
    r = await call("POST", `/api/reembolsos/${reB.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    check("reintentar uno completado -> 400", r.status === 400, r);

    // ==== C. Stripe caído (transitorio) y luego un rechazo definitivo: caja lo entrega en efectivo
    console.log("\n== C. Stripe caído, luego rechazo definitivo y entrega en efectivo");
    const C = await pedidoTiendaPagado([{ id_producto: 5, cantidad: 2 }]);
    await entregar(C.id);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: C.id, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: await linea(C.id, 5), cantidad: 2 }] }, tokAna);
    const devC = r.data.devolucion.id_devolucion;
    await hastaAceptada(devC);
    modoRefund = "caido";
    r = await call("PUT", `/api/devoluciones/${devC}/reintegrar`, undefined, tok.BOD1);
    const reC = r.data.reembolsos && r.data.reembolsos[0];
    check("Stripe caído (500): la devolución se reintegra y el reembolso queda PENDIENTE con el motivo", r.status === 200 && reC.estado === "PENDIENTE" && !reC.id_transaccion_externa && /Stripe:/.test(reC.observacion), r.data);
    const devCdb = (await q(`SELECT estado FROM "Devolucion" WHERE id_devolucion=$1`, [devC]))[0].estado;
    check("la devolución quedó REINTEGRADA (el error de Stripe no la revierte)", devCdb === "REINTEGRADA", devCdb);
    r = await call("PUT", `/api/reembolsos/${reC.id_reembolso}/completar`, {}, tok.CAJ1);
    check("un STRIPE pendiente no se marca a mano -> 400", r.status === 400, r);
    r = await call("POST", `/api/reembolsos/${reC.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    check("reintentar con Stripe aún caído: sigue PENDIENTE y explica el error", r.status === 200 && r.data.reembolso.estado === "PENDIENTE" && /no respondió bien/.test(r.data.message), r.data);
    modoRefund = "rechazo";
    r = await call("POST", `/api/reembolsos/${reC.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    const clavesC = llamadasRefund.filter((x) => x.id_reembolso === String(reC.id_reembolso)).map((x) => x.clave);
    check("todos los intentos usan la misma clave de idempotencia", clavesC.length >= 3 && clavesC.every((k) => k === `reembolso-${reC.id_reembolso}`), clavesC);
    check("rechazo definitivo de Stripe (400) -> FALLIDO, no se queda pendiente para siempre", r.status === 200 && r.data.reembolso.estado === "FALLIDO" && /rechazó/.test(r.data.message) && /efectivo/.test(r.data.reembolso.observacion), r.data);
    check("correo: Stripe no pudo, pasa a recogerlo en efectivo", !!(await esperarCorreo((c) => c.etiqueta === "reembolso_fallido" && c.para === "ana@x.com" && /efectivo/.test(c.texto))));
    r = await call("GET", "/api/reembolsos?estado=PENDIENTE,FALLIDO", undefined, tok.CAJ1);
    check("lista por entregar (PENDIENTE,FALLIDO) incluye el fallido", r.status === 200 && r.data.some((x) => x.id_reembolso === reC.id_reembolso), r.data);
    r = await call("PUT", `/api/reembolsos/${reC.id_reembolso}/completar`, { referencia: "Caja 2" }, tok.CAJ1);
    check("caja entrega en efectivo el reembolso que Stripe rechazó: COMPLETADO como EFECTIVO", r.status === 200 && r.data.reembolso.estado === "COMPLETADO" && r.data.reembolso.metodo === "EFECTIVO" && r.data.reembolso.id_pago && /Caja 2/.test(r.data.reembolso.observacion), r.data);
    check("correo: reembolso entregado en la sucursal", !!(await esperarCorreo((c) => c.etiqueta === "reembolso_completado" && /Q200\.00/.test(c.asunto) && /sucursal/.test(c.texto))));

    // ==== C2. Stripe hizo el reembolso pero la respuesta se perdió; se reintenta pasadas 24 h
    console.log("\n== C2. Respuesta perdida y reintento sin clave de idempotencia vigente");
    const C2 = await pedidoTiendaPagado([{ id_producto: 5, cantidad: 1 }]);
    await entregar(C2.id);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: C2.id, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: await linea(C2.id, 5), cantidad: 1 }] }, tokAna);
    const devC2 = r.data.devolucion.id_devolucion;
    await hastaAceptada(devC2);
    modoRefund = "pierde";
    r = await call("PUT", `/api/devoluciones/${devC2}/reintegrar`, undefined, tok.BOD1);
    const reC2 = r.data.reembolsos[0];
    const enStripe = () => [...refunds.values()].filter((x) => x.payment_intent === C2.pi).length;
    check("respuesta perdida: en Stripe ya existe el reembolso, aquí sigue PENDIENTE sin id", r.status === 200 && reC2.estado === "PENDIENTE" && !reC2.id_transaccion_externa && enStripe() === 1, [r.data, enStripe()]);
    porClave.clear(); // Stripe olvida las claves de idempotencia a las 24 h
    modoRefund = "ok";
    r = await call("POST", `/api/reembolsos/${reC2.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    check("reintento: encuentra el reembolso ya hecho (metadata) y no devuelve dos veces", r.status === 200 && r.data.reembolso.estado === "COMPLETADO" && enStripe() === 1 && r.data.reembolso.id_transaccion_externa === [...refunds.values()].find((x) => x.payment_intent === C2.pi).id, [r.data, enStripe()]);

    // ==== D. Venta de mostrador en efectivo: reembolso pendiente en caja
    console.log("\n== D. Devolución de una venta en efectivo (caja)");
    const D = await ventaMostrador([{ id_producto: 1, cantidad: 2 }], [["EFECTIVO", 400]]);
    check("venta en efectivo -> PROCESADO", D.procesado);
    await entregar(D.id);
    r = await call("POST", "/api/devoluciones", { id_pedido: D.id, id_cliente: maria.id_cliente, tipo: "DEVOLUCION", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: await linea(D.id, 1), cantidad: 2 }] }, tok.CAJ1);
    const devD = r.data.devolucion.id_devolucion;
    await hastaAceptada(devD);
    const [r1, r2] = await Promise.all([call("PUT", `/api/devoluciones/${devD}/reintegrar`, undefined, tok.BOD1), call("PUT", `/api/devoluciones/${devD}/reintegrar`, undefined, tok.DIST)]);
    const nD = (await q(`SELECT count(*)::int n FROM "Reembolso" WHERE id_devolucion=$1`, [devD]))[0].n;
    check("dos reintegrar simultáneos: uno 200 y otro 400", [r1.status, r2.status].sort().join() === "200,400", [r1, r2]);
    check("…y un solo reembolso y un solo reingreso al stock", nD === 1 && await stock(1, 1) === 49, [nD, await stock(1, 1)]);
    const okD = r1.status === 200 ? r1 : r2;
    const reD = okD.data.reembolsos[0];
    check("reembolso EFECTIVO 400 PENDIENTE y el mensaje pide entregarlo", reD.metodo === "EFECTIVO" && Number(reD.monto) === 400 && reD.estado === "PENDIENTE" && /Entregar Q400\.00/.test(okD.data.message), okD.data);
    check("correo: reembolso listo en caja", !!(await esperarCorreo((c) => c.etiqueta === "reembolso_en_caja" && c.para === "maria@x.com")));
    r = await call("GET", "/api/reembolsos?estado=PENDIENTE", undefined, tok.CAJ1);
    check("cajero de Centro lo ve en pendientes con cliente y sucursal", r.status === 200 && r.data.some((x) => x.id_reembolso === reD.id_reembolso && x.Pedido.Cliente.nombre === "María" && x.Pedido.Sucursal.nombre === "Centro"), r.data);
    r = await call("GET", "/api/reembolsos", undefined, tok.CAJ2);
    check("cajero de Norte no ve reembolsos de Centro", r.status === 200 && r.data.length === 0, r.data);
    r = await call("GET", "/api/reembolsos", undefined, tok.DIST);
    check("el DISTRITAL ve todos", r.status === 200 && r.data.length === 5, r.data.length);
    for (const [u, nombre] of [["/api/reembolsos?estado=X", "estado inválido"], ["/api/reembolsos?estado=PENDIENTE,X", "lista con un estado inválido"], ["/api/reembolsos?id_pedido=abc", "id_pedido inválido"], ["/api/reembolsos?id_devolucion=0", "id_devolucion 0"], ["/api/reembolsos?id_pedido=3000000000", "id_pedido fuera de rango"], ["/api/reembolsos?id_pedido=1e3", "id_pedido exponencial"]]) {
      r = await call("GET", u, undefined, tok.CAJ1);
      check(`filtro con ${nombre} -> 400`, r.status === 400, r);
    }
    for (const id of ["1e3", "99999999999", "007"]) {
      r = await call("PUT", `/api/reembolsos/${id}/completar`, {}, tok.CAJ1);
      check(`id ${id} en la ruta -> 400 (no 500)`, r.status === 400, r);
    }
    r = await call("GET", `/api/reembolsos?id_devolucion=${devD}`, undefined, tok.CAJ1);
    check("filtro por devolución", r.status === 200 && r.data.length === 1 && r.data[0].id_reembolso === reD.id_reembolso, r.data);
    r = await call("GET", "/api/reembolsos");
    check("sin token -> 403", r.status === 403, r);
    r = await call("PUT", `/api/reembolsos/${reD.id_reembolso}/completar`, {}, tok.BOD1);
    check("BODEGUERO no entrega dinero -> 403", r.status === 403, r);
    r = await call("PUT", `/api/reembolsos/${reD.id_reembolso}/completar`, {}, tok.CAJ2);
    check("cajero de otra sucursal -> 404", r.status === 404, r);
    r = await call("PUT", `/api/reembolsos/${reD.id_reembolso}/completar`, { referencia: "x".repeat(151) }, tok.CAJ1);
    check("referencia de más de 150 -> 400", r.status === 400, r);
    r = await call("POST", `/api/reembolsos/${reD.id_reembolso}/reintentar`, undefined, tok.CAJ1);
    check("reintentar uno en efectivo -> 400", r.status === 400, r);
    r = await call("PUT", "/api/reembolsos/abc/completar", {}, tok.CAJ1);
    check("id inválido -> 400", r.status === 400, r);
    const [c1, c2] = await Promise.all([call("PUT", `/api/reembolsos/${reD.id_reembolso}/completar`, { referencia: "Recibo 77" }, tok.CAJ1), call("PUT", `/api/reembolsos/${reD.id_reembolso}/completar`, {}, tok.DIST)]);
    check("dos cajeros a la vez: solo uno lo entrega", [c1.status, c2.status].sort().join() === "200,400", [c1, c2]);
    const reDdb = (await q(`SELECT estado, id_empleado, id_transaccion_externa, fecha_completado FROM "Reembolso" WHERE id_reembolso=$1`, [reD.id_reembolso]))[0];
    check("queda COMPLETADO con empleado y fecha", reDdb.estado === "COMPLETADO" && reDdb.id_empleado && reDdb.fecha_completado, reDdb);
    r = await call("GET", `/api/reembolsos?id_pedido=${D.id}`, undefined, tok.CAJ1);
    check("el listado incluye quién lo entregó", r.data[0].Empleado && r.data[0].Empleado.nombre, r.data);

    // ==== E. Pago mixto (efectivo + POS): cada método recibe hasta lo que cobró
    console.log("\n== E. Pago mixto");
    const E = await ventaMostrador([{ id_producto: 1, cantidad: 2 }], [["EFECTIVO", 100], ["TARJETA", 300]]);
    await entregar(E.id);
    r = await call("POST", "/api/devoluciones", { id_pedido: E.id, id_cliente: maria.id_cliente, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: await linea(E.id, 1), cantidad: 2 }] }, tok.CAJ1);
    await hastaAceptada(r.data.devolucion.id_devolucion);
    r = await call("PUT", `/api/devoluciones/${r.data.devolucion.id_devolucion}/reintegrar`, undefined, tok.BOD1);
    const porMetodo = Object.fromEntries((r.data.reembolsos || []).map((x) => [x.metodo, Number(x.monto)]));
    check("400 se reparte: 300 reversión en POS + 100 en efectivo", r.status === 200 && porMetodo.TARJETA === 300 && porMetodo.EFECTIVO === 100 && r.data.reembolsos.length === 2, r.data);

    // ==== F. Cambios: más caro rechazado, más barato reembolsa la diferencia, igual precio nada
    console.log("\n== F. Cambios de talla");
    const F = await ventaMostrador([{ id_producto: 1, cantidad: 1 }], [["PAYPAL", 200]]);
    check("venta con PayPal confirmada -> PROCESADO", F.procesado);
    await entregar(F.id);
    const lF = await linea(F.id, 1);
    r = await call("POST", "/api/devoluciones", { id_pedido: F.id, id_cliente: maria.id_cliente, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: lF, cantidad: 1, id_producto_nuevo: 4 }] }, tok.CAJ1);
    check("cambio por una variante más cara (XL 250 > 200) -> 400 también en mostrador", r.status === 400 && /más de lo que pagaste/.test(r.data.message), r);
    r = await call("POST", "/api/devoluciones", { id_pedido: F.id, id_cliente: maria.id_cliente, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: lF, cantidad: 1, id_producto_nuevo: 3 }] }, tok.CAJ1);
    check("el intento rechazado no consumió la única solicitud: cambio por S (150) 201", r.status === 201, r);
    const devF = r.data.devolucion.id_devolucion;
    await hastaAceptada(devF);
    const sS = await stock(3, 1);
    await q(`UPDATE "Producto" SET precio_unitario=120 WHERE id_producto=3`); // rebaja después de pedir el cambio
    r = await call("PUT", `/api/devoluciones/${devF}/cambiar`, undefined, tok.BOD1);
    check("cambiar 200: reembolsa la diferencia ACORDADA (50, no 80 tras la rebaja) por PayPal", r.status === 200 && r.data.reembolsos.length === 1 && r.data.reembolsos[0].metodo === "PAYPAL" && Number(r.data.reembolsos[0].monto) === 50 && r.data.reembolsos[0].estado === "PENDIENTE" && /por PayPal/.test(r.data.message), r.data);
    await q(`UPDATE "Producto" SET precio_unitario=150 WHERE id_producto=3`);
    check("sale una blusa S del stock", await stock(3, 1) === sS - 1);
    check("correo: cambio completado", !!(await esperarCorreo((c) => c.etiqueta === "devolucion_cambiada" && c.para === "maria@x.com")));
    check("correo PayPal: no le pide ir a caja", !!(await esperarCorreo((c) => c.etiqueta === "reembolso_en_caja" && c.para === "maria@x.com" && /PayPal/.test(c.texto) && !/caja/.test(c.texto))));

    const G = await ventaMostrador([{ id_producto: 1, cantidad: 1 }], [["EFECTIVO", 200]]);
    await entregar(G.id);
    r = await call("POST", "/api/devoluciones", { id_pedido: G.id, id_cliente: maria.id_cliente, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: await linea(G.id, 1), cantidad: 1, id_producto_nuevo: 2 }] }, tok.CAJ1);
    const devG = r.data.devolucion.id_devolucion;
    await hastaAceptada(devG);
    await q(`UPDATE "Producto" SET precio_unitario=210 WHERE id_producto=2`); // sube después de pedir el cambio
    r = await call("PUT", `/api/devoluciones/${devG}/cambiar`, undefined, tok.BOD1);
    await q(`UPDATE "Producto" SET precio_unitario=200 WHERE id_producto=2`);
    const nG = (await q(`SELECT count(*)::int n FROM "Reembolso" WHERE id_devolucion=$1`, [devG]))[0].n;
    check("cambio por variante del mismo precio (aunque luego subió): sin reembolso", r.status === 200 && r.data.reembolsos.length === 0 && nG === 0 && !/Entregar/.test(r.data.message), r.data);
    const precioGuardado = (await q(`SELECT precio_unitario_nuevo::float p FROM "DetalleDevolucion" WHERE id_devolucion=$1`, [devG]))[0].p;
    check("el detalle guarda el precio de la variante al pedir el cambio", precioGuardado === 200, precioGuardado);

    // ==== H. Tienda: la clienta tampoco puede pedir un cambio por una variante más cara
    console.log("\n== H. Tienda");
    const H = await pedidoTiendaPagado([{ id_producto: 3, cantidad: 1 }]);
    await entregar(H.id);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: H.id, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: await linea(H.id, 3), cantidad: 1, id_producto_nuevo: 1 }] }, tokAna);
    check("cambio a variante más cara en la tienda -> 400", r.status === 400, r);
    r = await call("GET", `/api/tienda/pedidos/${H.id}`, undefined, tokAna);
    check("pedido sin devolución: Reembolsos vacío", r.status === 200 && Array.isArray(r.data.Reembolsos) && r.data.Reembolsos.length === 0, r.data.Reembolsos);

    // ==== J. Stripe cobra un pedido que ya estaba cancelado: se devuelve solo
    console.log("\n== J. Cobro sobre un pedido cancelado");
    const pJ = (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 5, cantidad: 3 }] }, tokAna)).data.pedido;
    const pagoJ = (await call("POST", `/api/tienda/pedidos/${pJ.id_pedido}/pago`, undefined, tokAna)).data;
    const piJ = pagoJ.client_secret.split("_secret")[0];
    await q(`UPDATE "Pedido" SET estado='CANCELADO' WHERE id_pedido=$1`, [pJ.id_pedido]); // p. ej. venció mientras pagaba
    pis.get(piJ).status = "succeeded";
    r = await call("POST", `/api/tienda/pedidos/${pJ.id_pedido}/pago/confirmar`, { id_pago: pagoJ.id_pago }, tokAna);
    let reJ = [];
    for (let i = 0; i < 20 && !(reJ[0] && reJ[0].estado === "COMPLETADO"); i++) { await sleep(150); reJ = await q(`SELECT metodo, monto::float monto, estado, id_devolucion FROM "Reembolso" WHERE id_pedido=$1`, [pJ.id_pedido]); }
    const pagoJdb = (await q(`SELECT estado_pago FROM "Pago" WHERE id_pago=$1`, [pagoJ.id_pago]))[0].estado_pago;
    check("el cobro tardío queda REEMBOLSADO y se devuelve completo a la tarjeta", r.status === 200 && pagoJdb === "REEMBOLSADO" && reJ.length === 1 && reJ[0].metodo === "STRIPE" && reJ[0].monto === 300 && reJ[0].estado === "COMPLETADO" && reJ[0].id_devolucion === null, [r.data, pagoJdb, reJ]);
    check("Stripe recibió ese reembolso por 30000 centavos", llamadasRefund.some((x) => x.payment_intent === piJ && x.amount === 30000));
    check("el pedido sigue CANCELADO", (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [pJ.id_pedido]))[0].estado === "CANCELADO");

    // ==== I. Totales: nunca se devuelve más de lo cobrado
    const totales = await q(`SELECT r.id_pedido, SUM(r.monto)::float devuelto, (SELECT SUM(monto)::float FROM "Pago" p WHERE p.id_pedido=r.id_pedido AND p.estado_pago IN ('COMPLETADO','REEMBOLSADO')) cobrado FROM "Reembolso" r WHERE r.estado<>'FALLIDO' GROUP BY r.id_pedido`);
    check("ningún pedido tiene reembolsos por más de lo cobrado", totales.length > 0 && totales.every((x) => x.devuelto <= x.cobrado + 0.001), totales);
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("EXCEPCIÓN", e);
  } finally {
    srv.kill();
    stripeFake.close();
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
