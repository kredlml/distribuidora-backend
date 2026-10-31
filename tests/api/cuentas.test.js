// E2E de cuentas de la tienda y correos: "¿Olvidaste tu contraseña?" (enlace de un solo uso),
// cambio de contraseña, cierre de sesiones (token_version), avisos por correo de cada estado del
// pedido y de las devoluciones, direcciones de correo peligrosas y cuerpos comprimidos.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const zlib = require("zlib");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18072;
const CORREOS = path.join(SALIDAS, "correos-cuentas");
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", CORREO_MODO: "archivo", CORREO_CARPETA: CORREOS, SMTP_HOST: "",
  TIENDA_URL: "https://tienda.ejemplo.gt/",
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
  const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
const correos = () => (fs.existsSync(CORREOS) ? fs.readdirSync(CORREOS).sort().map((f) => JSON.parse(fs.readFileSync(path.join(CORREOS, f), "utf8"))) : []);
const esperarCorreos = async (cond, n = 1) => { for (let i = 0; i < 25; i++) { const c = correos().filter(cond); if (c.length >= n) return c; await sleep(150); } return correos().filter(cond); };
// Cada solicitud desde una IP distinta (X-Forwarded-For; el servidor confía en 1 proxy) para no
// chocar con el límite de intentos, salvo la prueba del propio límite.
let ipSeq = 0;
const olvide = (body) => call("POST", "/api/tienda/auth/olvide", body, undefined, { "X-Forwarded-For": `10.0.0.${++ipSeq}` });
// Enlace del correo de restablecimiento -> { correo, token }
const enlaceDe = (c) => { const u = new URL(c.boton.url); return { url: u, correo: u.searchParams.get("correo"), token: u.searchParams.get("token") }; };

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  fs.rmSync(CORREOS, { recursive: true, force: true });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const out = fs.openSync(path.join(SALIDAS, "cuentas-servidor.log"), "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
  try {
    let listo = false;
    for (let i = 0; i < 160 && !listo; i++) {
      await sleep(500);
      try { listo = (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Cliente' AND column_name IN ('reset_token_hash','reset_expira','token_version')`))[0].n === 3 && (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1; } catch {}
    }
    check("el servidor agrega reset_token_hash, reset_expira y token_version a Cliente", listo);
    await sleep(1500);

    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Blusa',100,1,true,'M',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (50,1,1,'A','DISPONIBLE')`);
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "D", email: "dist@t.com", password: "Clave1234" });
    const tokDist = (await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" })).data.token;
    await call("POST", "/api/auth/registro", { nombre: "Caja", apellido: "C", puesto: "CAJERO", email: "caja@t.com", password: "Clave1234", id_sucursal: 1 }, tokDist);
    const tokCaja = (await call("POST", "/api/auth/login", { email: "caja@t.com", password: "Clave1234" })).data.token;

    // ==== Restablecer contraseña
    console.log("\n== ¿Olvidaste tu contraseña?");
    let r = await call("POST", "/api/tienda/auth/registro", { nombre: "Ana", apellido: "Web", email: "ana@x.com", password: "Original123" });
    const tokAnaViejo = r.data.token;
    check("registro devuelve token sin campos internos", r.status === 201 && !("token_version" in r.data.cliente) && !("reset_token_hash" in r.data.cliente), r.data);
    r = await olvide({ email: "no-es-correo" });
    check("correo inválido -> 400", r.status === 400, r);
    const rExiste = await olvide({ email: " ANA@x.com " });
    const rNoExiste = await olvide({ email: "nadie@x.com" });
    check("misma respuesta exista o no la cuenta (no revela correos)", rExiste.status === 200 && rNoExiste.status === 200 && rExiste.data.message === rNoExiste.data.message, [rExiste, rNoExiste]);
    const [c1] = await esperarCorreos((c) => c.etiqueta === "restablecer_password" && c.para === "ana@x.com");
    check("llega el correo con enlace a la tienda configurada (TIENDA_URL)", c1 && c1.boton.url.startsWith("https://tienda.ejemplo.gt/restablecer?") && enlaceDe(c1).correo === "ana@x.com" && /^[0-9a-f]{64}$/.test(enlaceDe(c1).token), c1 && c1.boton);
    check("a un correo sin cuenta no se envía nada", correos().every((c) => c.para !== "nadie@x.com"));
    const fila = (await q(`SELECT reset_token_hash, reset_expira FROM "Cliente" WHERE email='ana@x.com'`))[0];
    check("en la base solo queda el hash del enlace (no el token) y vence en ~1 h", fila.reset_token_hash && fila.reset_token_hash !== enlaceDe(c1).token && Math.abs(new Date(fila.reset_expira) - Date.now() - 3600e3) < 120e3, fila);
    r = await call("GET", "/api/clientes?email=ana@x.com", undefined, tokCaja);
    check("el panel tampoco expone los campos de restablecimiento", r.status === 200 && JSON.stringify(r.data).indexOf("reset_") === -1 && JSON.stringify(r.data).indexOf("token_version") === -1, r.data);

    // Pide otro: el primero deja de servir.
    await olvide({ email: "ana@x.com" });
    const todos = await esperarCorreos((c) => c.etiqueta === "restablecer_password" && c.para === "ana@x.com", 2);
    const c2 = todos[todos.length - 1];
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ana@x.com", token: enlaceDe(c1).token, password: "Nueva12345" });
    check("el enlace anterior deja de valer al pedir otro -> 400", r.status === 400, r);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ana@x.com", token: enlaceDe(c2).token, password: "corta" });
    check("contraseña corta -> 400", r.status === 400, r);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ana@x.com", token: enlaceDe(c2).token, password: "ñ".repeat(40) });
    check("contraseña de más de 72 bytes -> 400", r.status === 400 && /72/.test(r.data.message), r);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "otra@x.com", token: enlaceDe(c2).token, password: "Nueva12345" });
    check("token de otra cuenta -> 400", r.status === 400, r);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ana@x.com", token: "zz", password: "Nueva12345" });
    check("token con formato inválido -> 400 (no 500)", r.status === 400, r);
    r = await call("GET", "/api/tienda/perfil", undefined, tokAnaViejo);
    check("la sesión sigue abierta mientras no se cambie la contraseña", r.status === 200, r);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ANA@x.com", token: enlaceDe(c2).token, password: "Nueva12345" });
    check("restablecer 200 con sesión nueva", r.status === 200 && r.data.token && r.data.cliente.email === "ana@x.com" && !("password" in r.data.cliente), r.data);
    const tokAnaNuevo = r.data.token;
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ana@x.com", token: enlaceDe(c2).token, password: "Otra123456" });
    check("el enlace es de un solo uso -> 400", r.status === 400, r);
    r = await call("GET", "/api/tienda/perfil", undefined, tokAnaViejo);
    check("la sesión anterior se cerró (401)", r.status === 401 && /contraseña cambió/.test(r.data.message), r);
    r = await call("GET", "/api/tienda/perfil", undefined, tokAnaNuevo);
    check("la sesión nueva funciona", r.status === 200, r);
    check("login con la contraseña vieja falla y con la nueva entra", (await call("POST", "/api/tienda/auth/login", { email: "ana@x.com", password: "Original123" })).status === 401 && (await call("POST", "/api/tienda/auth/login", { email: "ana@x.com", password: "Nueva12345" })).status === 200);
    check("correo de aviso: tu contraseña cambió", (await esperarCorreos((c) => c.etiqueta === "password_cambiada" && c.para === "ana@x.com")).length === 1);
    const aud = (await q(`SELECT accion FROM auditoria WHERE tabla_afectada='Cliente' ORDER BY id_auditoria`)).map((a) => a.accion);
    check("auditoría: solicitudes y restablecimiento", aud.filter((a) => a === "CLIENTE_RESTABLECIMIENTO_SOLICITADO").length === 2 && aud.includes("CLIENTE_PASSWORD_RESTABLECIDA"), aud);

    // Enlace vencido
    await olvide({ email: "ana@x.com" });
    const c3 = (await esperarCorreos((c) => c.etiqueta === "restablecer_password" && c.para === "ana@x.com", 3)).pop();
    await q(`UPDATE "Cliente" SET reset_expira=now() - interval '1 minute' WHERE email='ana@x.com'`);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "ana@x.com", token: enlaceDe(c3).token, password: "Vencida123" });
    check("enlace vencido -> 400", r.status === 400 && /venció/.test(r.data.message), r);

    // Cliente de mostrador (sin contraseña) crea su cuenta con el enlace del correo
    console.log("\n== Cliente de mostrador");
    r = await call("POST", "/api/clientes", { nombre: "María", apellido: "Mostrador", email: "maria@x.com" }, tokCaja);
    const idMaria = r.data.id_cliente;
    await olvide({ email: "maria@x.com" });
    const cm = (await esperarCorreos((c) => c.etiqueta === "restablecer_password" && c.para === "maria@x.com"))[0];
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "maria@x.com", token: enlaceDe(cm).token, password: "Maria12345" });
    check("la clienta de mostrador crea su contraseña con el enlace y conserva su ficha", r.status === 200 && r.data.cliente.id_cliente === idMaria, r.data);
    check("auditoría lo registra como creación de cuenta web", (await q(`SELECT count(*)::int n FROM auditoria WHERE accion='CLIENTE_PASSWORD_RESTABLECIDA' AND detalles LIKE '%creó su contraseña%'`))[0].n === 1);
    r = await call("GET", "/api/clientes?email=maria@x.com", undefined, tokCaja);
    const fichaMaria = Array.isArray(r.data) ? r.data[0] : r.data;
    check("el panel la ve con cuenta web", r.status === 200 && fichaMaria && fichaMaria.id_cliente === idMaria && fichaMaria.tiene_cuenta_web === true, r.data);
    await q(`UPDATE "Cliente" SET activo=false WHERE email='maria@x.com'`);
    const antes = correos().filter((c) => c.para === "maria@x.com" && c.etiqueta === "restablecer_password").length;
    r = await olvide({ email: "maria@x.com" });
    await sleep(500);
    check("cuenta desactivada: misma respuesta pero no se envía enlace", r.status === 200 && correos().filter((c) => c.para === "maria@x.com" && c.etiqueta === "restablecer_password").length === antes);
    await q(`UPDATE "Cliente" SET activo=true WHERE email='maria@x.com'`);

    // ==== Cambiar contraseña con sesión
    console.log("\n== Cambiar contraseña desde el perfil");
    const tokOtroDispositivo = (await call("POST", "/api/tienda/auth/login", { email: "ana@x.com", password: "Nueva12345" })).data.token;
    r = await call("PUT", "/api/tienda/perfil/password", { actual: "mala", nueva: "Cambiada123" }, tokAnaNuevo);
    check("contraseña actual incorrecta -> 400", r.status === 400, r);
    r = await call("PUT", "/api/tienda/perfil/password", { actual: "Nueva12345", nueva: "Nueva12345" }, tokAnaNuevo);
    check("la nueva igual a la actual -> 400", r.status === 400, r);
    r = await call("PUT", "/api/tienda/perfil/password", { actual: "Nueva12345", nueva: "Cambiada123" });
    check("sin sesión -> 403", r.status === 403, r);
    r = await call("PUT", "/api/tienda/perfil/password", { actual: "Nueva12345", nueva: "Cambiada123" }, tokAnaNuevo);
    check("cambio 200 con token nuevo", r.status === 200 && r.data.token, r);
    const tokAnaFinal = r.data.token;
    check("cierra las sesiones de otros dispositivos", (await call("GET", "/api/tienda/perfil", undefined, tokOtroDispositivo)).status === 401 && (await call("GET", "/api/tienda/perfil", undefined, tokAnaNuevo)).status === 401);
    check("este dispositivo sigue con el token nuevo", (await call("GET", "/api/tienda/perfil", undefined, tokAnaFinal)).status === 200);

    console.log("\n== Enlaces y sesiones que deben dejar de valer");
    // Cambiar la contraseña anula un enlace de restablecimiento pendiente.
    await call("POST", "/api/tienda/auth/registro", { nombre: "Rita", apellido: "X", email: "rita@x.com", password: "Rita12345" });
    let tokRita = (await call("POST", "/api/tienda/auth/login", { email: "rita@x.com", password: "Rita12345" })).data.token;
    await olvide({ email: "rita@x.com" });
    const cr = (await esperarCorreos((c) => c.etiqueta === "restablecer_password" && c.para === "rita@x.com"))[0];
    r = await call("PUT", "/api/tienda/perfil/password", { actual: "Rita12345", nueva: "Rita67890" }, tokRita);
    tokRita = r.data.token;
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "rita@x.com", token: enlaceDe(cr).token, password: "Robada123" });
    check("tras cambiar la contraseña, el enlace pendiente ya no sirve", r.status === 400, r);
    // Desactivar y reactivar: las sesiones de antes no vuelven a valer.
    const idRita = (await call("GET", "/api/clientes?email=rita@x.com", undefined, tokDist)).data[0].id_cliente;
    await call("PUT", `/api/clientes/${idRita}`, { activo: false }, tokDist);
    await call("PUT", `/api/clientes/${idRita}`, { activo: true }, tokDist);
    r = await call("GET", "/api/tienda/perfil", undefined, tokRita);
    check("desactivar a una clienta cierra sus sesiones aunque luego se reactive", r.status === 401, r);
    // Un enlace enviado al correo equivocado deja de valer cuando caja corrige el correo.
    r = await call("POST", "/api/clientes", { nombre: "Tere", apellido: "M", email: "equivocado@x.com" }, tokCaja);
    const idTere = r.data.id_cliente;
    await olvide({ email: "equivocado@x.com" });
    const ct = (await esperarCorreos((c) => c.etiqueta === "restablecer_password" && c.para === "equivocado@x.com"))[0];
    await call("PUT", `/api/clientes/${idTere}`, { email: "tere@x.com" }, tokCaja);
    r = await call("POST", "/api/tienda/auth/restablecer", { email: "tere@x.com", token: enlaceDe(ct).token, password: "Ajena12345" }, undefined, { "X-Forwarded-For": "10.5.5.5" });
    check("caja corrige el correo: el enlace enviado al correo anterior ya no sirve", r.status === 400 && /no es válido/.test(r.data.message), r);

    // ==== Avisos por correo del pedido
    console.log("\n== Correos del pedido");
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, direccion_entrega: "Zona 10", detalles: [{ id_producto: 1, cantidad: 1 }] }, tokAnaFinal);
    const idP = r.data.pedido.id_pedido;
    r = await call("POST", `/api/tienda/pedidos/${idP}/pago`, undefined, tokAnaFinal);
    check("pago simulado aprobado", r.status === 200 || r.status === 201, r);
    const [cp] = await esperarCorreos((c) => c.etiqueta === "pedido_pagado" && c.para === "ana@x.com");
    check("correo: pago recibido con enlace al pedido", cp && /#\d+/.test(cp.asunto) && cp.boton.url === `https://tienda.ejemplo.gt/pedidos/${idP}`, cp);
    await call("PUT", `/api/pedidos/${idP}/estado`, { estado: "ENVIADO" }, tokDist);
    check("correo: pedido enviado", (await esperarCorreos((c) => c.etiqueta === "pedido_enviado")).length === 1);
    await call("PUT", `/api/pedidos/${idP}/estado`, { estado: "ENTREGADO" }, tokDist);
    const [ce] = await esperarCorreos((c) => c.etiqueta === "pedido_entregado");
    check("correo: entregado, con el plazo para cambios", ce && /una sola solicitud/.test(ce.texto), ce);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: idP, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1`, [idP]))[0].id_detalle_pedido, cantidad: 1 }] }, tokAnaFinal);
    check("correo: recibimos tu solicitud de devolución", r.status === 201 && (await esperarCorreos((c) => c.etiqueta === "devolucion_solicitada")).length === 1);
    r = await call("POST", "/api/pedidos", { id_cliente: idMaria, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tokCaja);
    const idPm = r.data.pedido.id_pedido;
    await call("PUT", `/api/pedidos/${idPm}/estado`, { estado: "CANCELADO" }, tokCaja);
    check("correo: pedido cancelado por la tienda", (await esperarCorreos((c) => c.etiqueta === "pedido_cancelado" && c.para === "maria@x.com")).length === 1);
    r = await call("POST", "/api/pedidos", { id_cliente: idMaria, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tokCaja);
    await call("POST", "/api/pagos", { id_pedido: r.data.pedido.id_pedido, metodo_pago: "EFECTIVO", monto: 100 }, tokCaja);
    check("correo: pago en caja también avisa (pedido pagado)", (await esperarCorreos((c) => c.etiqueta === "pedido_pagado" && c.para === "maria@x.com")).length === 1);
    r = await call("POST", "/api/pedidos", { id_cliente: idMaria, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tokCaja);
    const fallido = await call("POST", "/api/pagos", { id_pedido: r.data.pedido.id_pedido, metodo_pago: "EFECTIVO", monto: 999 }, tokCaja);
    await sleep(400);
    check("un pago rechazado (rollback) no manda correo de pagado", fallido.status === 400 && correos().filter((c) => c.etiqueta === "pedido_pagado" && c.para === "maria@x.com").length === 1);
    await q(`INSERT INTO "Cliente"(nombre,apellido,email,activo,password) VALUES ('<script>alert(1)</script>','X','eva@x.com',true,'x')`);
    await olvide({ email: "eva@x.com" });
    const [cx] = await esperarCorreos((c) => c.para === "eva@x.com");
    check("los correos escapan el HTML de los datos (nombre con <script>)", cx && cx.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !cx.html.includes("<script>"), cx && cx.html.slice(0, 300));

    // ==== Direcciones peligrosas y cuerpos comprimidos
    console.log("\n== Seguridad");
    await q(`INSERT INTO "Cliente"(nombre,apellido,email,activo,password) VALUES ('Evil','X','"a>b"@x.com',true,'x')`);
    r = await olvide({ email: '"a>b"@x.com' });
    await sleep(500);
    check("dirección con comillas/'>' se rechaza y no se envía nada (protege el parser de nodemailer)", r.status === 400 && correos().every((c) => !c.para.includes('"')), r);
    r = await call("POST", "/api/tienda/auth/registro", { nombre: "Q", apellido: "X", email: "maria.o'neil@x.com", password: "12345678" });
    check("registro con un correo al que no se podría escribir -> 400", r.status === 400, r);
    // Límite por correo: más de 3 enlaces por hora al mismo correo no se envían (aunque cambie la IP).
    await call("POST", "/api/tienda/auth/registro", { nombre: "Lim", apellido: "X", email: "lim@x.com", password: "12345678" });
    for (let i = 0; i < 5; i++) r = await olvide({ email: "lim@x.com" });
    await sleep(600);
    check("más de 3 enlaces por hora al mismo correo: misma respuesta, pero no se envían", r.status === 200 && correos().filter((c) => c.para === "lim@x.com" && c.etiqueta === "restablecer_password").length === 3);
    let distintas = 0;
    for (const ruta of ["/api/tienda/auth/OLVIDE", "/api/tienda/auth/olvide/", "/API/TIENDA/auth/Olvide"]) {
      const x = await call("POST", ruta, { email: "zz@x.com" }, undefined, { "X-Forwarded-For": "10.7.7.7" });
      if (x.status === 200) distintas++;
    }
    for (let i = 0; i < 3; i++) await call("POST", "/api/tienda/auth/olvide", { email: "zz@x.com" }, undefined, { "X-Forwarded-For": "10.7.7.7" });
    r = await call("POST", "/api/tienda/auth/OLVIDE/", { email: "zz@x.com" }, undefined, { "X-Forwarded-For": "10.7.7.7" });
    check("variantes de mayúsculas o barra final comparten el contador (no esquivan el límite)", distintas === 3 && r.status === 429, [distintas, r.status]);
    const gz = zlib.gzipSync(JSON.stringify({ email: "ana@x.com", password: "Cambiada123" }));
    r = await call("POST", "/api/tienda/auth/login", gz, undefined, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    check("cuerpo comprimido rechazado (415)", r.status === 415, r);
    let limitado = false;
    for (let i = 0; i < 6 && !limitado; i++) limitado = (await call("POST", "/api/tienda/auth/olvide", { email: "ana@x.com" }, undefined, { "X-Forwarded-For": "10.9.9.9" })).status === 429;
    check("límite de intentos en «olvidé mi contraseña» (429)", limitado);
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
