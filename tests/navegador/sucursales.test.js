// Prueba de interfaz: distrital vs gerente de sucursal, reportes con PDF, alcance por sucursal y
// regla de devoluciones (una vez, 24 h) en panel y tienda. Puertos propios (nunca 8080/8081/8082).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");

const API = 18098, PANEL = 18199, TIENDA = 18299;
const SHOTS = path.join(SALIDAS, "capturas");
fs.mkdirSync(SHOTS, { recursive: true });
const ENV = {
  NODE_ENV: "development", PORT: String(API), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
  STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", CORS_ORIGIN: `http://localhost:${PANEL},http://localhost:${TIENDA}`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + String(i).slice(0, 400) : "")); } };
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
function proc(cmd, args, opts, log) { const out = fs.openSync(path.join(SALIDAS, log), "w"); return spawn(cmd, args, { ...opts, stdio: ["ignore", out, out], shell: process.platform === "win32" && cmd === "npx" }); }
async function esperarUrl(url) { for (let i = 0; i < 160; i++) { await sleep(500); try { const r = await fetch(url); if (r.status < 500) return true; } catch {} } return false; }
const api = async (method, url, body, token) => {
  const r = await fetch(`http://localhost:${API}${url}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};

(async () => {
  for (const p of [API, PANEL, TIENDA]) if (await ocupado(p)) { console.error("ABORTADO: puerto ocupado " + p); process.exit(1); }
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const procesos = [];
  let browser;
  try {
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-alcance-backend.log"));
    await esperarUrl(`http://localhost:${API}/`);
    for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Pedido' AND column_name='fecha_entrega'`))[0].n === 1 && (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1) break; } catch {} }
    await sleep(2500);
    // ---- Datos por API (como lo haría el distrital)
    await api("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dina@t.com", password: "Clave1234" });
    const tD = (await api("POST", "/api/auth/login", { email: "dina@t.com", password: "Clave1234" })).data.token;
    await api("POST", "/api/sucursales", { nombre: "Centro", direccion: "6a avenida", ciudad: "Guatemala" }, tD);
    await api("POST", "/api/sucursales", { nombre: "Norte", direccion: "Calzada", ciudad: "Mixco" }, tD);
    for (const [n, puesto, suc] of [["ana", "ADMIN", 1], ["carla", "CAJERO", 1], ["beto", "BODEGUERO", 1], ["nico", "ADMIN", 2], ["nadia", "CAJERO", 2]]) {
      await api("POST", "/api/auth/registro", { nombre: n[0].toUpperCase() + n.slice(1), apellido: "T", puesto, email: `${n}@t.com`, password: "Clave1234", id_sucursal: suc }, tD);
    }
    const t = async (n) => (await api("POST", "/api/auth/login", { email: `${n}@t.com`, password: "Clave1234" })).data.token;
    const tA = await t("ana"), tC = await t("carla"), tB = await t("beto"), tN = await t("nadia");
    await api("POST", "/api/categorias", { nombre: "Blusas" }, tD);
    await api("POST", "/api/categorias", { nombre: "Vestidos" }, tD);
    await api("POST", "/api/productos", { nombre: "Blusa de lino", precio_unitario: 175, id_categoria: 1, talla: "M", color: "Blanco" }, tD);
    await api("POST", "/api/productos", { nombre: "Blusa de lino", precio_unitario: 175, id_categoria: 1, talla: "S", color: "Blanco", id_producto_padre: 1 }, tD);
    await api("POST", "/api/productos", { nombre: "Vestido Floral", precio_unitario: 349, id_categoria: 2, talla: "M", color: "Rosa" }, tD);
    for (const [p, s, c] of [[1, 1, 20], [2, 1, 10], [3, 1, 6], [1, 2, 10], [3, 2, 2]]) await api("POST", "/api/inventario", { id_producto: p, id_sucursal: s, cantidad: c }, tD);
    const maria = (await api("POST", "/api/clientes", { nombre: "María", apellido: "López", email: "maria@correo.com" }, tC)).data.id_cliente;
    const nora = (await api("POST", "/api/clientes", { nombre: "Nora", apellido: "Norte" }, tN)).data.id_cliente;
    const vender = async (tok, cliente, detalles, metodo = "EFECTIVO") => {
      const p = (await api("POST", "/api/pedidos", { id_cliente: cliente, detalles }, tok)).data.pedido;
      await api("POST", "/api/pagos", { id_pedido: p.id_pedido, metodo_pago: metodo, monto: Number(p.total) }, tok);
      return p.id_pedido;
    };
    const pc1 = await vender(tC, maria, [{ id_producto: 1, cantidad: 2 }, { id_producto: 3, cantidad: 1 }]);
    await vender(tC, maria, [{ id_producto: 2, cantidad: 1 }], "TARJETA");
    await vender(tN, nora, [{ id_producto: 3, cantidad: 1 }]);
    await api("PUT", `/api/pedidos/${pc1}/estado`, { estado: "ENVIADO" }, tB);
    await api("PUT", `/api/pedidos/${pc1}/estado`, { estado: "ENTREGADO" }, tB);
    // Pedido entregado hace más de 24 h (plazo vencido)
    const pv = await vender(tC, maria, [{ id_producto: 1, cantidad: 1 }]);
    await api("PUT", `/api/pedidos/${pv}/estado`, { estado: "ENVIADO" }, tB);
    await api("PUT", `/api/pedidos/${pv}/estado`, { estado: "ENTREGADO" }, tB);
    await q(`UPDATE "Pedido" SET fecha_entrega = NOW() - interval '30 hours' WHERE id_pedido=$1`, [pv]);

    procesos.push(proc("npx", ["vite", "--port", String(PANEL), "--strictPort"], { cwd: path.join(B, "frontend"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}` } }, "ui-alcance-vite.log"));
    procesos.push(proc("npx", ["vite", "--port", String(TIENDA), "--strictPort"], { cwd: path.join(B, "tienda"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}`, VITE_STRIPE_PUBLISHABLE_KEY: "" } }, "ui-alcance-tienda.log"));
    check("vite del panel y de la tienda arrancan", (await esperarUrl(`http://localhost:${PANEL}/`)) && (await esperarUrl(`http://localhost:${TIENDA}/`)));

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const errores = [];
    const nuevo = async (vp = { width: 1280, height: 900 }) => {
      const ctx = await browser.newContext({ viewport: vp, locale: "es-GT", acceptDownloads: true });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errores.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push(m.text()); });
      return page;
    };
    const entrar = async (page, email) => {
      await page.goto(`http://localhost:${PANEL}/login`);
      await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', "Clave1234");
      await page.click('button:has-text("Iniciar sesión")'); await page.waitForSelector("#rail", { timeout: 15000 });
    };
    const rail = (p, n) => p.locator(`#rail a[aria-label="${n}"]`).count();
    const bajarPdf = async (page) => {
      const [descarga] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click('button:has-text("Descargar PDF")')]);
      const destino = path.join(SHOTS, descarga.suggestedFilename());
      await descarga.saveAs(destino);
      const buf = fs.readFileSync(destino);
      return { nombre: descarga.suggestedFilename(), pdf: buf.slice(0, 5).toString() === "%PDF-", tam: buf.length, texto: buf.toString("latin1") };
    };

    // ============ DISTRITAL
    const d = await nuevo();
    await entrar(d, "dina@t.com");
    check("distrital: ve Reportes, Empleados, Sucursales y Catálogo", (await rail(d, "Reportes de ventas")) + (await rail(d, "Empleados")) + (await rail(d, "Sucursales")) + (await rail(d, "Catálogo y stock")) === 4);
    await d.click('#rail a[aria-label="Reportes de ventas"]');
    await d.waitForSelector(".kpi");
    check("reporte de hoy: ventas de todas las sucursales", /Ventas del periodo/.test(await d.textContent(".kpis")) && (await d.locator('h2:has-text("Ventas por sucursal")').count()) === 1);
    const filasSuc = await d.locator(".card:has(h2:has-text('Ventas por sucursal')) .fila-rep").count();
    check("ventas por sucursal: Centro y Norte", filasSuc === 2, filasSuc);
    check("prendas más vendidas: la Blusa de lino arriba", /Blusa de lino/.test(await d.locator(".card:has(h2:has-text('Prendas más vendidas')) .fila-rep").first().textContent()));
    await d.screenshot({ path: path.join(SHOTS, "reportes-distrital.png"), fullPage: true });
    let pdf = await bajarPdf(d);
    check("distrital descarga el PDF (archivo PDF válido con datos)", pdf.pdf && pdf.tam > 3000 && /reporte-ventas-\d{4}-\d{2}-\d{2}\.pdf/.test(pdf.nombre), [pdf.nombre, pdf.tam]);
    await d.locator('select[aria-label="Sucursal"]').selectOption({ label: "Norte" });
    await d.waitForFunction(() => !document.querySelector(".recargando") && !document.body.textContent.includes("Ventas por sucursal"));
    check("filtro por sucursal Norte (sin desglose por sucursal)", /Q\s?349[.,]00/.test(await d.textContent(".kpi.destacado")), await d.textContent(".kpi.destacado"));
    await d.click('button.chip:has-text("Personalizado")');
    check("periodo personalizado muestra fechas", await d.locator('input[type="date"]').count() === 2);
    await d.click('#rail a[aria-label="Catálogo y stock"]');
    await d.waitForSelector('h1:has-text("Catálogo y stock")');
    await d.waitForSelector('h2:has-text("Nueva prenda")', { timeout: 8000 }).catch(() => {});
    check("distrital: catálogo editable (Nueva prenda)", await d.locator('h2:has-text("Nueva prenda")').count() === 1);

    // ============ ADMIN de sucursal (Centro)
    const a = await nuevo();
    await entrar(a, "ana@t.com");
    check("ADMIN de sucursal ve Reportes y Empleados", (await rail(a, "Reportes de ventas")) === 1 && (await rail(a, "Empleados")) === 1);
    await a.click('#rail a[aria-label="Reportes de ventas"]');
    await a.waitForSelector(".kpi");
    check("ADMIN: reporte solo de Centro, sin selector ni desglose por sucursal", /tu sucursal \(Centro\)/.test(await a.textContent(".head")) && (await a.locator('select[aria-label="Sucursal"]').count()) === 0 && (await a.locator('h2:has-text("Ventas por sucursal")').count()) === 0);
    const ventasCentro = (await q(`SELECT SUM(total) s FROM "Pedido" WHERE id_sucursal=1 AND estado IN ('PROCESADO','ENVIADO','ENTREGADO')`))[0].s;
    check("ventas de Centro cuadran con la base", (await a.textContent(".kpi.destacado")).replace(/[^\d.]/g, "").includes(Number(ventasCentro).toFixed(2)), [await a.textContent(".kpi.destacado"), ventasCentro]);
    pdf = await bajarPdf(a);
    check("ADMIN descarga el PDF de su sucursal", pdf.pdf && pdf.tam > 3000, pdf.tam);
    await a.screenshot({ path: path.join(SHOTS, "reportes-admin.png"), fullPage: true });
    await a.click('#rail a[aria-label="Catálogo y stock"]');
    await a.waitForSelector('h2:has-text("Ingresar stock")');
    check("ADMIN: catálogo de solo lectura, stock fijo a su sucursal", (await a.locator('h2:has-text("Nueva prenda")').count()) === 0 && /Sucursal: Centro/.test(await a.textContent("form")) && /administra el gerente distrital/.test(await a.textContent(".head")));
    await a.click('button.chip:has-text("Prendas")');
    check("ADMIN: lista de prendas sin Editar/Eliminar", (await a.locator('.item button:has-text("Editar")').count()) === 0 && (await a.locator(".item").count()) === 3);
    await a.click('#rail a[aria-label="Sucursales"]');
    await a.waitForSelector('h2:has-text("Stock de Centro")');
    check("ADMIN: «Mi sucursal» con su stock y sin Norte", /Mi sucursal/.test(await a.textContent("h1")) && !(await a.textContent("main")).includes("Norte") && (await a.locator('button:has-text("Nueva sucursal")').count()) === 0);
    await a.click('#rail a[aria-label="Empleados"]');
    await a.waitForSelector('h1:has-text("Empleados")');
    await a.waitForSelector('section.card h2:has-text("empleado")');
    const emps = await a.locator("section.card .item").allTextContents();
    check("ADMIN: solo empleados de Centro", emps.length === 3 && emps.every((e) => /Centro/.test(e)), emps);
    check("ADMIN: no puede editar a otro administrador ni al distrital (no aparece)", !(await a.textContent("main")).includes("Dina"));
    await a.click('button:has-text("Nuevo empleado")');
    const opciones = await a.locator('dialog[open] select[name="puesto"] option').allTextContents();
    check("ADMIN: solo puede dar de alta Cajero o Bodeguero", opciones.filter(Boolean).join("|") === "Elige el puesto|Cajero|Bodeguero" && (await a.locator('dialog[open] select[name="id_sucursal"]').count()) === 0, opciones);
    await a.locator('dialog[open] input[name="nombre"]').fill("Celia");
    await a.locator('dialog[open] input[name="email"]').fill("celia@t.com");
    await a.locator('dialog[open] select[name="puesto"]').selectOption("CAJERO");
    await a.locator('dialog[open] input[name="password"]').fill("Clave1234");
    await a.locator('dialog[open] input[name="password2"]').fill("Clave1234");
    await a.locator('dialog[open] button:has-text("Registrar empleado")').click();
    await a.waitForSelector('.item:has-text("Celia")');
    check("ADMIN registra una cajera: queda en Centro", (await q(`SELECT id_sucursal FROM "Empleado" WHERE email='celia@t.com'`))[0].id_sucursal === 1);
    await a.click('#rail a[aria-label="Pedidos"]');
    await a.waitForSelector("a.fila-pedido");
    check("ADMIN: pedidos solo de Centro y sin filtro de sucursal", (await a.locator("a.fila-pedido").count()) === 3 && (await a.locator('select[aria-label="Sucursal"]').count()) === 0);

    // Plazo vencido en Nueva solicitud del panel
    await a.goto(`http://localhost:${PANEL}/nueva`);
    await a.locator("select").first().selectOption({ label: "María López" });
    await a.waitForFunction(() => document.querySelectorAll("select")[1] && !document.querySelectorAll("select")[1].disabled);
    await a.locator("select").nth(1).selectOption({ index: 1 });
    const opcionesPed = await a.locator("select").nth(1).locator("option").allTextContents();
    const vencido = opcionesPed.findIndex((o) => o.includes(`Pedido ${pv}`));
    await a.locator("select").nth(1).selectOption({ index: vencido });
    await a.waitForFunction(() => /ya venció/.test(document.querySelector("form")?.textContent || ""));
    check("Nueva solicitud: pedido con plazo vencido lo explica y no deja registrar", await a.locator('button:has-text("Registrar solicitud")').isDisabled());
    const vigente = opcionesPed.findIndex((o) => o.includes(`Pedido ${pc1}`));
    await a.locator("select").nth(1).selectOption({ index: vigente });
    await a.waitForFunction(() => /Una sola solicitud por pedido/.test(document.querySelector("form")?.textContent || ""));
    check("Nueva solicitud: pedido vigente muestra el plazo", true);

    // ============ CAJERO: clienta de otra sucursal por correo
    const c = await nuevo();
    await entrar(c, "nadia@t.com");
    await c.goto(`http://localhost:${PANEL}/pedidos/nueva`);
    await c.waitForSelector('h1:has-text("Nueva venta")');
    check("cajera de Norte: su sucursal fija", /Sucursal: Norte/.test(await c.textContent("main")));
    const opcionesCli = await c.locator("select").first().locator("option").allTextContents();
    check("no ve a la clienta de Centro en su lista", !opcionesCli.some((o) => o.includes("María")), opcionesCli);
    await c.fill('input[aria-label="Correo de una clienta de otra sucursal"]', "MARIA@correo.com");
    await c.click('.otra-sucursal button:has-text("Buscar")');
    await c.waitForFunction(() => document.querySelector("select")?.selectedOptions[0]?.textContent.includes("María"));
    check("la encuentra por correo y queda seleccionada", true);

    // ============ TIENDA: regla de una solicitud y 24 h
    const tiendaCli = (await api("POST", "/api/tienda/auth/registro", { nombre: "Lucía", apellido: "Web", email: "lucia@x.com", password: "Clave1234" })).data.token;
    const pt = (await api("POST", "/api/tienda/pedidos", { id_sucursal: 1, direccion_entrega: "Zona 10", detalles: [{ id_producto: 1, cantidad: 1 }] }, tiendaCli)).data.pedido.id_pedido;
    await api("POST", `/api/tienda/pedidos/${pt}/pago`, {}, tiendaCli);
    await api("PUT", `/api/pedidos/${pt}/estado`, { estado: "ENVIADO" }, tB);
    await api("PUT", `/api/pedidos/${pt}/estado`, { estado: "ENTREGADO" }, tB);
    const ti = await nuevo();
    await ti.goto(`http://localhost:${TIENDA}/login`);
    await ti.fill('input[name="email"]', "lucia@x.com"); await ti.fill('input[name="password"]', "Clave1234");
    await ti.click('button:has-text("Iniciar sesión")');
    await ti.waitForURL((u) => !/login/.test(u.pathname));
    await ti.goto(`http://localhost:${TIENDA}/pedidos/${pt}`);
    await ti.waitForSelector('a:has-text("Solicitar cambio o devolución")');
    check("tienda: muestra el plazo y que es una sola solicitud", /una sola solicitud/.test(await ti.textContent("main")) && /24 horas desde la entrega/.test(await ti.textContent("main")));
    await ti.screenshot({ path: path.join(SHOTS, "tienda-plazo-devolucion.png") });
    await ti.click('a:has-text("Solicitar cambio o devolución")');
    await ti.waitForSelector('h1:has-text("Cambio o devolución")');
    check("tienda: el formulario avisa que es una sola solicitud", /Solo puedes enviar una solicitud por pedido/.test(await ti.textContent("main")));
    await ti.click('label.chk:has-text("Devolución")').catch(() => {});
    await ti.locator('input[type="radio"][value="DEVOLUCION"]').check();
    await ti.locator(".linea-dev input[type=checkbox]").first().check();
    await ti.click('button:has-text("Enviar solicitud")');
    await ti.waitForURL(/devoluciones\/\d+/);
    await ti.goto(`http://localhost:${TIENDA}/pedidos/${pt}`);
    await ti.waitForSelector('h2:has-text("Tu solicitud de cambio o devolución")');
    check("tienda: tras solicitar ya no ofrece otra", await ti.locator('a:has-text("Solicitar cambio o devolución")').count() === 0);
    await ti.goto(`http://localhost:${TIENDA}/pedidos/${pt}/devolucion`);
    await ti.waitForFunction(() => /solo se permite una/.test(document.body.textContent));
    check("tienda: entrar directo al formulario muestra que ya se usó", true);
    // Pedido con plazo vencido en la tienda
    await q(`UPDATE "Pedido" SET fecha_entrega = NOW() - interval '25 hours' WHERE id_pedido=$1`, [pt]);
    await q(`DELETE FROM "DetalleDevolucion"; DELETE FROM "MovimientoInventario" WHERE id_devolucion IS NOT NULL; DELETE FROM "Devolucion"`);
    await ti.goto(`http://localhost:${TIENDA}/pedidos/${pt}`);
    await ti.waitForFunction(() => /ya venció/.test(document.body.textContent));
    check("tienda: con el plazo vencido lo dice y no ofrece el botón", await ti.locator('a:has-text("Solicitar cambio o devolución")').count() === 0);

    // ============ Móvil
    const m = await nuevo({ width: 390, height: 844 });
    await entrar(m, "dina@t.com");
    for (const ruta of ["/reportes", "/empleados", "/catalogo"]) {
      await m.goto(`http://localhost:${PANEL}${ruta}`);
      await m.waitForSelector("h1");
      await sleep(800);
      const desborde = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`móvil ${ruta}: sin scroll horizontal`, desborde <= 1, desborde);
    }
    await m.goto(`http://localhost:${PANEL}/reportes`); await m.waitForSelector(".kpi");
    await m.screenshot({ path: path.join(SHOTS, "reportes-movil.png"), fullPage: true });

    check("sin errores de JavaScript en consola", errores.length === 0, errores.join(" | "));
  } catch (e) {
    console.error(e); fails.push("excepción: " + e.message);
  } finally {
    if (browser) await browser.close();
    procesos.forEach((p) => { try { spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"]); } catch {} });
    await pg.end(); await sleep(1500);
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
