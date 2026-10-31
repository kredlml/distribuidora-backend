// Prueba de interfaz de las fotos de prendas: Subir, Cambiar, Quitar y Cancelar en el panel, con
// Cloudinary falso (firmas reales). Puertos propios (nunca 8080/8081/8082).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { chromium } = require(require("path").join(B, "node_modules", "playwright-core"));
const { Client } = require(B + "/node_modules/pg");
const { crear } = require("../soporte/cloudinary-falso");

const API = 18094, PANEL = 18195, CLD_PORT = 18096;
const CLD = { cloud: "demo-tienda", apiKey: "123456789", secret: "secreto-de-prueba" };
const SHOTS = path.join(SALIDAS, "capturas");
fs.mkdirSync(SHOTS, { recursive: true });
const ENV = {
  NODE_ENV: "development", PORT: String(API), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
  STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", CORS_ORIGIN: `http://localhost:${PANEL}`,
  CLOUDINARY_CLOUD_NAME: CLD.cloud, CLOUDINARY_API_KEY: CLD.apiKey, CLOUDINARY_API_SECRET: CLD.secret, CLOUDINARY_API_BASE: `http://localhost:${CLD_PORT}`,
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
// PNG mínimo válido (1x1) para elegir como archivo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const archivo = (nombre, tipo = "image/png", buffer = PNG) => ({ name: nombre, mimeType: tipo, buffer });

(async () => {
  for (const p of [API, PANEL, CLD_PORT]) if (await ocupado(p)) { console.error("ABORTADO: puerto ocupado " + p); process.exit(1); }
  const cld = crear(CLD);
  await new Promise((r) => cld.server.listen(CLD_PORT, r));
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const q = async (s, p) => (await pg.query(s, p)).rows;
  const procesos = [];
  let browser;
  try {
    procesos.push(proc(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV } }, "ui-fotos-backend.log"));
    await esperarUrl(`http://localhost:${API}/`);
    for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1) break; } catch {} }
    await sleep(2000);
    await api("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dina@t.com", password: "Clave1234" });
    const tD = (await api("POST", "/api/auth/login", { email: "dina@t.com", password: "Clave1234" })).data.token;
    await api("POST", "/api/categorias", { nombre: "Blusas" }, tD);
    procesos.push(proc("npx", ["vite", "--port", String(PANEL), "--strictPort"], { cwd: path.join(B, "frontend"), env: { ...process.env, VITE_API_URL: `http://localhost:${API}` } }, "ui-fotos-vite.log"));
    check("vite del panel arranca", await esperarUrl(`http://localhost:${PANEL}/`));

    browser = await chromium.launch({ executablePath: require("../soporte/chrome")(), headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-GT" });
    const page = await ctx.newPage();
    const errores = [];
    page.on("pageerror", (e) => errores.push(e.message));
    await page.goto(`http://localhost:${PANEL}/login`);
    await page.fill('input[name="email"]', "dina@t.com"); await page.fill('input[name="password"]', "Clave1234");
    await page.click('button:has-text("Iniciar sesión")'); await page.waitForSelector("#rail");
    await page.goto(`http://localhost:${PANEL}/catalogo`);
    await page.waitForSelector('h2:has-text("Nueva prenda")');
    await page.waitForSelector('button:has-text("Subir foto")');
    check("formulario de prenda muestra «Subir foto»", true);

    // Archivo no válido
    await page.setInputFiles('.foto-prenda input[type="file"]', archivo("doc.pdf", "application/pdf", Buffer.from("%PDF-1.4")));
    await page.waitForFunction(() => /JPG, PNG o WebP/.test(document.querySelector(".foto-prenda .err")?.textContent || ""));
    check("rechaza archivos que no son imagen", cld.estado.subidas.length === 0);
    // Subir
    await page.setInputFiles('.foto-prenda input[type="file"]', archivo("blusa.png"));
    await page.waitForSelector('button:has-text("Cambiar foto")');
    check("subir foto: aparece la vista previa y «Cambiar foto» / «Quitar foto»", cld.estado.subidas.length === 1 && (await page.locator('.foto-prenda button:has-text("Quitar foto")').count()) === 1 && /res\.cloudinary\.com/.test(await page.locator(".foto-vista img").getAttribute("src")));
    check("la vista previa pide la versión optimizada", /f_auto,q_auto,c_limit,w_240/.test(await page.locator(".foto-vista img").getAttribute("src")));
    // Cambiar antes de guardar: la primera subida se descarta
    await page.setInputFiles('.foto-prenda input[type="file"]', archivo("blusa2.png"));
    await page.waitForFunction(() => /foto2/.test(document.querySelector('input[name="imagen_url"]').value));
    await sleep(800);
    check("cambiar foto antes de guardar descarta la subida anterior", cld.estado.borradas.includes("distribuidora/prendas/foto1"), cld.estado.borradas);
    await page.screenshot({ path: path.join(SHOTS, "foto-prenda.png") });
    // Guardar la prenda
    await page.fill('input[name="nombre"]', "Blusa de lino");
    await page.selectOption('select[name="id_categoria"]', { label: "Blusas" });
    await page.fill('input[name="precio_unitario"]', "175");
    await page.click('button:has-text("Registrar prenda")');
    await page.waitForSelector('.item:has-text("Blusa de lino")');
    const prenda = (await q(`SELECT id_producto, imagen_url FROM "Producto" WHERE nombre='Blusa de lino'`))[0];
    check("la prenda se guarda con la foto de Cloudinary", /distribuidora\/prendas\/foto2\.jpg$/.test(prenda.imagen_url), prenda);
    check("tras registrar, el formulario queda sin foto", await page.locator('.foto-prenda button:has-text("Subir foto")').count() === 1);

    // Editar: Cambiar y CANCELAR -> se conserva la original, se descarta la nueva
    await page.locator(".item", { hasText: "Blusa de lino" }).locator('button:has-text("Editar")').click();
    await page.waitForSelector('dialog[open] .foto-prenda button:has-text("Cambiar foto")');
    await page.setInputFiles('dialog[open] .foto-prenda input[type="file"]', archivo("otra.png"));
    await page.waitForFunction(() => /foto3/.test(document.querySelector('dialog[open] input[name="imagen_url"]').value));
    await page.locator('dialog[open] button:has-text("Cancelar")').click();
    await sleep(1000);
    const tras = (await q(`SELECT imagen_url FROM "Producto" WHERE id_producto=$1`, [prenda.id_producto]))[0].imagen_url;
    check("cancelar la edición: la foto original sigue y la nueva se descarta", tras === prenda.imagen_url && cld.estado.borradas.includes("distribuidora/prendas/foto3") && !cld.estado.borradas.includes("distribuidora/prendas/foto2"), [tras, cld.estado.borradas]);

    // Editar: Cambiar y GUARDAR -> la anterior se borra de Cloudinary
    await page.locator(".item", { hasText: "Blusa de lino" }).locator('button:has-text("Editar")').click();
    await page.waitForSelector('dialog[open] .foto-prenda button:has-text("Cambiar foto")');
    await page.setInputFiles('dialog[open] .foto-prenda input[type="file"]', archivo("nueva.png"));
    await page.waitForFunction(() => /foto4/.test(document.querySelector('dialog[open] input[name="imagen_url"]').value));
    await page.locator('dialog[open] button:has-text("Guardar cambios")').click();
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    await sleep(1000);
    const nueva = (await q(`SELECT imagen_url FROM "Producto" WHERE id_producto=$1`, [prenda.id_producto]))[0].imagen_url;
    check("cambiar y guardar: queda la nueva y la anterior se borra", /foto4\.jpg$/.test(nueva) && cld.estado.borradas.includes("distribuidora/prendas/foto2") && !cld.estado.borradas.includes("distribuidora/prendas/foto4"), [nueva, cld.estado.borradas]);

    // Editar: Quitar y GUARDAR -> sin foto y borrada de Cloudinary
    await page.locator(".item", { hasText: "Blusa de lino" }).locator('button:has-text("Editar")').click();
    await page.waitForSelector('dialog[open] .foto-prenda button:has-text("Quitar foto")');
    await page.locator('dialog[open] .foto-prenda button:has-text("Quitar foto")').click();
    check("quitar foto vuelve a ofrecer «Subir foto»", await page.locator('dialog[open] .foto-prenda button:has-text("Subir foto")').count() === 1);
    await page.locator('dialog[open] button:has-text("Guardar cambios")').click();
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    await sleep(1000);
    const sin = (await q(`SELECT imagen_url FROM "Producto" WHERE id_producto=$1`, [prenda.id_producto]))[0].imagen_url;
    check("quitar y guardar: la prenda queda sin foto y se borra de Cloudinary", sin === null && cld.estado.borradas.includes("distribuidora/prendas/foto4"), [sin, cld.estado.borradas]);

    // Enlace pegado a mano sigue funcionando
    await page.locator(".item", { hasText: "Blusa de lino" }).locator('button:has-text("Editar")').click();
    await page.locator('dialog[open] button:has-text("o pegar un enlace")').click();
    await page.locator('dialog[open] input[aria-label="Enlace de la imagen"]').fill("https://otro-sitio.com/blusa.jpg");
    await page.locator('dialog[open] button:has-text("Guardar cambios")').click();
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    check("también se puede pegar un enlace", (await q(`SELECT imagen_url FROM "Producto" WHERE id_producto=$1`, [prenda.id_producto]))[0].imagen_url === "https://otro-sitio.com/blusa.jpg");
    check("Cloudinary nunca recibió una firma inválida", cld.estado.rechazos.length === 0, cld.estado.rechazos);
    check("sin errores de JavaScript", errores.length === 0, errores.join(" | "));
  } catch (e) {
    console.error(e); fails.push("excepción: " + e.message);
  } finally {
    if (browser) await browser.close();
    procesos.forEach((p) => { try { spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"]); } catch {} });
    cld.server.close();
    await pg.end(); await sleep(1500);
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
