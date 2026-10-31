// Prueba de interfaz de los comprobantes de entrada y salida: ingreso de mercadería con varias
// prendas y proveedor (abre el comprobante y descarga el PDF), baja de stock con su comprobante,
// comprobante de la venta en el detalle del pedido y la página Comprobantes (filtros, búsqueda,
// alcance por sucursal y vista en teléfono). Puertos propios (nunca 8080/8081/8082).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");

const API = 18067, PANEL = 18167;
const SHOTS = path.join(SALIDAS, "capturas");
fs.mkdirSync(SHOTS, { recursive: true });
const ENV = {
  NODE_ENV: "development", PORT: String(API), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
  STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", CORS_ORIGIN: `http://localhost:${PANEL}`,
  CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-ui-comprobantes"),
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
const texto = async (page, sel) => (await page.locator(sel).first().textContent()) || "";

(async () => {
  for (const p of [API, PANEL]) if (await ocupado(p)) { console.error("ABORTADO: puerto ocupado " + p); process.exit(1); }
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const procesos = [];
  let browser;
  try {
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-comprobantes-backend.log"));
    check("backend arriba", await esperarUrl(`http://localhost:${API}/`));
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','6a avenida','Guatemala',true),('Norte','Calzada','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria) VALUES ('Blusa Lino',120,1,true,'M','Blanco',1),('Falda Plisada',180,1,true,'S','Negro',1)`);
    await api("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dina@t.com", password: "Clave1234" });
    const tokD = (await api("POST", "/api/auth/login", { email: "dina@t.com", password: "Clave1234" })).data.token;
    for (const [nombre, puesto, email, suc] of [["Bea", "BODEGUERO", "bea@t.com", 1], ["Carla", "CAJERO", "carla@t.com", 1], ["Nico", "BODEGUERO", "nico@t.com", 2]]) {
      await api("POST", "/api/auth/registro", { nombre, apellido: "Prueba", puesto, email, password: "Clave1234", id_sucursal: suc }, tokD);
    }
    const tokC = (await api("POST", "/api/auth/login", { email: "carla@t.com", password: "Clave1234" })).data.token;
    await api("POST", "/api/proveedores", { nombre_empresa: "Textiles Maya", telefono: "22223333" }, tokD);
    await api("POST", "/api/proveedores", { nombre_empresa: "Proveedor Inactivo", activo: false }, tokD);
    await q(`UPDATE "Proveedor" SET activo=false WHERE nombre_empresa='Proveedor Inactivo'`);

    procesos.push(proc("npx", ["vite", "--port", String(PANEL), "--strictPort"], { cwd: path.join(B, "frontend"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}` } }, "ui-comprobantes-vite.log"));
    check("vite del panel arranca", await esperarUrl(`http://localhost:${PANEL}/`));

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const errores = [];
    const nuevo = async (viewport = { width: 1280, height: 900 }) => {
      const ctx = await browser.newContext({ viewport, locale: "es-GT", acceptDownloads: true });
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
    const toast = async (page, re) => { try { await page.waitForFunction((src) => { const t = document.querySelector("#toast.show"); return t && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 }); return true; } catch { return false; } };
    const dlg = (page) => page.locator("dialog[open]");
    const bajarPdf = async (page) => {
      const [descarga] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), dlg(page).locator('button:has-text("Descargar PDF")').click()]);
      const destino = path.join(SHOTS, descarga.suggestedFilename());
      await descarga.saveAs(destino);
      const buf = fs.readFileSync(destino);
      return { nombre: descarga.suggestedFilename(), pdf: buf.slice(0, 5).toString() === "%PDF-", tam: buf.length, texto: buf.toString("latin1") };
    };

    console.log("\n== Ingreso de mercadería (bodega de Centro)");
    const b = await nuevo();
    await entrar(b, "bea@t.com");
    check("todos ven Comprobantes en el menú", (await b.locator('#rail a[aria-label="Comprobantes"]').count()) === 1);
    await b.click('#rail a[aria-label="Catálogo y stock"]');
    await b.waitForSelector('h2:has-text("Ingresar stock")');
    check("el proveedor inactivo no se ofrece", (await b.locator('select[name="id_proveedor"] option', { hasText: "Inactivo" }).count()) === 0);
    check("la factura del proveedor se habilita solo al elegir proveedor", await b.locator('input[name="documento_proveedor"]').isDisabled());
    await b.selectOption('select[name="id_proveedor"]', { label: "Textiles Maya" });
    await b.fill('input[name="documento_proveedor"]', "FAC-A-1001");
    await b.selectOption('select[aria-label="Prenda de la línea 1"]', { index: 1 });
    await b.fill('input[aria-label="Cantidad de la línea 1"]', "10");
    await b.fill('input[aria-label="Lote de la línea 1"]', "L-01");
    await b.fill('input[aria-label="Costo unitario de la línea 1"]', "50");
    await b.click('button:has-text("Agregar otra prenda")');
    await b.selectOption('select[aria-label="Prenda de la línea 2"]', { index: 2 });
    await b.fill('input[aria-label="Cantidad de la línea 2"]', "5");
    await b.selectOption('select[aria-label="Estado de la línea 2"]', "DANADA");
    await b.fill('input[aria-label="Costo unitario de la línea 2"]', "20");
    const resumen = await b.locator('form p.sm:has-text("Ingresan")').textContent();
    check("resumen en vivo: 15 unidades, 2 líneas, valor 10×50 + 5×20 = Q600", /15\s*unidades en 2 líneas, valor\s*Q\s*600/.test(resumen), resumen);
    await b.click('button:has-text("Agregar otra prenda")');
    await b.click('button[aria-label="Quitar la línea 3"]');
    check("se puede quitar una línea", (await b.locator(".linea-ingreso").count()) === 2);
    await b.screenshot({ path: path.join(SHOTS, "ingreso-mercaderia.png"), fullPage: true });
    await b.click('button:has-text("Registrar ingreso")');
    check("aviso con el folio CE-000001", await toast(b, /CE-000001/));
    await dlg(b).locator(".folio").waitFor();
    const dlgTexto = await dlg(b).textContent();
    check("se abre el comprobante: folio, proveedor, factura, 2 prendas y total", /CE-000001/.test(dlgTexto) && /Textiles Maya/.test(dlgTexto) && /FAC-A-1001/.test(dlgTexto) && (await dlg(b).locator("tbody tr").count()) === 2 && /Total\s*15/.test(await dlg(b).locator("tfoot").textContent()), dlgTexto);
    await b.screenshot({ path: path.join(SHOTS, "comprobante-entrada.png") });
    let pdf = await bajarPdf(b);
    check("descarga CE-000001.pdf con el tipo, el folio y el proveedor", pdf.pdf && pdf.nombre === "CE-000001.pdf" && /COMPROBANTE DE ENTRADA/.test(pdf.texto) && /CE-000001/.test(pdf.texto) && /Textiles Maya/.test(pdf.texto) && pdf.tam > 3000, [pdf.nombre, pdf.tam]);
    await dlg(b).locator('button:has-text("Cerrar")').click();
    check("el formulario queda listo para otro ingreso", (await b.locator(".linea-ingreso").count()) === 1 && (await b.inputValue('input[aria-label="Cantidad de la línea 1"]')) === "");
    const inv = await q(`SELECT id_producto, cantidad, estado, lote FROM "Inventario" ORDER BY id_inventario`);
    check("el inventario de Centro recibió las 2 filas", inv.length === 2 && inv[0].cantidad === 10 && inv[0].lote === "L-01" && inv[1].estado === "DANADA", JSON.stringify(inv));

    console.log("\n== Baja de stock con su comprobante");
    await b.click('#rail a[aria-label="Sucursales"]');
    await b.waitForSelector('h2:has-text("Stock de Centro")');
    await b.locator("label.fila-stock", { hasText: "Dañada" }).locator("input").check();
    await b.click('button:has-text("Dar de baja o ajustar")');
    await dlg(b).locator("select").selectOption("DESCARTE");
    await dlg(b).locator('button:has-text("Confirmar baja")').click();
    check("aviso de la baja con su folio CS-000001", await toast(b, /CS-000001/));
    await b.waitForSelector(".aviso-comprobante");
    check("aviso en la página con enlace al comprobante", /CS-000001/.test(await texto(b, ".aviso-comprobante")));
    await b.click('.aviso-comprobante button:has-text("Ver o descargar")');
    await dlg(b).locator(".folio").waitFor();
    check("el comprobante de la baja: concepto y motivo", /Baja de stock/.test(await dlg(b).textContent()) && /Descarte/.test(await dlg(b).textContent()));
    pdf = await bajarPdf(b);
    check("PDF de la salida", pdf.pdf && pdf.nombre === "CS-000001.pdf" && /COMPROBANTE DE SALIDA/.test(pdf.texto), pdf.nombre);
    await dlg(b).locator('button:has-text("Cerrar")').click();

    console.log("\n== Venta pagada: comprobante en el detalle del pedido");
    const maria = (await api("POST", "/api/clientes", { nombre: "María", apellido: "López", email: "maria@x.com" }, tokC)).data;
    const pedido = (await api("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 2 }] }, tokC)).data.pedido;
    const c = await nuevo();
    await entrar(c, "carla@t.com");
    await c.goto(`http://localhost:${PANEL}/pedidos/${pedido.id_pedido}`);
    await c.waitForSelector('h2:has-text("Prendas")');
    check("pedido pendiente: sin comprobantes todavía", (await c.locator('h2:has-text("Comprobantes de mercadería")').count()) === 0);
    await api("POST", "/api/pagos", { id_pedido: pedido.id_pedido, metodo_pago: "EFECTIVO", monto: 240 }, tokC);
    await c.reload();
    await c.waitForSelector('h2:has-text("Comprobantes de mercadería")');
    check("pagado: aparece la salida CS-000002 por la venta", /CS-000002[\s\S]*Venta/.test(await texto(c, 'section:has(h2:has-text("Comprobantes de mercadería"))')));
    await c.click('.fila-comprobante:has-text("CS-000002")');
    await dlg(c).locator(".folio").waitFor();
    check("el comprobante de la venta lleva cliente y precio", /María López/.test(await dlg(c).textContent()) && /240/.test(await dlg(c).locator("tfoot").textContent()));
    await dlg(c).locator('button:has-text("Cerrar")').click();

    console.log("\n== Página Comprobantes (DISTRITAL)");
    await api("POST", "/api/inventario/ingresos", { id_sucursal: 2, lineas: [{ id_producto: 2, cantidad: 3 }] }, (await api("POST", "/api/auth/login", { email: "nico@t.com", password: "Clave1234" })).data.token);
    const d = await nuevo();
    await entrar(d, "dina@t.com");
    await d.click('#rail a[aria-label="Comprobantes"]');
    await d.waitForSelector('h2:has-text("4 comprobantes")');
    check("lista los 4 de ambas sucursales, el más reciente primero", (await d.locator(".fila-comprobante").count()) === 4 && /CE-000002/.test(await texto(d, ".fila-comprobante")), await texto(d, ".fila-comprobante"));
    await d.click('button.chip:has-text("Entradas")');
    await d.waitForSelector('h2:has-text("2 comprobantes")');
    check("filtro Entradas", (await d.locator(".fila-comprobante").count()) === 2);
    await d.selectOption('select[aria-label="Sucursal"]', { label: "Norte" });
    await d.waitForSelector('h2:has-text("1 comprobante")');
    check("filtro por sucursal (Norte)", /Norte/.test(await texto(d, ".fila-comprobante")));
    await d.goto(`http://localhost:${PANEL}/comprobantes`);
    await d.fill('input[aria-label="Buscar"]', "textiles");
    await d.waitForSelector('h2:has-text("1 comprobante")');
    check("búsqueda por proveedor", /CE-000001/.test(await texto(d, ".fila-comprobante")));
    await d.fill('input[aria-label="Buscar"]', "cs-2");
    await d.waitForFunction(() => /CS-000002/.test(document.querySelector(".fila-comprobante")?.textContent || "") && document.querySelectorAll(".fila-comprobante").length === 1);
    check("búsqueda por folio corto (cs-2)", true);
    await d.click(".fila-comprobante");
    await dlg(d).locator(".folio").waitFor();
    check("abrir un comprobante deja su id en la URL (se puede compartir)", /ver=\d+/.test(d.url()));
    await d.reload();
    await dlg(d).locator(".folio").waitFor();
    check("…y al recargar se vuelve a abrir", /CS-000002/.test(await dlg(d).textContent()));
    await dlg(d).locator('button:has-text("Cerrar")').click();
    check("cerrar lo quita de la URL", !/ver=/.test(d.url()));
    await d.screenshot({ path: path.join(SHOTS, "comprobantes.png"), fullPage: true });

    console.log("\n== Alcance por sucursal y teléfono");
    const n = await nuevo({ width: 390, height: 800 });
    await entrar(n, "nico@t.com");
    await n.goto(`http://localhost:${PANEL}/comprobantes`);
    await n.waitForSelector('h2:has-text("1 comprobante")');
    check("la bodega de Norte solo ve su comprobante y no tiene filtro de sucursal", (await n.locator('select[aria-label="Sucursal"]').count()) === 0 && /Norte/.test(await texto(n, ".fila-comprobante")));
    check("en teléfono la página no se desborda", !(await n.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    await n.click(".fila-comprobante");
    await dlg(n).locator(".folio").waitFor();
    check("en teléfono el diálogo cabe en la pantalla", await n.evaluate(() => { const r = document.querySelector("dialog[open]").getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }));
    await n.screenshot({ path: path.join(SHOTS, "comprobante-telefono.png") });
    await dlg(n).locator('button:has-text("Cerrar")').click();
    // Un enlace a un comprobante de otra sucursal: error claro y el diálogo se puede cerrar.
    const ajeno = (await q(`SELECT id_comprobante FROM "Comprobante" WHERE id_sucursal=1 LIMIT 1`))[0].id_comprobante;
    await n.goto(`http://localhost:${PANEL}/comprobantes?ver=${ajeno}`);
    await dlg(n).locator(".err, [role=alert], .card").first().waitFor();
    await n.waitForFunction(() => /No se encontró/.test(document.querySelector("dialog[open]")?.textContent || ""));
    check("comprobante de otra sucursal: «No se encontró» dentro del diálogo", true);
    await dlg(n).locator('button:has-text("Cerrar")').click();
    const cerrado = await n.waitForFunction(() => !document.querySelector("dialog[open]") && !/ver=/.test(location.search), null, { timeout: 5000 }).then(() => true, () => false);
    check("…y se puede cerrar aunque no cargó", cerrado, n.url());
    await n.goto(`http://localhost:${PANEL}/comprobantes`);
    await n.waitForSelector(".fila-comprobante");
    await n.click(".fila-comprobante");
    await dlg(n).locator(".folio").waitFor();
    await dlg(n).locator('button:has-text("Cerrar")').click();
    await n.goBack();
    await sleep(400);
    check("tras cerrar un comprobante, Atrás no lo vuelve a abrir", (await n.locator("dialog[open]").count()) === 0, n.url());
    check("sin errores de JavaScript en la consola", errores.length === 0, errores.join(" | "));
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("ERROR EN PRUEBA:", e);
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const p of procesos) { try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"]) : p.kill(); } catch {} }
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log("Fallos:\n" + fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
