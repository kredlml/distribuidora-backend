// Prueba de scripts/preparar-demo.js contra una base vacía (Postgres desechable): crea lo necesario
// para la demostración y, corrido otra vez, no duplica nada.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18069;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-demo"),
};
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 600) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, p) => (await pg.query(sql, p)).rows;
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
const n = async (sql) => (await q(sql))[0].n;
const demo = (extra = []) => spawnSync(process.execPath, [path.join(B, "scripts", "preparar-demo.js"), "--api", `http://localhost:${PORT}`, ...extra],
  { cwd: B, env: { ...process.env, DEMO_EMAIL: "dist@t.com", DEMO_PASSWORD: "Clave1234" }, encoding: "utf8", timeout: 240000 });

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const out = fs.openSync(path.join(SALIDAS, "demo-servidor.log"), "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
  try {
    let listo = false;
    for (let i = 0; i < 160 && !listo; i++) { await sleep(500); try { listo = (await fetch(`http://localhost:${PORT}/api/salud`)).ok; } catch {} }
    check("servidor arriba", listo);
    await fetch(`http://localhost:${PORT}/api/auth/registro`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "Dina", apellido: "Distrital", email: "dist@t.com", password: "Clave1234" }) });

    let r = demo();
    fs.writeFileSync(path.join(SALIDAS, "demo-corrida-1.txt"), r.stdout + r.stderr);
    check("primera corrida termina bien", r.status === 0, r.stdout.slice(-800) + r.stderr);
    check("crea 3 sucursales en una base vacía", await n(`SELECT count(*)::int n FROM "Sucursal"`) === 3);
    check("crea el catálogo mínimo de ropa para dama (3 prendas con variantes)", await n(`SELECT count(*)::int n FROM "Producto" WHERE id_producto_padre IS NULL`) === 3 && await n(`SELECT count(*)::int n FROM "Producto"`) === 10);
    check("cada prenda tiene stock disponible en cada sucursal", await n(`SELECT count(*)::int n FROM "Producto" p CROSS JOIN "Sucursal" s WHERE (SELECT COALESCE(SUM(cantidad),0) FROM "Inventario" i WHERE i.id_producto=p.id_producto AND i.id_sucursal=s.id_sucursal AND i.estado='DISPONIBLE') < 5`) === 0);
    check("cuentas ADMIN, CAJERO y BODEGUERO de la demo", await n(`SELECT count(*)::int n FROM "Empleado" WHERE email LIKE '%@demo.distribuidora.gt' AND puesto IN ('ADMIN','CAJERO','BODEGUERO')`) === 3);
    const login = await fetch(`http://localhost:${PORT}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "caja@demo.distribuidora.gt", password: "Demo2026!" }) });
    check("la cajera demo puede iniciar sesión con la contraseña de la demo", login.status === 200);
    const tienda = await fetch(`http://localhost:${PORT}/api/tienda/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "clienta@demo.distribuidora.gt", password: "Demo2026!" }) });
    check("la clienta demo puede entrar a la tienda", tienda.status === 200);
    check("cupones DEMO10 y BIENVENIDA50", await n(`SELECT count(*)::int n FROM "Cupon" WHERE codigo IN ('DEMO10','BIENVENIDA50')`) === 2);
    const ventas = await q(`SELECT estado, count(*)::int n FROM "Pedido" GROUP BY estado`);
    const porEstado = Object.fromEntries(ventas.map((v) => [v.estado, v.n]));
    check("ventas de ejemplo pagadas en varios estados (para los reportes)", (porEstado.PROCESADO || 0) > 0 && (porEstado.ENVIADO || 0) > 0 && (porEstado.ENTREGADO || 0) > 1 && !porEstado.PENDIENTE, porEstado);
    check("ventas en todas las sucursales", await n(`SELECT count(DISTINCT id_sucursal)::int n FROM "Pedido"`) === 3);
    check("una venta con el cupón DEMO10", await n(`SELECT count(*)::int n FROM "Pedido" p JOIN "Cupon" c ON c.id_cupon=p.id_cupon WHERE c.codigo='DEMO10'`) >= 1);
    check("la clienta demo tiene un pedido ENTREGADO (para mostrar una devolución)", await n(`SELECT count(*)::int n FROM "Pedido" p JOIN "Cliente" c ON c.id_cliente=p.id_cliente WHERE c.email='clienta@demo.distribuidora.gt' AND p.estado='ENTREGADO' AND p.fecha_entrega IS NOT NULL`) === 1);
    check("la salida muestra las cuentas y no la contraseña del DISTRITAL", /caja@demo\.distribuidora\.gt/.test(r.stdout) && !r.stdout.includes("Clave1234"));

    const antes = await q(`SELECT (SELECT count(*) FROM "Pedido")::int p, (SELECT count(*) FROM "Empleado")::int e, (SELECT count(*) FROM "Cliente")::int c, (SELECT count(*) FROM "Producto")::int pr, (SELECT count(*) FROM "Inventario")::int i, (SELECT count(*) FROM "Cupon")::int cu`);
    r = demo();
    fs.writeFileSync(path.join(SALIDAS, "demo-corrida-2.txt"), r.stdout + r.stderr);
    const despues = await q(`SELECT (SELECT count(*) FROM "Pedido")::int p, (SELECT count(*) FROM "Empleado")::int e, (SELECT count(*) FROM "Cliente")::int c, (SELECT count(*) FROM "Producto")::int pr, (SELECT count(*) FROM "Inventario")::int i, (SELECT count(*) FROM "Cupon")::int cu`);
    const { i: _ia, ...sinStockA } = antes[0], { i: _id, ...sinStockD } = despues[0];
    check("segunda corrida: termina bien y no duplica cuentas, clientas, prendas, cupones ni ventas", r.status === 0 && JSON.stringify(sinStockA) === JSON.stringify(sinStockD), [antes, despues, r.stderr]);
    check("…y solo repone el stock que las ventas dejaron bajo el mínimo", await n(`SELECT count(*)::int n FROM "Producto" p CROSS JOIN "Sucursal" s WHERE (SELECT COALESCE(SUM(cantidad),0) FROM "Inventario" i WHERE i.id_producto=p.id_producto AND i.id_sucursal=s.id_sucursal AND i.estado='DISPONIBLE') < 15`) === 0);

    const t = (await (await fetch(`http://localhost:${PORT}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "dist@t.com", password: "Clave1234" }) })).json()).token;
    const rep = await (await fetch(`http://localhost:${PORT}/api/reportes/resumen`, { headers: { Authorization: `Bearer ${t}` } })).json();
    check("el reporte del día ya tiene ventas, sucursales y prendas", rep.kpis.ventas > 0 && rep.por_sucursal.filter((s) => s.ventas > 0).length === 3 && rep.por_prenda.length > 0, rep.kpis);

    r = demo([]);
    const malo = spawnSync(process.execPath, [path.join(B, "scripts", "preparar-demo.js"), "--api", `http://localhost:${PORT}`], { cwd: B, env: { ...process.env, DEMO_EMAIL: "caja@demo.distribuidora.gt", DEMO_PASSWORD: "Demo2026!" }, encoding: "utf8" });
    check("con una cuenta que no es DISTRITAL se niega", malo.status === 1 && /DISTRITAL/.test(malo.stderr), malo.stderr);
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("EXCEPCIÓN", e);
  } finally {
    srv.kill();
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
