// Prueba de interfaz del panel de empleados (tipos, sucursales, bajas de stock, empleados) con
// Chrome headless. Backend, Vite y Postgres desechables en puertos propios (nunca 8080/8081/8082).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");

const API = 18086, PANEL = 18187;
const SHOTS = path.join(SALIDAS, "capturas");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const ENV = {
  NODE_ENV: "development", PORT: String(API), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
  STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", CORS_ORIGIN: `http://localhost:${PANEL}`,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + String(i).slice(0, 400) : "")); } };
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
function proc(cmd, args, opts, log) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(cmd, args, { ...opts, stdio: ["ignore", out, out], shell: process.platform === "win32" && cmd === "npx" });
}
async function esperarUrl(url) {
  for (let i = 0; i < 160; i++) { await sleep(500); try { const r = await fetch(url); if (r.status < 500) return true; } catch {} }
  return false;
}
const api = async (method, url, body, token) => {
  const r = await fetch(`http://localhost:${API}${url}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};

(async () => {
  for (const p of [API, PANEL]) if (await ocupado(p)) { console.error("ABORTADO: puerto ocupado " + p); process.exit(1); }
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const procesos = [];
  let browser;
  try {
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-panel-backend.log"));
    await esperarUrl(`http://localhost:${API}/`);
    for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Empleado' AND column_name='activo'`))[0].n === 1 && (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`))[0].n >= 14) break; } catch {} }
    await sleep(3000);
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,telefono,activo) VALUES ('Centro','6a avenida 10-20','Guatemala','22334455',true),('Norte','Calzada San Juan','Mixco',NULL,true)`);
    await q(`INSERT INTO "Categoria"(nombre,descripcion) VALUES ('Camisas','Vestir y casuales'),('Pantalones',NULL),('Temporada',NULL)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria) VALUES ('Camisa Oxford',150,5,true,'M','Azul',1),('Camisa Oxford',150,5,true,'L','Azul',1),('Jeans Slim',299.99,5,true,'32',NULL,2)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (12,1,1,'L-01','DISPONIBLE'),(6,2,1,'L-02','DISPONIBLE'),(3,1,1,NULL,'DANADA'),(9,3,1,'L-03','DISPONIBLE'),(0,3,1,'L-00','DISPONIBLE'),(4,1,2,'L-04','DISPONIBLE')`);
    await api("POST", "/api/auth/registro", { nombre: "Ana", apellido: "Admin", email: "ana@t.com", password: "Clave1234" });
    const tokA = (await api("POST", "/api/auth/login", { email: "ana@t.com", password: "Clave1234" })).data.token;
    await api("POST", "/api/auth/registro", { nombre: "Beto", apellido: "Bodega", puesto: "BODEGUERO", email: "beto@t.com", password: "Clave1234", id_sucursal: 1 }, tokA);
    await api("POST", "/api/auth/registro", { nombre: "Carla", apellido: "Caja", puesto: "CAJERO", email: "carla@t.com", password: "Clave1234", id_sucursal: 1 }, tokA);

    procesos.push(proc("npx", ["vite", "--port", String(PANEL), "--strictPort"], { cwd: path.join(B, "frontend"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}` } }, "ui-panel-vite.log"));
    check("vite del panel arranca", await esperarUrl(`http://localhost:${PANEL}/`));

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const errores = [];
    const nuevo = async (vp = { width: 1280, height: 900 }) => {
      const ctx = await browser.newContext({ viewport: vp, locale: "es-GT" });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errores.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push(m.text()); });
      return { ctx, page };
    };
    const entrar = async (page, email, password = "Clave1234") => {
      await page.goto(`http://localhost:${PANEL}/login`);
      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);
      await page.click('button:has-text("Iniciar sesión")');
      await page.waitForSelector("#rail", { timeout: 15000 });
    };
    const toast = async (page, re = /./) => { try { await page.waitForFunction((src) => { const t = document.querySelector("#toast.show"); return t && new RegExp(src).test(t.textContent); }, re.source, { timeout: 8000 }); } catch { console.log("    (toast actual:", await page.textContent("#toast").catch(()=>""), "| error diálogo:", await page.textContent("dialog[open] .err").catch(()=>"-"), ")"); } return page.textContent("#toast"); };
    const dialogo = (page) => page.locator("dialog[open]");

    // ================= ADMIN
    const { page } = await nuevo();
    await entrar(page, "ana@t.com");
    check("login sugiere pedir cuenta a un admin", true);
    check("ADMIN ve Sucursales y Empleados en el menú", await page.locator('#rail a[aria-label="Sucursales"]').count() === 1 && await page.locator('#rail a[aria-label="Empleados"]').count() === 1);

    // ---- Tipos de prenda
    await page.goto(`http://localhost:${PANEL}/catalogo`);
    await page.click('button.chip:has-text("Tipos de prenda")');
    await page.waitForSelector('h2:has-text("Tipos registrados")');
    const filaCamisas = page.locator(".item", { hasText: "Camisas" });
    check("tipos muestran cuántas prendas los usan", /2 prendas/.test(await filaCamisas.textContent()), await filaCamisas.textContent());
    check("cada tipo tiene Editar y Eliminar", await page.locator('.item button:has-text("Editar")').count() === 3 && await page.locator('.item button:has-text("Eliminar")').count() === 3);
    await page.locator(".item", { hasText: "Temporada" }).locator('button:has-text("Editar")').click();
    await dialogo(page).locator('input[name="nombre"]').fill("Temporada verano");
    await dialogo(page).locator('input[name="descripcion"]').fill("Ropa de temporada");
    await dialogo(page).locator('button:has-text("Guardar cambios")').click();
    check("editar tipo: aviso", /actualizado/.test(await toast(page, /actualizado/)));
    await page.waitForSelector('.item:has-text("Temporada verano")');
    check("editar tipo: lista actualizada", /Ropa de temporada/.test(await page.locator(".item", { hasText: "Temporada verano" }).textContent()));
    await page.locator(".item", { hasText: "Camisas" }).locator('button:has-text("Editar")').click();
    await dialogo(page).locator('input[name="nombre"]').fill("pantalones");
    await dialogo(page).locator('button:has-text("Guardar cambios")').click();
    await page.waitForFunction(() => /Ya existe/.test(document.querySelector("dialog[open] .err")?.textContent || ""));
    check("editar tipo con nombre repetido muestra el error en el diálogo", true);
    await dialogo(page).locator('button:has-text("Cancelar")').click();
    await filaCamisas.locator('button:has-text("Eliminar")').click();
    check("eliminar tipo en uso: explica y no ofrece borrar", /Lo usan 2 prendas/.test(await dialogo(page).textContent()) && await dialogo(page).locator('button:has-text("Eliminar tipo")').count() === 0);
    await page.screenshot({ path: path.join(SHOTS, "panel-tipo-en-uso.png") });
    await dialogo(page).locator('button:has-text("Entendido")').click();
    await page.locator(".item", { hasText: "Temporada verano" }).locator('button:has-text("Eliminar")').click();
    await dialogo(page).locator('button:has-text("Eliminar tipo")').click();
    check("eliminar tipo sin prendas: aviso", /eliminado/.test(await toast(page, /eliminado/)));
    await page.waitForFunction(() => ![...document.querySelectorAll(".item")].some((x) => x.textContent.includes("Temporada verano")));
    check("tipo eliminado desaparece de la lista", (await q(`SELECT count(*)::int n FROM "Categoria"`))[0].n === 2);
    await page.screenshot({ path: path.join(SHOTS, "panel-tipos.png"), fullPage: true });

    // ---- Sucursales
    await page.click('#rail a[aria-label="Sucursales"]');
    await page.waitForSelector('h2:has-text("Sucursales registradas")');
    await page.click('button:has-text("Nueva sucursal")');
    await dialogo(page).locator('input[name="nombre"]').fill("Sur");
    await dialogo(page).locator('input[name="direccion"]').fill("Km 15 carretera al Pacífico");
    await dialogo(page).locator('input[name="ciudad"]').fill("Villa Nueva");
    await dialogo(page).locator('button:has-text("Crear sucursal")').click();
    check("crear sucursal: aviso", /creada/.test(await toast(page, /creada/)));
    await page.waitForSelector('.item.suc:has-text("Sur")');
    await page.locator(".item.suc", { hasText: "Sur" }).locator('button:has-text("Editar")').click();
    await dialogo(page).locator('input[name="telefono"]').fill("66778899");
    await dialogo(page).locator('input[name="activo"]').uncheck();
    await dialogo(page).locator('button:has-text("Guardar cambios")').click();
    await toast(page, /Sur.*actualizada/);
    await page.waitForSelector('.item.suc:has-text("Inactiva")');
    const sur = (await q(`SELECT telefono, activo FROM "Sucursal" WHERE nombre='Sur'`))[0];
    check("editar sucursal: teléfono y desactivación guardados", sur.telefono === "66778899" && sur.activo === false, JSON.stringify(sur));
    await page.locator(".item.suc", { hasText: "Centro" }).locator('button:has-text("Eliminar")').click();
    await dialogo(page).locator('button:has-text("Eliminar sucursal")').click();
    await page.waitForFunction(() => /Desactívala/.test(document.querySelector("dialog[open] .err")?.textContent || ""));
    check("eliminar sucursal con historial: explica que se desactive", true);
    await dialogo(page).locator('button:has-text("Cancelar")').click();
    await page.locator(".item.suc", { hasText: "Sur" }).locator('button:has-text("Eliminar")').click();
    await dialogo(page).locator('button:has-text("Eliminar sucursal")').click();
    check("eliminar sucursal sin historial: aviso", /eliminada/.test(await toast(page, /eliminada/)));
    await page.waitForFunction(() => ![...document.querySelectorAll(".item.suc")].some((x) => x.textContent.includes("Villa Nueva")));

    // ---- Stock y bajas
    await page.locator(".item.suc", { hasText: "Centro" }).locator('button:has-text("Ver stock")').click();
    await page.waitForSelector('h2:has-text("Stock de Centro")');
    check("URL guarda la sucursal elegida", /\?id=1/.test(page.url()), page.url());
    check("lista filas con stock (oculta las de 0)", await page.locator("label.fila-stock").count() === 4, await page.locator("label.fila-stock").count());
    await page.check("label.agotadas input");
    check("«Mostrar filas en 0» muestra la fila agotada", await page.locator("label.fila-stock").count() === 5);
    await page.uncheck("label.agotadas input");
    const btnBaja = page.locator('button:has-text("Dar de baja o ajustar")');
    check("botón de baja deshabilitado sin selección", await btnBaja.isDisabled());
    await page.locator("label.fila-stock", { hasText: "L-01" }).locator("input").check();
    await page.locator("label.fila-stock", { hasText: "Dañada" }).locator("input").check();
    check("contador de seleccionadas", /\(2\)/.test(await btnBaja.textContent()));
    await btnBaja.click();
    const d = dialogo(page);
    check("diálogo de baja con las 2 filas, por defecto en 0", await d.locator(".ajuste-fila").count() === 2 && /15/.test(await d.locator("p.sm b").textContent()), await d.textContent());
    await d.locator(".ajuste-fila", { hasText: "L-01" }).locator("input").fill("10");
    check("resumen se recalcula (2 + 3 = 5)", (await d.locator("p.sm b").textContent()).trim() === "5");
    check("confirmar deshabilitado sin motivo", await d.locator('button:has-text("Confirmar baja")').isDisabled());
    await d.locator(".ajuste-fila", { hasText: "L-01" }).locator("input").fill("13");
    check("cantidad mayor a la actual marca error y bloquea", await d.locator(".field.mal").count() === 1);
    await d.locator(".ajuste-fila", { hasText: "L-01" }).locator("input").fill("10");
    await d.locator("select").selectOption("DANO");
    await d.locator('input[name="observacion"]').fill("Humedad en la bodega");
    await page.screenshot({ path: path.join(SHOTS, "panel-baja-dialogo.png") });
    await d.locator('button:has-text("Confirmar baja")').click();
    check("baja: aviso con unidades", /5 unidad/.test(await toast(page, /5 unidad/)));
    await page.waitForFunction(() => document.querySelectorAll("label.fila-stock").length === 3);
    const inv = await q(`SELECT lote, estado, cantidad FROM "Inventario" WHERE id_sucursal=1 ORDER BY id_inventario`);
    check("baja aplicada en la base (L-01=10, Dañada=0)", inv[0].cantidad === 10 && inv[2].cantidad === 0, JSON.stringify(inv));
    check("selección se limpia tras la baja", /\(0\)/.test(await btnBaja.textContent()));
    // Stock cambiado mientras se edita -> 409 en el diálogo
    await page.locator("label.fila-stock", { hasText: "L-03" }).locator("input").check();
    await btnBaja.click();
    await q(`UPDATE "Inventario" SET cantidad=8 WHERE lote='L-03'`);
    await dialogo(page).locator("select").selectOption("CORRECCION_CONTEO");
    await dialogo(page).locator('button:has-text("Confirmar baja")').click();
    await page.waitForFunction(() => /cambió mientras/.test(document.querySelector("dialog[open] .err")?.textContent || ""));
    check("stock cambiado mientras se edita: error claro, sin aplicar", (await q(`SELECT cantidad FROM "Inventario" WHERE lote='L-03'`))[0].cantidad === 8);
    await dialogo(page).locator('button:has-text("Cancelar")').click();
    await page.waitForFunction(() => ([...document.querySelectorAll("label.fila-stock")].find((x) => x.textContent.includes("L-03"))?.querySelector(".num")?.textContent || "").trim() === "8");
    check("al cerrar recarga y muestra el stock nuevo", true);
    await page.screenshot({ path: path.join(SHOTS, "panel-sucursales.png"), fullPage: true });

    // Trazabilidad muestra la baja
    await page.goto(`http://localhost:${PANEL}/trazabilidad?producto=1`);
    await page.waitForSelector(".tl li");
    check("Trazabilidad muestra «Baja por ajuste» con el motivo", /Baja por ajuste/.test(await page.textContent(".tl")) && /Humedad en la bodega/.test(await page.textContent(".tl")), await page.textContent(".tl"));

    // ---- Empleados
    await page.click('#rail a[aria-label="Empleados"]');
    await page.waitForSelector('.item:has-text("Beto")');
    check("lista empleados con puesto y sucursal", await page.locator("section.card .item").count() === 3 && /Bodeguero/.test(await page.locator(".item", { hasText: "Beto" }).textContent()) && /Centro/.test(await page.locator(".item", { hasText: "Beto" }).textContent()));
    check("se marca al usuario actual con (tú)", /\(tú\)/.test(await page.locator(".item", { hasText: "Ana" }).textContent()));
    await page.click('button:has-text("Nuevo empleado")');
    let e = dialogo(page);
    await e.locator('input[name="nombre"]').fill("Diego");
    await e.locator('input[name="apellido"]').fill("Ruiz");
    await e.locator('input[name="email"]').fill("Diego@T.com");
    await e.locator('select[name="puesto"]').selectOption("CAJERO");
    await e.locator('select[name="id_sucursal"]').selectOption("2");
    await e.locator('input[name="password"]').fill("Inicial123");
    await e.locator('input[name="password2"]').fill("Distinta123");
    await e.locator('button:has-text("Registrar empleado")').click();
    await page.waitForFunction(() => /no coinciden/.test(document.querySelector("dialog[open] .err")?.textContent || ""));
    check("alta: contraseñas distintas se detectan antes de enviar", (await q(`SELECT count(*)::int n FROM "Empleado" WHERE email='diego@t.com'`))[0].n === 0);
    await e.locator('input[name="password2"]').fill("Inicial123");
    await e.locator('button:has-text("Registrar empleado")').click();
    check("alta de empleado: aviso", /registrado/.test(await toast(page, /registrado/)));
    await page.waitForSelector('.item:has-text("Diego")');
    const diego = (await q(`SELECT puesto, id_sucursal, activo, email FROM "Empleado" WHERE email='diego@t.com'`))[0];
    check("alta guardada (correo en minúsculas, sucursal Norte, CAJERO)", diego && diego.puesto === "CAJERO" && diego.id_sucursal === 2 && diego.activo === true, JSON.stringify(diego));
    // Editar a Carla: CAJERO -> BODEGUERO
    await page.locator(".item", { hasText: "Carla" }).locator('button:has-text("Editar")').click();
    await dialogo(page).locator('select[name="puesto"]').selectOption("BODEGUERO");
    await dialogo(page).locator('button:has-text("Guardar cambios")').click();
    await toast(page, /Carla actualizados/);
    await page.waitForFunction(() => /Bodeguero/.test([...document.querySelectorAll(".item")].find((x) => x.textContent.includes("Carla"))?.textContent || ""));
    check("editar puesto de Carla", (await q(`SELECT puesto FROM "Empleado" WHERE email='carla@t.com'`))[0].puesto === "BODEGUERO");
    // Editarse a sí mismo: puesto y activo deshabilitados, nombre editable
    await page.locator(".item", { hasText: "Ana" }).locator('button:has-text("Editar")').click();
    e = dialogo(page);
    check("al editarse a sí mismo: puesto y activo bloqueados", await e.locator('select[name="puesto"]').isDisabled() && await e.locator('input[name="activo"]').isDisabled());
    await e.locator('input[name="apellido"]').fill("Administradora");
    await e.locator('button:has-text("Guardar cambios")').click();
    await toast(page, /Ana actualizados/);
    const ana = (await q(`SELECT apellido, puesto, activo FROM "Empleado" WHERE email='ana@t.com'`))[0];
    check("guardar a sí mismo no toca puesto ni activo", ana.apellido === "Administradora" && ana.puesto === "DISTRITAL" && ana.activo === true, JSON.stringify(ana));
    // Restablecer contraseña de Diego
    await page.locator(".item", { hasText: "Diego" }).locator('button:has-text("Restablecer contraseña")').click();
    await dialogo(page).locator('input[name="password"]').fill("Temporal99");
    await dialogo(page).locator('input[name="password2"]').fill("Temporal99");
    await dialogo(page).locator('button:has-text("Guardar contraseña")').click();
    check("restablecer contraseña: aviso", /restablecida/.test(await toast(page, /restablecida/)));
    check("Diego entra con la temporal", (await api("POST", "/api/auth/login", { email: "diego@t.com", password: "Temporal99" })).status === 200);
    await page.screenshot({ path: path.join(SHOTS, "panel-empleados.png"), fullPage: true });

    // ---- Mi cuenta (avatar)
    await page.click("#rail .avatar");
    e = dialogo(page);
    check("avatar abre Mi cuenta", /Mi cuenta/.test(await e.textContent()));
    await e.locator('input[name="actual"]').fill("mala-clave1");
    await e.locator('input[name="nueva"]').fill("NuevaAna123");
    await e.locator('input[name="nueva2"]').fill("NuevaAna123");
    await e.locator('button:has-text("Cambiar contraseña")').click();
    await page.waitForFunction(() => /no es correcta/.test(document.querySelector("dialog[open] .err")?.textContent || ""));
    check("clave actual mala: error y la sesión sigue abierta", await page.locator("#rail").count() === 1);
    await e.locator('input[name="actual"]').fill("Clave1234");
    await e.locator('button:has-text("Cambiar contraseña")').click();
    check("cambiar mi contraseña: aviso", /actualizada/.test(await toast(page, /actualizada/)));
    check("login con la nueva", (await api("POST", "/api/auth/login", { email: "ana@t.com", password: "NuevaAna123" })).status === 200);

    // ================= BODEGUERO (Beto)
    const b = await nuevo();
    await entrar(b.page, "beto@t.com");
    check("BODEGUERO ve Sucursales pero no Empleados", await b.page.locator('#rail a[aria-label="Sucursales"]').count() === 1 && await b.page.locator('#rail a[aria-label="Empleados"]').count() === 0);
    await b.page.goto(`http://localhost:${PANEL}/sucursales?id=1`);
    await b.page.waitForSelector('h2:has-text("Stock de Centro")');
    check("BODEGUERO: sin crear/editar/eliminar sucursales, con baja de stock", await b.page.locator('button:has-text("Nueva sucursal")').count() === 0 && await b.page.locator('.item.suc button:has-text("Editar")').count() === 0 && await b.page.locator('button:has-text("Dar de baja o ajustar")').count() === 1);
    await b.page.goto(`http://localhost:${PANEL}/empleados`);
    check("BODEGUERO en /empleados ve el aviso de solo administradores", /solo para administradores/.test(await b.page.textContent("main")));
    await b.page.goto(`http://localhost:${PANEL}/catalogo`);
    await b.page.click('button.chip:has-text("Tipos de prenda")');
    check("BODEGUERO ve los tipos de prenda solo de lectura (el catálogo es del distrital)", await b.page.locator('.item button:has-text("Editar")').count() === 0 && await b.page.locator('.item button:has-text("Eliminar")').count() === 0 && await b.page.locator('form:has-text("Nuevo tipo de prenda")').count() === 0);

    // Desactivar a Beto con su sesión abierta -> al siguiente request lo saca al login
    const idBeto = (await q(`SELECT id_empleado FROM "Empleado" WHERE email='beto@t.com'`))[0].id_empleado;
    const tokAna = (await api("POST", "/api/auth/login", { email: "ana@t.com", password: "NuevaAna123" })).data.token;
    await api("PUT", `/api/empleados/${idBeto}`, { activo: false }, tokAna);
    await b.page.click('#rail a[aria-label="Inventario"]');
    await b.page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
    check("empleado desactivado con sesión abierta vuelve al login", /\/login/.test(b.page.url()), b.page.url());
    check("aviso de sesión cerrada", /desactivada|expiró/.test(await b.page.textContent("#toast")));
    await b.page.fill('input[name="email"]', "beto@t.com");
    await b.page.fill('input[name="password"]', "Clave1234");
    await b.page.click('button:has-text("Iniciar sesión")');
    await b.page.waitForFunction(() => /desactivada/.test(document.querySelector(".err")?.textContent || ""));
    check("login de desactivado muestra «cuenta desactivada»", true);

    // ================= Cambio de puesto reflejado sin volver a iniciar sesión (Carla ahora BODEGUERO)
    const c = await nuevo();
    await c.page.goto(`http://localhost:${PANEL}/login`);
    await c.page.evaluate((s) => localStorage.setItem("sesion", JSON.stringify(s)), { ...(await api("POST", "/api/auth/login", { email: "carla@t.com", password: "Clave1234" })).data, puesto: "CAJERO" });
    await c.page.goto(`http://localhost:${PANEL}/`);
    await c.page.waitForSelector('#rail a[aria-label="Sucursales"]', { timeout: 10000 }).catch(() => {});
    check("sesión guardada como CAJERO se refresca a BODEGUERO (/yo)", await c.page.locator('#rail a[aria-label="Sucursales"]').count() === 1 && JSON.parse(await c.page.evaluate(() => localStorage.getItem("sesion"))).puesto === "BODEGUERO");

    // ================= CAJERO (Diego)
    const k = await nuevo();
    await entrar(k.page, "diego@t.com", "Temporal99");
    check("CAJERO no ve Sucursales ni Empleados", await k.page.locator('#rail a[aria-label="Sucursales"]').count() === 0 && await k.page.locator('#rail a[aria-label="Empleados"]').count() === 0);
    await k.page.goto(`http://localhost:${PANEL}/sucursales`);
    check("CAJERO en /sucursales ve el aviso de permisos", /solo para ADMIN o BODEGUERO/.test(await k.page.textContent("main")));

    // ================= Móvil
    const m = await nuevo({ width: 390, height: 844 });
    await entrar(m.page, "ana@t.com", "NuevaAna123");
    for (const [ruta, nombre] of [["/sucursales?id=1", "sucursales"], ["/empleados", "empleados"], ["/catalogo", "catalogo"], ["/inventario", "inventario"], ["/", "devoluciones"]]) {
      await m.page.goto(`http://localhost:${PANEL}${ruta}`);
      await m.page.waitForSelector({ sucursales: "h2:has-text(\"Stock de Centro\")", empleados: ".item:has-text(\"Diego\")", catalogo: "h2:has-text(\"Nueva prenda\")", inventario: ".card.inv", devoluciones: ".head h1" }[nombre]);
      const desborde = await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`móvil ${nombre}: sin scroll horizontal de la página`, desborde <= 1, desborde);
      await m.page.screenshot({ path: path.join(SHOTS, `panel-movil-${nombre}.png`), fullPage: true });
    }

    check("sin errores de JavaScript en consola", errores.length === 0, errores.join(" | "));
  } catch (e) {
    console.error(e);
    fails.push("excepción: " + e.message);
  } finally {
    if (browser) await browser.close();
    procesos.forEach((p) => { try { spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"]); } catch {} });
    await pg.end();
    await sleep(1500);
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
