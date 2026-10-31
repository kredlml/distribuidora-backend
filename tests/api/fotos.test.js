// E2E de fotos de prendas con Cloudinary (falso, con firmas reales): firma solo para el distrital,
// subida, cambio, quitar, eliminar prenda, descartar sin borrar las que se usan, y sin configuración.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");
const { crear } = require("../soporte/cloudinary-falso");

const PORT = 18091, PORT_SIN = 18092, PORT_CLD = 18093;
const CLD = { cloud: "demo-tienda", apiKey: "123456789", secret: "secreto-de-prueba" };
const BASE = { NODE_ENV: "development", DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test", DB_DIALECT: "postgres", DB_SSL: "false",
  JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_x", DB_PORT: "54329", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad" };
const ENV = { ...BASE, PORT: String(PORT), CLOUDINARY_CLOUD_NAME: CLD.cloud, CLOUDINARY_API_KEY: CLD.apiKey, CLOUDINARY_API_SECRET: CLD.secret, CLOUDINARY_API_BASE: `http://localhost:${PORT_CLD}` };
const ENV_SIN = { ...BASE, PORT: String(PORT_SIN), CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "" };
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 500) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (s, p) => (await pg.query(s, p)).rows;
const mk = (port) => async (method, url, body, token) => {
  const headers = {}; if (body !== undefined) headers["Content-Type"] = "application/json"; if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${port}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; } return { status: r.status, data };
};
const call = mk(PORT), callSin = mk(PORT_SIN);
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
const arrancar = (env, log) => spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...env }, stdio: ["ignore", fs.openSync(path.join(SALIDAS, log), "w"), fs.openSync(path.join(SALIDAS, log + ".err"), "w")] });
async function esperarUrl(url) { for (let i = 0; i < 160; i++) { await sleep(500); try { const r = await fetch(url); if (r.status < 500) return true; } catch {} } return false; }

// Sube como lo hace el navegador: multipart con la firma que dio el backend.
async function subir(firma, conFirmaMala = false) {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("imagen-falsa")], { type: "image/jpeg" }), "foto.jpg");
  for (const k of ["api_key", "timestamp", "signature", "folder", "allowed_formats"]) fd.append(k, k === "signature" && conFirmaMala ? "x" : String(firma[k]));
  const r = await fetch(firma.upload_url, { method: "POST", body: fd });
  return { status: r.status, data: await r.json() };
}

(async () => {
  for (const p of [PORT, PORT_SIN, PORT_CLD]) if (await ocupado(p)) { console.error("ABORTADO: puerto ocupado " + p); process.exit(1); }
  const cld = crear(CLD);
  await new Promise((r) => cld.server.listen(PORT_CLD, r));
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv, srvSin;
  try {
    srv = arrancar(ENV, "server-fotos.log");
    await esperarUrl(`http://localhost:${PORT}/`);
    for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1) break; } catch {} }
    await sleep(1500);
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true)`);
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "D", email: "d@t.com", password: "Clave1234" });
    const tD = (await call("POST", "/api/auth/login", { email: "d@t.com", password: "Clave1234" })).data.token;
    await call("POST", "/api/auth/registro", { nombre: "Ana", puesto: "ADMIN", email: "a@t.com", password: "Clave1234", id_sucursal: 1 }, tD);
    const tA = (await call("POST", "/api/auth/login", { email: "a@t.com", password: "Clave1234" })).data.token;
    await call("POST", "/api/categorias", { nombre: "Blusas" }, tD);

    let r = await call("GET", "/api/imagenes/config", undefined, tA);
    check("config: subida habilitada", r.status === 200 && r.data.habilitado === true && r.data.max_mb === 5, r);
    r = await call("GET", "/api/imagenes/config");
    check("config sin token -> 403", r.status === 403, r);
    r = await call("POST", "/api/imagenes/firma", undefined, tA);
    check("ADMIN de sucursal no puede subir fotos (catálogo del distrital) -> 403", r.status === 403, r);
    r = await call("POST", "/api/imagenes/firma", undefined, tD);
    const f1 = r.data;
    check("firma para el distrital: carpeta, formatos y sin el secreto", r.status === 200 && f1.folder === "distribuidora/prendas" && f1.allowed_formats === "jpg,jpeg,png,webp" && f1.api_key === CLD.apiKey && /^[0-9a-f]{40}$/.test(f1.signature) && !JSON.stringify(f1).includes(CLD.secret), f1);
    let s = await subir(f1, true);
    check("Cloudinary rechaza una firma alterada", s.status === 401, s);
    s = await subir(f1);
    const url1 = s.data.secure_url;
    check("Cloudinary acepta la firma del backend", s.status === 200 && /res\.cloudinary\.com\/demo-tienda\/image\/upload\/v\d+\/distribuidora\/prendas\/foto\d+\.jpg/.test(url1), s);

    r = await call("POST", "/api/productos", { nombre: "Blusa", precio_unitario: 100, id_categoria: 1, talla: "M", imagen_url: url1 }, tD);
    const idP = r.data.id_producto;
    check("prenda creada con la foto subida", r.status === 201 && r.data.imagen_url === url1, r);
    const url2 = (await subir((await call("POST", "/api/imagenes/firma", undefined, tD)).data)).data.secure_url;
    r = await call("PUT", `/api/productos/${idP}`, { imagen_url: url2 }, tD);
    await sleep(500);
    check("cambiar foto: se guarda la nueva y se borra la anterior de Cloudinary", r.status === 200 && r.data.imagen_url === url2 && cld.estado.borradas.includes("distribuidora/prendas/foto1"), cld.estado);
    // Variante que comparte la foto de la base: al cambiar una, no se borra la compartida.
    r = await call("POST", "/api/productos", { nombre: "Blusa", precio_unitario: 100, id_categoria: 1, talla: "S", id_producto_padre: idP, imagen_url: url2 }, tD);
    const idV = r.data.id_producto;
    r = await call("PUT", `/api/productos/${idV}`, { imagen_url: null }, tD);
    await sleep(500);
    check("quitar la foto de la variante no borra la que sigue usando la base", r.status === 200 && r.data.imagen_url === null && !cld.estado.borradas.includes("distribuidora/prendas/foto2"), cld.estado.borradas);
    r = await call("PUT", `/api/productos/${idP}`, { imagen_url: "" }, tD);
    await sleep(500);
    check("quitar foto: queda sin foto y se borra de Cloudinary", r.status === 200 && r.data.imagen_url === null && cld.estado.borradas.includes("distribuidora/prendas/foto2"), cld.estado.borradas);
    // Enlace externo: nunca se intenta borrar
    r = await call("PUT", `/api/productos/${idP}`, { imagen_url: "https://otro-sitio.com/blusa.jpg" }, tD);
    const antesExt = cld.estado.borradas.length;
    r = await call("PUT", `/api/productos/${idP}`, { imagen_url: null }, tD);
    await sleep(400);
    check("un enlace externo no se borra de ningún lado", cld.estado.borradas.length === antesExt, cld.estado.borradas);
    // URL de OTRO cloud de Cloudinary: tampoco
    r = await call("POST", "/api/imagenes/descartar", { urls: ["https://res.cloudinary.com/otro-cloud/image/upload/v1/distribuidora/prendas/x.jpg"] }, tD);
    check("descartar una foto de otra cuenta de Cloudinary no hace nada", r.data.borradas === 0, r);
    // Descartar: solo las que nadie usa
    const url3 = (await subir((await call("POST", "/api/imagenes/firma", undefined, tD)).data)).data.secure_url;
    const url4 = (await subir((await call("POST", "/api/imagenes/firma", undefined, tD)).data)).data.secure_url;
    await call("PUT", `/api/productos/${idP}`, { imagen_url: url3 }, tD);
    r = await call("POST", "/api/imagenes/descartar", { urls: [url3, url4] }, tD);
    check("descartar: borra la subida no usada y conserva la que tiene una prenda", r.data.borradas === 1 && cld.estado.borradas.includes("distribuidora/prendas/foto4") && !cld.estado.borradas.includes("distribuidora/prendas/foto3"), [r.data, cld.estado.borradas]);
    r = await call("POST", "/api/imagenes/descartar", { urls: [url4] }, tA);
    check("ADMIN de sucursal no descarta fotos -> 403", r.status === 403, r);
    // Eliminar la prenda (sin historial) borra su foto
    r = await call("POST", "/api/productos", { nombre: "Temporal", precio_unitario: 50, id_categoria: 1, imagen_url: (await subir((await call("POST", "/api/imagenes/firma", undefined, tD)).data)).data.secure_url }, tD);
    const idT = r.data.id_producto;
    r = await call("DELETE", `/api/productos/${idT}`, undefined, tD);
    await sleep(500);
    check("eliminar la prenda borra su foto de Cloudinary", r.status === 200 && cld.estado.borradas.includes("distribuidora/prendas/foto5"), cld.estado.borradas);
    check("ningún borrado ni subida con firma inválida desde el backend", cld.estado.rechazos.filter((x) => x === "destroy").length === 0, cld.estado.rechazos);

    // ---- Sin configuración de Cloudinary
    srvSin = arrancar(ENV_SIN, "server-fotos-sin.log");
    await esperarUrl(`http://localhost:${PORT_SIN}/`);
    await sleep(1500);
    const tD2 = (await callSin("POST", "/api/auth/login", { email: "d@t.com", password: "Clave1234" })).data.token;
    r = await callSin("GET", "/api/imagenes/config", undefined, tD2);
    check("sin las variables: subida deshabilitada", r.data.habilitado === false, r);
    r = await callSin("POST", "/api/imagenes/firma", undefined, tD2);
    check("sin las variables: firma -> 503 con explicación", r.status === 503 && /CLOUDINARY/.test(r.data.message), r);
    r = await callSin("PUT", `/api/productos/${idP}`, { imagen_url: "https://otro-sitio.com/x.jpg" }, tD2);
    check("sin las variables se puede seguir pegando un enlace", r.status === 200, r);
  } catch (e) {
    console.error(e); fails.push("excepción: " + e.message);
  } finally {
    if (srv) srv.kill(); if (srvSin) srvSin.kill();
    cld.server.close();
    await pg.end();
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
