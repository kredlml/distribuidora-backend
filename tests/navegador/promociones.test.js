// Prueba de interfaz de las mejoras finales: Promociones (cupones), checkout de la tienda con cupón
// y retiro en sucursal, desglose con IVA, venta de mostrador con cupón, Estado del sistema y
// paginación de clientes. Puertos propios (nunca 8080/8081/8082).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");

const API = 18071, PANEL = 18171, TIENDA = 18271;
const SHOTS = path.join(SALIDAS, "capturas");
fs.mkdirSync(SHOTS, { recursive: true });
const ENV = {
  NODE_ENV: "development", PORT: String(API), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
  STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", CORS_ORIGIN: `http://localhost:${PANEL},http://localhost:${TIENDA}`,
  CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-ui-promociones"), ENVIO_COSTO: "25", ENVIO_GRATIS_DESDE: "300",
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
  for (const p of [API, PANEL, TIENDA]) if (await ocupado(p)) { console.error("ABORTADO: puerto ocupado " + p); process.exit(1); }
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const procesos = [];
  let browser;
  try {
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-promo-backend.log"));
    check("backend arriba", await esperarUrl(`http://localhost:${API}/`));
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','6a avenida','Guatemala',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria) VALUES ('Blusa Lino',100,1,true,'M','Blanco',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (50,1,1,'L1','DISPONIBLE')`);
    await api("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dina@t.com", password: "Clave1234" });
    const tokD = (await api("POST", "/api/auth/login", { email: "dina@t.com", password: "Clave1234" })).data.token;
    await api("POST", "/api/auth/registro", { nombre: "Carla", apellido: "Caja", puesto: "CAJERO", email: "carla@t.com", password: "Clave1234", id_sucursal: 1 }, tokD);
    for (let i = 0; i < 27; i++) await api("POST", "/api/clientes", { nombre: `Clienta${String(i).padStart(2, "0")}`, apellido: "Prueba", email: `p${i}@x.com` }, tokD);

    procesos.push(proc("npx", ["vite", "--port", String(PANEL), "--strictPort"], { cwd: path.join(B, "frontend"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}` } }, "ui-promo-vite.log"));
    procesos.push(proc("npx", ["vite", "--port", String(TIENDA), "--strictPort"], { cwd: path.join(B, "tienda"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}`, VITE_STRIPE_PUBLISHABLE_KEY: "" } }, "ui-promo-tienda.log"));
    check("vite del panel y de la tienda arrancan", (await esperarUrl(`http://localhost:${PANEL}/`)) && (await esperarUrl(`http://localhost:${TIENDA}/`)));

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const errores = [];
    const nuevo = async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-GT" });
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

    console.log("\n== Promociones (DISTRITAL)");
    const d = await nuevo();
    await entrar(d, "dina@t.com");
    check("el DISTRITAL ve Promociones y Estado del sistema en el menú", (await d.locator('#rail a[aria-label="Promociones"]').count()) === 1 && (await d.locator('#rail a[aria-label="Estado del sistema"]').count()) === 1);
    await d.click('#rail a[aria-label="Promociones"]');
    await d.waitForSelector('h1:has-text("Promociones")');
    await d.click('button:has-text("Nuevo cupón")');
    await dlg(d).locator('input[name="codigo"]').fill("bienvenida");
    await dlg(d).locator('input[name="descripcion"]').fill("10% de bienvenida");
    await dlg(d).locator('input[name="valor"]').fill("10");
    await dlg(d).locator('button:has-text("Guardar")').click();
    check("crear cupón desde el panel", await toast(d, /creado/));
    await d.waitForSelector('.item:has-text("BIENVENIDA")');
    check("aparece en mayúsculas, activo, con su valor", /BIENVENIDA[\s\S]*10%[\s\S]*Activo/.test(await texto(d, '.item:has-text("BIENVENIDA")')));
    await d.screenshot({ path: path.join(SHOTS, "promociones.png") });

    console.log("\n== Estado del sistema");
    await d.click('#rail a[aria-label="Estado del sistema"]');
    await d.waitForSelector('h1:has-text("Estado del sistema")');
    const sistema = await texto(d, "main");
    check("muestra base, migraciones y servicios", /Responde/.test(sistema) && /Migraciones aplicadas/.test(sistema) && /Guardados en archivos/.test(sistema), sistema.slice(0, 300));
    await d.screenshot({ path: path.join(SHOTS, "sistema.png") });

    console.log("\n== Clientes paginados");
    await d.click('#rail a[aria-label="Clientes"]');
    await d.waitForSelector('h2:has-text("27 clientes")');
    check("primera página de 25 con paginador", (await d.locator(".item").count()) === 25 && /1–25 de 27/.test(await texto(d, ".paginador")));
    await d.click('.paginador button:has-text("Siguiente")');
    await d.waitForFunction(() => document.querySelectorAll(".item").length === 2);
    check("segunda página con los 2 restantes", /26–27 de 27/.test(await texto(d, ".paginador")));
    await d.fill('input[aria-label="Buscar"]', "clienta05");
    await d.waitForSelector('h2:has-text("1 cliente")');
    check("la búsqueda va al servidor y vuelve a la página 1", (await d.locator(".item").count()) === 1 && (await d.locator(".paginador").count()) === 0);

    console.log("\n== Checkout de la tienda");
    const t = await nuevo();
    await t.goto(`http://localhost:${TIENDA}/registro`);
    await t.fill('input[name="nombre"]', "Lucía"); await t.fill('input[name="apellido"]', "Méndez");
    await t.fill('input[name="email"]', "lucia@x.com"); await t.fill('input[name="password"]', "Cliente123"); await t.fill('input[name="password2"]', "Cliente123");
    await t.fill('textarea[name="direccion"]', "Zona 10");
    await t.getByRole("button", { name: "Crear cuenta" }).click();
    await t.waitForURL(`http://localhost:${TIENDA}/`);
    await t.goto(`http://localhost:${TIENDA}/prenda/1`);
    await t.waitForSelector(".ficha h1");
    await t.getByRole("button", { name: "Agregar una" }).click();
    await t.getByRole("button", { name: "Agregar al carrito" }).click();
    await t.goto(`http://localhost:${TIENDA}/checkout`);
    await t.waitForSelector(".resumen .fila.total");
    const resumen = () => texto(t, ".resumen");
    check("a domicilio: subtotal 200 + envío 25 = 225, con IVA incluido", /Subtotal\s*Q\s*200/.test(await resumen()) && /Envío\s*Q\s*25/.test(await resumen()) && /Total\s*Q\s*225/.test(await resumen()) && /IVA incluido/.test(await resumen()), await resumen());
    await t.getByLabel("Retiro en la sucursal (sin costo de envío)").check();
    await t.waitForFunction(() => /Total\s*Q\s*200/.test(document.querySelector(".resumen").textContent));
    check("retiro en sucursal: envío gratis y sin campo de dirección", /Gratis/.test(await resumen()) && (await t.locator('textarea[name="direccion"]').count()) === 0);
    await t.fill('input[placeholder="Escribe tu código"]', "noexiste");
    await t.getByRole("button", { name: "Aplicar" }).click();
    await t.waitForSelector('p.err:has-text("no es válido")');
    check("cupón inválido: avisa y no descuenta", /Total\s*Q\s*200/.test(await resumen()));
    await t.fill('input[placeholder="Escribe tu código"]', "bienvenida");
    await t.getByRole("button", { name: "Aplicar" }).click();
    await t.waitForFunction(() => /Total\s*Q\s*180/.test(document.querySelector(".resumen").textContent));
    check("cupón aplicado: descuento 20, total 180", /Descuento \(BIENVENIDA\)\s*−Q\s*20/.test(await resumen()) && /aplicado/.test(await texto(t, "form")), await resumen());
    await t.screenshot({ path: path.join(SHOTS, "checkout-cupon.png"), fullPage: true });
    await t.getByRole("button", { name: "Confirmar pedido" }).click();
    await t.waitForURL(/\/pedidos\/\d+$/);
    await t.waitForSelector(".fila.total");
    const det = await texto(t, "main");
    check("el pedido muestra el desglose con el cupón y retiro en sucursal", /Descuento \(BIENVENIDA\)/.test(det) && /Total\s*Q\s*180/.test(det) && /Retiro en sucursal/.test(det), det.slice(0, 500));

    console.log("\n== Venta de mostrador con cupón");
    const c = await nuevo();
    await entrar(c, "carla@t.com");
    await c.goto(`http://localhost:${PANEL}/pedidos/nueva`);
    await c.waitForSelector('h1:has-text("Nueva venta")');
    // La clienta de la tienda ya le compró a Centro: el cajero de Centro la ve.
    await c.fill('input[placeholder="Nombre, correo o teléfono"]', "lucia");
    await c.locator("select").nth(0).selectOption({ index: 1 });
    await c.locator(".agregar-linea select").selectOption({ index: 1 });
    await c.fill('.agregar-linea input[type="number"]', "3");
    await c.click('.agregar-linea button:has-text("Agregar")');
    await c.fill('input[placeholder="Código (opcional)"]', "BIENVENIDA");
    await c.getByRole("button", { name: "Aplicar" }).click();
    await c.waitForSelector('.fila-total:has-text("Descuento (cupón BIENVENIDA)")');
    check("NuevaVenta: 300 − 30 = 270 (sin envío)", /Total\s*Q\s*270/.test(await texto(c, "main")));
    await c.getByRole("button", { name: "Crear pedido y cobrar" }).click();
    await c.waitForURL(/\/pedidos\/\d+/);
    await c.waitForSelector('.fila-total:has-text("IVA incluido")');
    const pd = await texto(c, "main");
    check("el detalle del pedido en el panel muestra subtotal, descuento e IVA", /Subtotal/.test(pd) && /Descuento \(cupón BIENVENIDA\)/.test(pd) && /IVA incluido/.test(pd) && /Q\s*270/.test(pd), pd.slice(0, 400));
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
