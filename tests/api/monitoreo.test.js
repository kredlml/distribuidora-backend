// E2E del punto 7: límite de intentos persistido en la base, paginación de listados y monitoreo
// (salud, X-Request-Id, errores 5xx registrados, JSON en errores y rutas inexistentes, Sentry opcional).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18078;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-monitoreo"),
};
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 600) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, p) => (await pg.query(sql, p)).rows;
async function call(method, url, body, token, extra = {}) {
  const headers = { ...extra };
  if (body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data, headers: r.headers };
}
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
function arrancar(log, extra = {}) {
  const archivo = path.join(SALIDAS, log);
  const out = fs.openSync(archivo, "w");
  const p = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV, ...extra }, stdio: ["ignore", out, out] });
  p.log = () => fs.readFileSync(archivo, "utf8");
  return p;
}
async function escuchando() { for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return true; } catch {} } return false; }
const detener = async (p) => { if (!p || p.exitCode !== null || p.signalCode !== null) return; const fin = new Promise((ok) => p.once("exit", ok)); p.kill(); await Promise.race([fin, sleep(5000)]); };

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv = arrancar("monitoreo-1.log", { SENTRY_DSN: "https://clave@sentry.invalid/1" });
  try {
    check("arranca aunque SENTRY_DSN esté configurado sin el paquete (solo avisa)", await escuchando() && /npm install @sentry\/node/.test(srv.log()), srv.log());
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Blusa',100,1,true,'M',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (500,1,1,'A','DISPONIBLE'),(500,1,2,'B','DISPONIBLE')`);
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "D", email: "dist@t.com", password: "Clave1234" });
    const tok = { D: (await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" })).data.token };
    for (const [k, puesto, s] of [["C1", "CAJERO", 1], ["A2", "ADMIN", 2], ["C2", "CAJERO", 2]]) {
      await call("POST", "/api/auth/registro", { nombre: k, apellido: "T", puesto, email: `${k}@t.com`, password: "Clave1234", id_sucursal: s }, tok.D);
      tok[k] = (await call("POST", "/api/auth/login", { email: `${k}@t.com`, password: "Clave1234" })).data.token;
    }

    console.log("\n== Salud y monitoreo");
    let r = await call("GET", "/api/salud");
    check("GET /api/salud público: estado ok y base ok, sin datos internos", r.status === 200 && r.data.estado === "ok" && r.data.base === "ok" && !("migraciones" in r.data) && !("servicios" in r.data), r.data);
    check("cada respuesta lleva X-Request-Id", /^[0-9a-f-]{36}$/.test(r.headers.get("x-request-id") || ""));
    r = await call("GET", "/api/salud/detalle", undefined, tok.A2);
    check("detalle: ADMIN no (solo DISTRITAL) -> 403", r.status === 403, r);
    r = await call("GET", "/api/salud/detalle");
    check("detalle sin token -> 403", r.status === 403, r);
    r = await call("GET", "/api/salud/detalle", undefined, tok.D);
    const migs = fs.readdirSync(path.join(B, "app", "migraciones")).filter((f) => /^\d{4}-/.test(f)).length;
    check("detalle para el DISTRITAL: migraciones, pendientes y servicios (sin secretos)", r.status === 200 && r.data.migraciones.aplicadas === migs && r.data.migraciones.pendientes.length === 0 && r.data.esquema_faltante.length === 0 && r.data.servicios.stripe === "simulado" && r.data.servicios.correo === "archivo" && !JSON.stringify(r.data).includes("clave_de_prueba") && !JSON.stringify(r.data).includes("secret_test"), r.data);
    r = await call("GET", "/api/no-existe");
    check("ruta /api inexistente: 404 en JSON", r.status === 404 && typeof r.data === "object" && /No existe la ruta/.test(r.data.message), r);
    r = await call("POST", "/api/auth/login", "{esto no es json", undefined, { "Content-Type": "application/json" });
    check("JSON mal formado: 400 en JSON con referencia (no la página HTML de Express)", r.status === 400 && typeof r.data === "object" && r.data.referencia, r);
    // Un 500 real: se rompe una tabla y se consulta.
    await q(`ALTER TABLE "Proveedor" RENAME TO "ProveedorRoto"`);
    r = await call("GET", "/api/proveedores?email=privado@x.com", undefined, tok.D);
    await sleep(500);
    const err = await q(`SELECT * FROM "ErrorServidor" ORDER BY id DESC LIMIT 1`);
    check("un 500 queda registrado en ErrorServidor con ruta, estado, usuario e id de petición", r.status === 500 && err.length === 1 && err[0].ruta === "/api/proveedores" && err[0].estado === 500 && err[0].usuario && err[0].request_id === r.headers.get("x-request-id"), [r.status, err]);
    check("…sin la query (que podría traer datos privados)", err.length === 1 && !JSON.stringify(err[0]).includes("privado@x.com"));
    await q(`ALTER TABLE "ProveedorRoto" RENAME TO "Proveedor"`);
    r = await call("GET", "/api/salud/errores", undefined, tok.D);
    check("el DISTRITAL ve los errores paginados", r.status === 200 && r.data.total >= 1 && r.data.datos[0].ruta === "/api/proveedores" && !("pila" in r.data.datos[0]), r.data);
    r = await call("GET", "/api/salud/errores", undefined, tok.C1);
    check("un cajero no ve los errores -> 403", r.status === 403, r);
    r = await call("GET", "/api/salud/detalle", undefined, tok.D);
    check("el detalle cuenta los errores del día", r.data.errores.dia >= 1, r.data.errores);
    const erroresAntes = (await q(`SELECT count(*)::int n FROM "ErrorServidor"`))[0].n;
    for (const u of ["/api/tienda/catalogo/abc", "/api/tienda/catalogo/99999999999"]) {
      r = await call("GET", u);
      check(`${u} -> 400 (no un 500 con el error de Postgres)`, r.status === 400 && !/syntax|integer/i.test(JSON.stringify(r.data)), r);
    }
    r = await call("GET", "/api/salud/errores?pagina=", undefined, tok.D);
    check("?pagina= vacío usa la primera página", r.status === 200 && r.data.pagina === 1, r);
    for (const u of ["estado=X", "tipo=Y", "id_pedido=abc", "desde=2026-13-45"]) {
      r = await call("GET", `/api/devoluciones?${u}`, undefined, tok.D);
      check(`devoluciones con filtro inválido (${u}) -> 400`, r.status === 400, r);
    }
    check("esas peticiones inválidas no llenan el registro de errores", (await q(`SELECT count(*)::int n FROM "ErrorServidor"`))[0].n === erroresAntes);

    console.log("\n== Paginación");
    for (let i = 0; i < 30; i++) await call("POST", "/api/clientes", { nombre: i % 2 ? `Ana${i}` : `Luz${i}`, apellido: "Prueba", email: `c${i}@x.com`, telefono: `5555${String(i).padStart(4, "0")}` }, i < 20 ? tok.C1 : tok.C2);
    r = await call("GET", "/api/clientes", undefined, tok.D);
    check("sin ?pagina sigue devolviendo el arreglo completo (ventas y solicitudes lo usan)", Array.isArray(r.data) && r.data.length === 30, r.data.length);
    r = await call("GET", "/api/clientes?pagina=1", undefined, tok.D);
    check("pagina=1: 25 por página, total 30, 2 páginas, más nuevos primero", r.data.datos.length === 25 && r.data.total === 30 && r.data.paginas === 2 && r.data.datos[0].id_cliente > r.data.datos[1].id_cliente, { ...r.data, datos: r.data.datos && r.data.datos.length });
    r = await call("GET", "/api/clientes?pagina=2", undefined, tok.D);
    check("pagina=2: los 5 restantes", r.data.datos.length === 5 && r.data.pagina === 2, r.data.datos.length);
    r = await call("GET", "/api/clientes?pagina=1&q=ana", undefined, tok.D);
    check("búsqueda en el servidor (nombre, sin distinguir mayúsculas)", r.data.total === 15 && r.data.datos.every((c) => c.nombre.startsWith("Ana")), r.data.total);
    r = await call("GET", "/api/clientes?pagina=1&q=55550007", undefined, tok.D);
    check("búsqueda por teléfono", r.data.total === 1 && r.data.datos[0].telefono === "55550007", r.data);
    r = await call("GET", "/api/clientes?pagina=1&q=%25", undefined, tok.D);
    check("los comodines de LIKE se buscan literalmente", r.data.total === 0, r.data.total);
    r = await call("GET", "/api/clientes?pagina=1", undefined, tok.C2);
    check("paginado respeta la sucursal (Norte ve solo sus 10)", r.data.total === 10, r.data.total);
    r = await call("GET", "/api/clientes?pagina=1&filtro=web", undefined, tok.D);
    check("filtro web: ninguna tiene cuenta web", r.data.total === 0, r.data.total);
    for (const [u, n] of [["pagina=0", "página 0"], ["pagina=abc", "página no numérica"], ["pagina=1&por_pagina=500", "más de 100 por página"], ["pagina=1&filtro=raro", "filtro desconocido"]]) {
      r = await call("GET", `/api/clientes?${u}`, undefined, tok.D);
      check(`${n} -> 400`, r.status === 400, r);
    }
    const idsCli = (await q(`SELECT id_cliente FROM "Cliente" ORDER BY id_cliente LIMIT 3`)).map((x) => x.id_cliente);
    for (let i = 0; i < 12; i++) await call("POST", "/api/pedidos", { id_cliente: idsCli[i % 3], id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.C1);
    r = await call("GET", "/api/pedidos?pagina=1&por_pagina=5", undefined, tok.D);
    check("pedidos paginados (5 por página, total 12)", r.data.datos.length === 5 && r.data.total === 12 && r.data.paginas === 3 && r.data.datos[0].origen === "MOSTRADOR", { ...r.data, datos: undefined });
    const unId = r.data.datos[2].id_pedido;
    r = await call("GET", `/api/pedidos?pagina=1&q=%23${unId}`, undefined, tok.D);
    check("buscar pedido por número (#id)", r.data.total === 1 && r.data.datos[0].id_pedido === unId, r.data);
    r = await call("GET", "/api/pedidos?pagina=1&q=luz0", undefined, tok.D);
    check("buscar pedido por nombre de la clienta", r.data.total === 4 && r.data.datos.every((p) => p.Cliente.nombre === "Luz0"), r.data.total);
    r = await call("GET", "/api/pedidos?pagina=1", undefined, tok.A2);
    check("ADMIN de Norte no ve en la página los pedidos de Centro", r.data.total === 0, r.data.total);
    r = await call("GET", "/api/pedidos", undefined, tok.D);
    check("pedidos sin ?pagina: arreglo", Array.isArray(r.data) && r.data.length === 12);
    r = await call("GET", "/api/devoluciones?pagina=1", undefined, tok.D);
    check("devoluciones paginadas (vacío)", r.status === 200 && r.data.total === 0 && Array.isArray(r.data.datos), r.data);

    console.log("\n== Límite de intentos en la base");
    for (let i = 0; i < 20; i++) await call("POST", "/api/auth/login", { email: "dist@t.com", password: "mala" }, undefined, { "X-Forwarded-For": "10.1.1.1" });
    r = await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" }, undefined, { "X-Forwarded-For": "10.1.1.1" });
    check("21.º intento desde la misma IP -> 429 con Retry-After", r.status === 429 && Number(r.headers.get("retry-after")) > 0, r);
    const filas = await q(`SELECT clave FROM "IntentoLimite"`);
    check("los contadores viven en la tabla IntentoLimite (sin la IP en claro)", filas.length >= 1 && filas.every((f) => /^[0-9a-f]{64}$/.test(f.clave) && !f.clave.includes("10.1.1.1")), filas);
    r = await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" }, undefined, { "X-Forwarded-For": "10.1.1.2" });
    check("otra IP no está bloqueada", r.status === 200, r.status);
    await detener(srv);
    srv = arrancar("monitoreo-2.log");
    await escuchando();
    r = await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" }, undefined, { "X-Forwarded-For": "10.1.1.1" });
    check("el bloqueo sobrevive a un reinicio del servidor", r.status === 429, r.status);
    await q(`UPDATE "IntentoLimite" SET desde = now() - interval '16 minutes'`);
    r = await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" }, undefined, { "X-Forwarded-For": "10.1.1.1" });
    check("pasada la ventana de 15 min vuelve a dejar entrar", r.status === 200, r.status);
    await q(`DROP TABLE "IntentoLimite"`);
    r = await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" }, undefined, { "X-Forwarded-For": "10.1.1.3" });
    check("si la tabla no responde, sigue funcionando (contador en memoria)", r.status === 200, r.status);
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("EXCEPCIÓN", e);
  } finally {
    await detener(srv);
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
