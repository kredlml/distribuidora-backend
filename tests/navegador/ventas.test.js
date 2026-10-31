// Prueba de interfaz: Pedidos, Nueva venta, cobro, estados, Clientes (código web), Proveedores,
// y la activación de cuenta en la tienda. Puertos propios (nunca 8080/8081/8082).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");

const API = 18096, PANEL = 18197, TIENDA = 18297;
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
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-ventas-backend.log"));
    await esperarUrl(`http://localhost:${API}/`);
    for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Cliente' AND column_name='codigo_activacion'`))[0].n === 1 && (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1) break; } catch {} }
    await sleep(2500);
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','6a avenida','Guatemala',true),('Norte','Calzada','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Camisas'),('Pantalones')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria) VALUES ('Camisa Oxford',150,5,true,'M','Azul',1),('Camisa Oxford',150,5,true,'L','Azul',1),('Jeans Slim',299.99,5,true,'32',NULL,2)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (10,1,1,'L1','DISPONIBLE'),(6,2,1,'L2','DISPONIBLE'),(4,3,1,'L3','DISPONIBLE'),(3,1,2,'L4','DISPONIBLE')`);
    await api("POST", "/api/auth/registro", { nombre: "Ana", apellido: "Admin", email: "ana@t.com", password: "Clave1234" });
    const tokA = (await api("POST", "/api/auth/login", { email: "ana@t.com", password: "Clave1234" })).data.token;
    await api("POST", "/api/auth/registro", { nombre: "Carla", apellido: "Caja", puesto: "CAJERO", email: "carla@t.com", password: "Clave1234", id_sucursal: 1 }, tokA);
    await api("POST", "/api/auth/registro", { nombre: "Beto", apellido: "Bodega", puesto: "BODEGUERO", email: "beto@t.com", password: "Clave1234", id_sucursal: 1 }, tokA);

    procesos.push(proc("npx", ["vite", "--port", String(PANEL), "--strictPort"], { cwd: path.join(B, "frontend"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}` } }, "ui-ventas-vite.log"));
    procesos.push(proc("npx", ["vite", "--port", String(TIENDA), "--strictPort"], { cwd: path.join(B, "tienda"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}`, VITE_STRIPE_PUBLISHABLE_KEY: "" } }, "ui-ventas-tienda.log"));
    check("vite del panel y de la tienda arrancan", (await esperarUrl(`http://localhost:${PANEL}/`)) && (await esperarUrl(`http://localhost:${TIENDA}/`)));

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const errores = [];
    const nuevo = async (vp = { width: 1280, height: 900 }) => {
      const ctx = await browser.newContext({ viewport: vp, locale: "es-GT" });
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
    const toast = async (page, re) => { try { await page.waitForFunction((src) => { const t = document.querySelector("#toast.show"); return t && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 }); return true; } catch { console.log("    (toast:", await page.textContent("#toast").catch(() => ""), "| err:", await page.textContent("dialog[open] .err").catch(() => "-"), ")"); return false; } };
    const dlg = (page) => page.locator("dialog[open]");
    const errDlg = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("dialog[open] .err")?.textContent || ""), re.source, { timeout: 8000 }).then(() => true).catch(() => false);

    // ============ CAJERO
    const c = await nuevo();
    await entrar(c, "carla@t.com");
    const rail = async (p, n) => p.locator(`#rail a[aria-label="${n}"]`).count();
    check("CAJERO ve Pedidos y Clientes, no Proveedores ni Empleados", (await rail(c, "Pedidos")) === 1 && (await rail(c, "Clientes")) === 1 && (await rail(c, "Proveedores")) === 0 && (await rail(c, "Empleados")) === 0);

    // ---- Clientes
    await c.click('#rail a[aria-label="Clientes"]');
    await c.waitForSelector('h2:has-text("0 clientes")');
    await c.click('button:has-text("Nuevo cliente")');
    await dlg(c).locator('input[name="nombre"]').fill("María");
    await dlg(c).locator('input[name="apellido"]').fill("López");
    await dlg(c).locator('input[name="email"]').fill("Maria@Correo.com");
    await dlg(c).locator('input[name="telefono"]').fill("55551234");
    await dlg(c).locator('button:has-text("Registrar cliente")').click();
    check("alta de cliente: aviso", await toast(c, /registrado/));
    await c.waitForSelector('.item:has-text("María López")');
    check("cliente nuevo figura como «Mostrador»", /Mostrador/.test(await c.locator(".item", { hasText: "María López" }).textContent()));
    check("CAJERO no ve la casilla de activo al editar", await (async () => { await c.locator(".item", { hasText: "María López" }).locator('button:has-text("Editar")').click(); const n = await dlg(c).locator('input[name="activo"]').count(); await dlg(c).locator('button:has-text("Cancelar")').click(); return n === 0; })());
    await c.locator(".item", { hasText: "María López" }).locator('button:has-text("Código web")').click();
    await dlg(c).locator('button:has-text("Generar código")').click();
    await c.waitForSelector("dialog[open] .codigo-web");
    const codigo = (await c.textContent("dialog[open] .codigo-web")).trim();
    check("se genera y muestra el código XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(codigo), codigo);
    await c.screenshot({ path: path.join(SHOTS, "ventas-codigo-web.png") });
    await dlg(c).locator('button:has-text("Listo")').click();

    // ---- Nueva venta
    await c.click('#rail a[aria-label="Pedidos"]');
    await c.waitForSelector('a:has-text("Nueva venta")');
    await c.click('a:has-text("Nueva venta")');
    await c.waitForSelector('h1:has-text("Nueva venta")');
    check("el cajero vende en su sucursal (fija, sin selector)", /Sucursal: Centro/.test(await c.textContent("main")));
    // Cliente nuevo desde la venta
    await c.click('button:has-text("Registrar cliente nuevo")');
    await dlg(c).locator('input[name="nombre"]').fill("Pedro");
    await dlg(c).locator('input[name="apellido"]').fill("Sin Correo");
    await dlg(c).locator('button:has-text("Registrar cliente")').click();
    await toast(c, /registrado/);
    await c.waitForFunction(() => [...document.querySelectorAll("select")][0]?.selectedOptions[0]?.textContent.includes("Pedro"));
    check("el cliente creado queda seleccionado", true);
    await c.fill('input[placeholder="Nombre, correo o teléfono"]', "maría");
    await c.locator("select").nth(0).selectOption({ label: "María López (maria@correo.com)" });
    const selProd = c.locator("select").nth(1);
    await selProd.selectOption({ index: 1 }); // primera prenda con stock
    await c.fill('.agregar-linea input[type="number"]', "11");
    await c.click('.agregar-linea button:has-text("Agregar")');
    check("no deja agregar más que el stock disponible", /Solo quedan/.test(await c.textContent(".err")));
    await c.fill('.agregar-linea input[type="number"]', "2");
    await c.click('.agregar-linea button:has-text("Agregar")');
    await selProd.selectOption({ label: await selProd.locator("option", { hasText: "Jeans Slim" }).textContent() });
    await c.fill('.agregar-linea input[type="number"]', "1");
    await c.click('.agregar-linea button:has-text("Agregar")');
    check("total de la venta: 2×150 + 299.99", /599[.,]99/.test(await c.textContent(".fila-total.grande")), await c.textContent(".fila-total.grande"));
    await c.screenshot({ path: path.join(SHOTS, "ventas-nueva-venta.png"), fullPage: true });
    await c.click('button:has-text("Crear pedido y cobrar")');
    await c.waitForSelector('dialog[open] h1:has-text("Registrar pago")', { timeout: 10000 });
    check("al crear la venta se abre el cobro", /\/pedidos\/\d+\?cobrar=1/.test(c.url()), c.url());
    const idVenta = Number(c.url().match(/pedidos\/(\d+)/)[1]);
    check("monto propuesto = saldo", (await dlg(c).locator('input[type="number"]').first().inputValue()) === "599.99");
    await dlg(c).locator('input[type="number"]').nth(1).fill("1000");
    check("calcula el vuelto en efectivo", /Vuelto:.*400[.,]01/.test(await dlg(c).locator(".vuelto").textContent()), await dlg(c).locator(".vuelto").textContent());
    await c.screenshot({ path: path.join(SHOTS, "ventas-cobro.png") });
    await dlg(c).locator('button:has-text("Cobrar")').click();
    check("cobro en efectivo: pedido pagado", await toast(c, /pagado/));
    await c.waitForSelector('.head .st:has-text("Pagado")');
    check("estado y pagos en la base", (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [idVenta]))[0].estado === "PROCESADO" && (await q(`SELECT metodo_pago, estado_pago FROM "Pago" WHERE id_pedido=$1`, [idVenta]))[0].metodo_pago === "EFECTIVO");
    check("el cajero ve que el envío lo hace bodega", /lo hace bodega/.test(await c.textContent("main")));
    await c.screenshot({ path: path.join(SHOTS, "ventas-detalle-pagado.png"), fullPage: true });

    // ---- Venta con pago parcial con tarjeta + PayPal y pedido pendiente editable
    const r2 = await api("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles: [{ id_producto: 2, cantidad: 1 }] }, (await api("POST", "/api/auth/login", { email: "carla@t.com", password: "Clave1234" })).data.token);
    const idP2 = r2.data.pedido.id_pedido;
    await c.goto(`http://localhost:${PANEL}/pedidos/${idP2}`);
    await c.waitForSelector('h2:has-text("Falta cobrar")');
    await c.click('button:has-text("Registrar pago")');
    await dlg(c).locator('label:has-text("Tarjeta (POS)") input').check();
    await dlg(c).locator('input[type="number"]').first().fill("100");
    await dlg(c).locator('input[name="referencia"]').fill("AUT-77");
    await dlg(c).locator('button:has-text("Cobrar")').click();
    check("pago parcial con tarjeta registrado", await toast(c, /Pago registrado/));
    await c.waitForSelector('h2:has-text("Falta cobrar Q")');
    check("saldo actualizado tras pago parcial", /50[.,]00/.test(await c.textContent('h2:has-text("Falta cobrar")')), await c.textContent('h2:has-text("Falta cobrar")'));
    // agregar y quitar línea
    await c.locator(".agregar-linea select").selectOption({ index: 1 });
    await c.fill('.agregar-linea input[type="number"]', "1");
    await c.click('.agregar-linea button:has-text("Agregar")');
    check("agregar prenda al pedido pendiente", await toast(c, /agregada/));
    await c.waitForFunction(() => document.querySelectorAll(".linea").length === 2);
    await c.locator(".linea").nth(1).locator('button:has-text("Quitar")').click();
    await dlg(c).locator('button:has-text("Quitar")').click();
    check("quitar prenda del pedido pendiente", await toast(c, /quitada/));
    await c.waitForFunction(() => document.querySelectorAll(".linea").length === 1);
    await c.click('button:has-text("Registrar pago")');
    await dlg(c).locator('label:has-text("PayPal") input').check();
    await dlg(c).locator('button:has-text("Cobrar")').click();
    await toast(c, /Pago registrado/);
    await c.waitForSelector('.item:has-text("Por confirmar")');
    await c.locator(".item", { hasText: "Por confirmar" }).locator('button:has-text("Confirmar")').click();
    await dlg(c).locator('button:has-text("Confirmar pago")').click();
    check("confirmar PayPal deja el pedido pagado", await toast(c, /PROCESADO|confirmado/));
    await c.waitForSelector('.head .st:has-text("Pagado")');
    // Pedido pendiente que se cancela
    const r3 = await api("POST", "/api/pedidos", { id_cliente: 2, id_sucursal: 1, detalles: [{ id_producto: 3, cantidad: 1 }] }, (await api("POST", "/api/auth/login", { email: "carla@t.com", password: "Clave1234" })).data.token);
    await c.goto(`http://localhost:${PANEL}/pedidos/${r3.data.pedido.id_pedido}`);
    await c.click('button:has-text("Cancelar pedido")');
    await dlg(c).locator('button:has-text("Cancelar pedido")').click();
    check("cancelar pedido pendiente", await toast(c, /cancelado/));
    await c.waitForSelector('.head .st:has-text("Cancelado")');

    // Pedido con cobro parcial en efectivo: devolver y luego cancelar
    const r4 = await api("POST", "/api/pedidos", { id_cliente: 2, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, (await api("POST", "/api/auth/login", { email: "carla@t.com", password: "Clave1234" })).data.token);
    await c.goto(`http://localhost:${PANEL}/pedidos/${r4.data.pedido.id_pedido}`);
    await c.click('button:has-text("Registrar pago")');
    await dlg(c).locator('input[type="number"]').first().fill("200");
    check("monto mayor al saldo explica el motivo", /como máximo/.test(await dlg(c).locator("#ayuda-monto").textContent()) && /Efectivo recibido/.test(await dlg(c).locator("#ayuda-monto").textContent()));
    await dlg(c).locator('input[type="number"]').first().fill("50");
    await dlg(c).locator('button:has-text("Cobrar")').click();
    await toast(c, /Pago registrado/);
    await c.waitForSelector('.item:has-text("Completado")');
    check("con un cobro hecho no se ofrece cancelar y se explica", await c.locator('button:has-text("Cancelar pedido")').count() === 0 && /devuelve los cobros/.test(await c.textContent("main")));
    await c.locator(".item", { hasText: "Completado" }).locator('button:has-text("Devolver")').click();
    await dlg(c).locator('button:has-text("Ya lo devolví")').click();
    check("devolver el cobro en efectivo", await toast(c, /devuelto/));
    await c.waitForSelector('.item:has-text("Devuelto")');
    await c.click('button:has-text("Cancelar pedido")');
    await dlg(c).locator('button:has-text("Cancelar pedido")').click();
    check("tras devolver, el pedido se cancela", await toast(c, /cancelado/));
    // Nueva venta: el cliente elegido no desaparece al buscar otro nombre
    await c.goto(`http://localhost:${PANEL}/pedidos/nueva`);
    await c.waitForSelector('h1:has-text("Nueva venta")');
    await c.locator("select").nth(0).selectOption({ label: "Pedro Sin Correo" });
    await c.fill('input[placeholder="Nombre, correo o teléfono"]', "zzz-nadie");
    check("el cliente elegido sigue visible aunque la búsqueda no coincida", (await c.locator("select").nth(0).evaluate((s) => s.selectedOptions[0].textContent)) === "Pedro Sin Correo");

    // ---- Listado con filtros
    await c.goto(`http://localhost:${PANEL}/pedidos`);
    await c.waitForSelector(".fila-pedido");
    check("listado muestra los 4 pedidos", await c.locator("a.fila-pedido").count() === 4);
    await c.click('button.chip:has-text("Cancelado")');
    await c.waitForFunction(() => document.querySelectorAll("a.fila-pedido").length === 2);
    check("filtro por estado (en la URL)", /estado=CANCELADO/.test(c.url()));
    await c.click('button.chip:has-text("Todos")');
    await c.fill('input[aria-label="Buscar"]', "pedro");
    await c.waitForFunction(() => document.querySelectorAll("a.fila-pedido").length === 2);
    check("búsqueda por cliente", true);
    await c.screenshot({ path: path.join(SHOTS, "ventas-pedidos.png"), fullPage: true });

    // ============ BODEGUERO: despacho y entrega
    const b = await nuevo();
    await entrar(b, "beto@t.com");
    check("BODEGUERO ve Pedidos y Proveedores, no Clientes", (await rail(b, "Pedidos")) === 1 && (await rail(b, "Proveedores")) === 1 && (await rail(b, "Clientes")) === 0);
    await b.goto(`http://localhost:${PANEL}/pedidos/${idVenta}`);
    check("BODEGUERO no ve «Registrar pago» ni «Nueva venta»", await b.locator('button:has-text("Registrar pago")').count() === 0);
    await b.click('button:has-text("Marcar como enviado")');
    await dlg(b).locator('button:has-text("Marcar como enviado")').click();
    check("marcar enviado", await toast(b, /enviado/));
    await b.waitForSelector('button:has-text("Marcar como entregado")');
    await b.click('button:has-text("Marcar como entregado")');
    await dlg(b).locator('button:has-text("Marcar como entregado")').click();
    check("marcar entregado", await toast(b, /entregado/));
    await b.waitForSelector('.head .st:has-text("Entregado")');
    check("estado ENTREGADO en la base", (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [idVenta]))[0].estado === "ENTREGADO");
    await b.goto(`http://localhost:${PANEL}/pedidos/nueva`);
    check("BODEGUERO en Nueva venta ve aviso de permisos", /solo para ADMIN o CAJERO/.test(await b.textContent("main")));

    // ---- Proveedores
    await b.goto(`http://localhost:${PANEL}/proveedores`);
    await b.click('button:has-text("Nuevo proveedor")');
    await dlg(b).locator('input[name="nombre_empresa"]').fill("Telas de Guatemala");
    await dlg(b).locator('input[name="nombre_contacto"]').fill("Luis");
    await dlg(b).locator('input[name="email"]').fill("ventas@telas.gt");
    await dlg(b).locator('button:has-text("Registrar proveedor")').click();
    check("alta de proveedor", await toast(b, /registrado/));
    await b.waitForSelector('.item:has-text("Telas de Guatemala")');
    check("BODEGUERO no ve Eliminar", await b.locator('.item button:has-text("Eliminar")').count() === 0);
    await b.locator(".item", { hasText: "Telas de Guatemala" }).locator('button:has-text("Editar")').click();
    await dlg(b).locator('input[name="telefono"]').fill("22223333");
    await dlg(b).locator('button:has-text("Guardar cambios")').click();
    check("editar proveedor", await toast(b, /actualizado/));
    const a = await nuevo();
    await entrar(a, "ana@t.com");
    await a.goto(`http://localhost:${PANEL}/proveedores`);
    await a.locator(".item", { hasText: "Telas de Guatemala" }).locator('button:has-text("Eliminar")').click();
    await dlg(a).locator('button:has-text("Eliminar proveedor")').click();
    check("ADMIN elimina proveedor", await toast(a, /eliminado/));
    check("ADMIN ve todos los enlaces del menú", (await rail(a, "Pedidos")) + (await rail(a, "Clientes")) + (await rail(a, "Proveedores")) + (await rail(a, "Empleados")) === 4);

    // ============ TIENDA: activar cuenta con el código de caja
    const t = await nuevo();
    await t.goto(`http://localhost:${TIENDA}/registro`);
    await t.fill('input[name="nombre"]', "María"); await t.fill('input[name="apellido"]', "López");
    await t.fill('input[name="email"]', "maria@correo.com");
    await t.fill('input[name="password"]', "Nueva1234"); await t.fill('input[name="password2"]', "Nueva1234");
    await t.click('button:has-text("Crear cuenta")');
    await t.waitForSelector('.err a:has-text("Activar mi cuenta")', { timeout: 10000 });
    check("tienda: registrarse con correo de caja sugiere activar", true);
    await t.click('.err a:has-text("Activar mi cuenta")');
    await t.waitForSelector('h1:has-text("Activa tu cuenta")');
    await t.fill('input[name="email"]', "maria@correo.com");
    await t.fill('input[name="codigo"]', "AAAA-AAAA");
    await t.fill('input[name="password"]', "Nueva1234"); await t.fill('input[name="password2"]', "Nueva1234");
    await t.click('button:has-text("Activar cuenta")');
    await t.waitForFunction(() => /no son válidos/.test(document.querySelector(".err")?.textContent || ""));
    check("tienda: código incorrecto muestra error", true);
    await t.fill('input[name="codigo"]', codigo.toLowerCase());
    await t.click('button:has-text("Activar cuenta")');
    await t.waitForURL((u) => !/activar/.test(u.pathname), { timeout: 10000 });
    await t.screenshot({ path: path.join(SHOTS, "ventas-tienda-activada.png") });
    await t.goto(`http://localhost:${TIENDA}/pedidos`);
    await t.waitForSelector(`text=#${idVenta}`, { timeout: 10000 }).catch(() => {});
    check("tienda: la cuenta activada ve su compra de mostrador", (await t.textContent("main")).includes(`#${idVenta}`), await t.textContent("main"));

    // ============ Móvil
    const m = await nuevo({ width: 390, height: 844 });
    await entrar(m, "ana@t.com");
    for (const [ruta, sel] of [["/pedidos", "a.fila-pedido"], [`/pedidos/${idVenta}`, ".lineas"], ["/pedidos/nueva", 'h1:has-text("Nueva venta")'], ["/clientes", ".item"], ["/proveedores", "h1"]]) {
      await m.goto(`http://localhost:${PANEL}${ruta}`);
      await m.waitForSelector(sel);
      const desborde = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`móvil ${ruta}: sin scroll horizontal`, desborde <= 1, desborde);
    }
    await m.goto(`http://localhost:${PANEL}/pedidos/${idVenta}`); await m.waitForSelector(".lineas");
    await m.screenshot({ path: path.join(SHOTS, "ventas-movil-detalle.png"), fullPage: true });

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
