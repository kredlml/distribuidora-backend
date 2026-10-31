// Prueba de interfaz de la tienda con Chrome headless (playwright-core) contra backend + Postgres desechables.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");

const API = 18280, TIENDA = 18282, TIENDA_PK = 18283, IMG = 18290;
const SHOTS = path.join(SALIDAS, "capturas");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const ENV = {
  NODE_ENV: "development", PORT: String(API), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
  STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", CORS_ORIGIN: `http://localhost:${TIENDA},http://localhost:${TIENDA_PK}`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + String(i).slice(0, 400) : "")); } };

// Imágenes de prueba (SVG) servidas localmente.
const svg = (c1, c2, txt) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="400" height="500" fill="url(#g)"/><text x="200" y="260" font-family="sans-serif" font-size="36" fill="#fff" text-anchor="middle">${txt}</text></svg>`;
const imgs = { "oxford.svg": svg("#3b5bdb", "#91a7ff", "Oxford"), "jeans.svg": svg("#1c3d5a", "#4a6f8a", "Jeans"), "blanca.svg": svg("#ced4da", "#f8f9fa", "Blanca") };
const imgServer = http.createServer((req, res) => {
  const f = imgs[req.url.slice(1)];
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": "image/svg+xml" }); res.end(f);
});

function proc(cmd, args, opts, log) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(cmd, args, { ...opts, stdio: ["ignore", out, out], shell: process.platform === "win32" && cmd === "npx" });
}
async function esperarUrl(url) {
  for (let i = 0; i < 160; i++) { await sleep(500); try { const r = await fetch(url); if (r.status < 500) return true; } catch {} }
  return false;
}

(async () => {
  await new Promise((r) => imgServer.listen(IMG, r));
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const procesos = [];
  let browser;
  try {
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-backend.log"));
    await esperarUrl(`http://localhost:${API}/`);
    for (let i = 0; i < 120; i++) { await sleep(500); try { if ((await pg.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`)).rows[0].n >= 14) break; } catch {} }
    await sleep(3000);
    const q = (s, p) => pg.query(s, p);
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','6a avenida','Guatemala',true),('Norte','Calzada','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Camisas'),('Pantalones'),('Accesorios')`);
    const I = `http://localhost:${IMG}`;
    await q(`INSERT INTO "Producto"(nombre,descripcion,precio_unitario,stock_minimo,activo,talla,color,id_categoria,imagen_url) VALUES ('Camisa Oxford','Algodón 100%, corte regular.',150,5,true,'S','Azul',1,'${I}/oxford.svg')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria,id_producto_padre,imagen_url) VALUES ('Camisa Oxford',150,5,true,'M','Azul',1,1,NULL),('Camisa Oxford',150,5,true,'L','Azul',1,1,NULL),('Camisa Oxford',165,5,true,'M','Blanco',1,1,'${I}/blanca.svg')`);
    await q(`INSERT INTO "Producto"(nombre,descripcion,precio_unitario,stock_minimo,activo,talla,id_categoria,imagen_url) VALUES ('Jeans Slim','Mezclilla elástica.',299.99,5,true,'32',2,'${I}/jeans.svg'),('Gorra Clásica',NULL,85,5,true,NULL,3,NULL),('Cinturón de cuero',NULL,120,5,true,NULL,3,'https://no-existe.invalid/x.jpg')`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (10,1,1,'A','DISPONIBLE'),(6,2,1,'B','DISPONIBLE'),(0,3,1,'C','DISPONIBLE'),(3,3,2,'C2','DISPONIBLE'),(4,4,1,'D','DISPONIBLE'),(8,5,1,'E','DISPONIBLE'),(5,6,1,'F','DISPONIBLE')`);
    await fetch(`http://localhost:${API}/api/auth/registro`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: "Admin", apellido: "T", email: "admin@t.com", password: "Clave1234" }) });
    const tokAdmin = (await (await fetch(`http://localhost:${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@t.com", password: "Clave1234" }) })).json()).token;

    const tiendaDir = path.join(B, "tienda");
    procesos.push(proc("npx", ["vite", "--port", String(TIENDA), "--strictPort"], { cwd: tiendaDir, env: { ...process.env, VITE_API_URL: `http://localhost:${API}`, VITE_STRIPE_PUBLISHABLE_KEY: "" } }, "ui-vite.log"));
    procesos.push(proc("npx", ["vite", "--port", String(TIENDA_PK), "--strictPort"], { cwd: tiendaDir, env: { ...process.env, VITE_API_URL: `http://localhost:${API}`, VITE_STRIPE_PUBLISHABLE_KEY: "pk_test_51Fake00000000000000000000000000" } }, "ui-vite-pk.log"));
    check("vite de la tienda arranca", await esperarUrl(`http://localhost:${TIENDA}/`));
    await esperarUrl(`http://localhost:${TIENDA_PK}/`);

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-GT" });
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|no-existe\.invalid|ERR_NAME_NOT_RESOLVED/.test(m.text())) errores.push("console: " + m.text()); });
    const T = `http://localhost:${TIENDA}`;
    const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true });

    console.log("\n== Catálogo");
    await page.goto(T + "/");
    await page.waitForSelector(".prenda");
    await sleep(600);
    check("catálogo muestra 4 prendas agrupadas", (await page.locator(".prenda").count()) === 4, await page.locator(".prenda").count());
    check("imagen rota cae al recuadro con inicial", (await page.locator(".prenda .img.ph").count()) >= 2);
    await shot("01-catalogo");
    await page.getByRole("button", { name: "Accesorios" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".prenda").length === 2);
    check("filtro por categoría", (await page.locator(".prenda").count()) === 2);
    await page.getByRole("button", { name: "Todo" }).click();
    await page.fill('input[aria-label="Buscar prendas"]', "blanco");
    await page.getByRole("button", { name: "Buscar" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".prenda").length === 1);
    check("búsqueda por color", (await page.locator(".prenda .nombre").first().textContent()) === "Camisa Oxford");

    console.log("\n== Ficha de prenda y carrito");
    await page.locator(".prenda").first().click();
    await page.waitForSelector(".ficha h1");
    check("ficha abre con precio", /150/.test(await page.locator(".precio-g").textContent()));
    await page.getByRole("button", { name: "L", exact: true }).click();
    check("talla L sin stock en Centro: botón deshabilitado y aviso de otra sucursal", await page.getByRole("button", { name: "Agregar al carrito" }).isDisabled() && /Norte/.test(await page.locator(".ficha-info").textContent()));
    await page.getByRole("button", { name: "M", exact: true }).click();
    await page.getByRole("button", { name: "Agregar una" }).click();
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await sleep(300);
    check("contador del carrito = 2", /2/.test(await page.locator(".carrito").textContent()));
    await page.getByRole("button", { name: "Blanco" }).click();
    check("cambiar a Blanco muestra su precio", /165/.test(await page.locator(".precio-g").textContent()));
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await shot("02-prenda");
    await page.goto(T + "/");
    await page.waitForSelector(".prenda");
    await page.locator(".prenda", { hasText: "Jeans" }).click();
    await page.waitForSelector(".ficha h1");
    await page.getByRole("button", { name: "Agregar al carrito" }).click();

    await page.locator(".carrito").click();
    await page.waitForSelector(".linea");
    await sleep(800);
    check("carrito con 3 líneas", (await page.locator(".linea").count()) === 3);
    check("total del carrito 2×150 + 165 + 299.99 = 764.99", /764[.,]99/.test(await page.locator(".resumen .total").textContent()), await page.locator(".resumen .total").textContent());
    await shot("03-carrito");

    console.log("\n== Registro y checkout");
    await page.getByRole("button", { name: "Continuar con la compra" }).click();
    await page.waitForURL(/\/login/);
    check("checkout sin sesión manda al login", true);
    await page.getByRole("link", { name: "Crea una" }).click();
    await page.waitForURL(/\/registro/);
    await page.fill('input[name="nombre"]', "Lucía");
    await page.fill('input[name="apellido"]', "Méndez");
    await page.fill('input[name="email"]', "lucia@example.com");
    await page.fill('input[name="password"]', "Cliente123");
    await page.fill('input[name="password2"]', "Cliente123");
    await page.fill('textarea[name="direccion"]', "12 calle 1-25, zona 10, Guatemala");
    await shot("04-registro");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.waitForURL(/\/checkout/);
    check("tras registrarse vuelve al checkout", true);
    await page.waitForFunction(() => !document.querySelector("form button.pri")?.disabled);
    check("dirección precargada del registro", (await page.inputValue('textarea[name="direccion"]')).includes("zona 10"));
    await shot("05-checkout");
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await page.waitForURL(/\/pedidos\/\d+$/);
    const idPedido = page.url().match(/pedidos\/(\d+)/)[1];
    await page.waitForSelector(".pasos");
    check("pedido creado y pendiente de pago", /Pendiente de pago/.test(await page.locator(".head").textContent()));
    check("carrito vacío tras confirmar", /0/.test(await page.locator(".carrito").textContent()));
    check("total del pedido 764.99", /764[.,]99/.test(await page.locator(".fila.total").textContent()));
    await shot("06-pedido-pendiente");

    console.log("\n== Pago (modo simulado, sin clave publicable)");
    await page.getByRole("button", { name: /Pagar/ }).click();
    await page.waitForFunction(() => /Pagado/.test(document.querySelector(".head")?.textContent || ""));
    check("pago aprobado: estado Pagado, en preparación", true);
    check("sección de pagos visible", (await page.locator("text=Tarjeta").count()) >= 1);
    await shot("07-pedido-pagado");

    console.log("\n== Cancelar otro pedido");
    await page.goto(T + "/prenda/6");
    await page.waitForSelector(".ficha h1");
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await page.goto(T + "/checkout");
    await page.waitForFunction(() => !document.querySelector("form button.pri")?.disabled);
    await page.getByRole("button", { name: "Confirmar pedido" }).click();
    await page.waitForURL(/\/pedidos\/\d+$/);
    await page.getByRole("button", { name: "Cancelar pedido" }).click();
    await page.waitForSelector("dialog[open]");
    await shot("08-cancelar-dialogo");
    await page.getByRole("button", { name: "Sí, cancelar" }).click();
    await page.waitForFunction(() => /Cancelado/.test(document.querySelector(".head")?.textContent || ""));
    check("pedido cancelado desde la tienda", true);

    console.log("\n== Cambio de talla");
    for (const e of ["ENVIADO", "ENTREGADO"]) {
      await fetch(`http://localhost:${API}/api/pedidos/${idPedido}/estado`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tokAdmin }, body: JSON.stringify({ estado: e }) });
    }
    await page.goto(`${T}/pedidos/${idPedido}`);
    await page.waitForSelector(".pasos");
    check("pedido entregado muestra los 4 pasos completados", (await page.locator(".pasos li.actual").textContent()).includes("Entregado"));
    await page.getByRole("link", { name: "Solicitar cambio o devolución" }).click();
    await page.waitForSelector(".linea-dev");
    const lineaM = page.locator(".linea-dev", { hasText: "Talla M · Azul" });
    await lineaM.locator('input[type="checkbox"]').check();
    await lineaM.locator("select").nth(1).selectOption({ label: "Talla S · Azul" });
    await page.fill("textarea", "Me queda grande");
    await shot("09-solicitar-cambio");
    await page.getByRole("button", { name: "Enviar solicitud" }).click();
    await page.waitForURL(/\/devoluciones\/\d+$/);
    await page.waitForSelector(".tl li");
    check("solicitud creada: Solicitada con cambio por talla S", /Solicitada/.test(await page.locator(".head").textContent()) && /Talla S/.test(await page.locator(".card").first().textContent()));
    await shot("10-devolucion");
    await page.goto(T + "/pedidos");
    await page.waitForSelector(".pedido-fila");
    check("mis pedidos lista 2 pedidos", (await page.locator(".pedido-fila").count()) === 2);
    await shot("11-mis-pedidos");

    console.log("\n== Móvil (390px)");
    const movil = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "es-GT", isMobile: true });
    const pm = await movil.newPage();
    pm.on("pageerror", (e) => errores.push("pageerror(movil): " + e.message));
    await pm.goto(T + "/");
    await pm.waitForSelector(".prenda");
    await sleep(500);
    check("móvil: sin scroll horizontal", await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await pm.screenshot({ path: path.join(SHOTS, "12-movil-catalogo.png"), fullPage: true });
    await pm.goto(T + "/prenda/1");
    await pm.waitForSelector(".ficha h1");
    check("móvil ficha: sin scroll horizontal", await pm.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await pm.screenshot({ path: path.join(SHOTS, "13-movil-prenda.png"), fullPage: true });

    console.log("\n== Formulario de tarjeta (Stripe Elements con clave publicable)");
    const pk = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-GT" });
    const pp = await pk.newPage();
    const erroresPk = [];
    pp.on("pageerror", (e) => erroresPk.push(e.message));
    const TP = `http://localhost:${TIENDA_PK}`;
    await pp.goto(TP + "/login");
    await pp.fill('input[name="email"]', "lucia@example.com");
    await pp.fill('input[name="password"]', "Cliente123");
    await pp.getByRole("button", { name: "Iniciar sesión" }).click();
    await pp.waitForURL(TP + "/");
    await pp.goto(TP + "/prenda/5");
    await pp.waitForSelector(".ficha h1");
    await pp.getByRole("button", { name: "Agregar al carrito" }).click();
    await pp.goto(TP + "/checkout");
    await pp.waitForFunction(() => !document.querySelector("form button.pri")?.disabled);
    await pp.getByRole("button", { name: "Confirmar pedido" }).click();
    await pp.waitForURL(/\/pedidos\/\d+$/);
    let iframe = false;
    try { await pp.waitForSelector(".tarjeta iframe", { timeout: 20000 }); iframe = true; } catch {}
    check("CardElement de Stripe se monta (iframe) — requiere internet a js.stripe.com", iframe);
    check("botón pagar deshabilitado hasta completar la tarjeta", await pp.getByRole("button", { name: /Pagar/ }).isDisabled());
    await sleep(1500);
    await pp.screenshot({ path: path.join(SHOTS, "14-pago-tarjeta.png"), fullPage: true });
    check("sin errores JS con Stripe cargado", erroresPk.length === 0, erroresPk.join(" | "));

    check("sin errores de JavaScript ni de consola en todo el recorrido", errores.length === 0, errores.join(" | "));
  } catch (e) {
    try {
      const pgs = browser ? browser.contexts().flatMap((c) => c.pages()) : [];
      for (const [i, pg2] of pgs.entries()) {
        await pg2.screenshot({ path: path.join(SHOTS, `error-${i}.png`), fullPage: true });
        console.log(`[pagina ${i}] url=${pg2.url()}\n${(await pg2.locator("main").innerText()).slice(0, 800)}`);
      }
    } catch (e2) { console.log("no se pudo capturar:", e2.message); }
    console.error("ERROR EN PRUEBA:", e);
    fails.push("excepción: " + e.message);
  } finally {
    if (browser) await browser.close();
    for (const p of procesos) { try { process.platform === "win32" ? spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"]) : p.kill(); } catch {} }
    imgServer.close();
    await pg.end();
    await sleep(1500);
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    if (fails.length) console.log("Fallos:\n - " + fails.join("\n - "));
    process.exit(fails.length ? 1 : 0);
  }
})();
