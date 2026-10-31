// E2E de la gestión del panel: tipos de prenda, sucursales, bajas de stock y empleados.
// Postgres desechable (54329) + servidor en puerto propio. Nunca usa el 8080 del usuario.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18085;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  DB_PORT: "54329", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
};
const fails = [];
let passes = 0;
function check(name, cond, info) {
  if (cond) { passes++; console.log("  ok  " + name); }
  else { fails.push(name); console.log("  FAIL " + name + (info !== undefined ? "  -> " + JSON.stringify(info).slice(0, 500) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, params) => (await pg.query(sql, params)).rows;
async function call(method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
const puertoOcupado = (port) => new Promise((res) => {
  const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); });
  s.on("error", () => res(false));
});
function arrancar(log) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
}
async function esperarSync(cond) {
  for (let i = 0; i < 160; i++) { await sleep(500); try { if (await cond()) return true; } catch {} }
  return false;
}
const tablas = async () => (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`))[0].n;
const enumTiene = async (v) => (await q(`SELECT count(*)::int n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='enum_MovimientoInventario_tipo_movimiento' AND e.enumlabel=$1`, [v]))[0].n === 1;
const colActivo = async () => (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Empleado' AND column_name='activo'`))[0].n === 1;

(async () => {
  if (await puertoOcupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv;
  try {
    // ---- Fase 1: esquema completo, luego se "envejece" para imitar una base existente
    srv = arrancar("server-admin-1.log");
    await esperarSync(async () => (await tablas()) >= 14 && (await enumTiene("AJUSTE_SALIDA")));
    await sleep(2500);
    srv.kill(); await sleep(1500);
    await q(`ALTER TABLE "Empleado" DROP COLUMN activo`);
    await q(`INSERT INTO "Empleado"(nombre,apellido,puesto,email,password) VALUES ('Viejo','Admin','Admin','Viejo@T.com','$2a$08$abcdefghijklmnopqrstuuJ9WcSxk4rAkhn5nO8m4p7FQFzP8C7nK')`);
    await q(`ALTER TYPE "enum_MovimientoInventario_tipo_movimiento" RENAME TO enum_viejo`);
    await q(`CREATE TYPE "enum_MovimientoInventario_tipo_movimiento" AS ENUM ('VENTA','DEVOLUCION_SOLICITADA','DEVOLUCION_RECIBIDA','EN_REVISION','REINTEGRACION','CAMBIO_SALIDA','CAMBIO_ENTRADA','PRODUCTO_DANADO','PRODUCTO_DEFECTUOSO','CANCELACION')`);
    await q(`ALTER TABLE "MovimientoInventario" ALTER COLUMN tipo_movimiento TYPE "enum_MovimientoInventario_tipo_movimiento" USING tipo_movimiento::text::"enum_MovimientoInventario_tipo_movimiento"`);
    await q(`DROP TYPE enum_viejo`);
    // Una base de antes de las migraciones (manejada con sync alter) no tiene SequelizeMeta.
    await q(`DROP TABLE IF EXISTS "SequelizeMeta"`);
    check("base envejecida: sin columna activo ni valor AJUSTE_SALIDA", !(await colActivo()) && !(await enumTiene("AJUSTE_SALIDA")));

    // ---- Fase 2: arranque sobre la base existente (lo que pasará en la base real)
    srv = arrancar("server-admin-2.log");
    const migro = await esperarSync(async () => (await colActivo()) && (await enumTiene("AJUSTE_SALIDA")));
    await sleep(2500);
    check("migración automática: agrega Empleado.activo y AJUSTE_SALIDA", migro);
    const viejo = (await q(`SELECT activo FROM "Empleado" WHERE email='Viejo@T.com'`))[0];
    check("empleados existentes quedan activos", viejo && viejo.activo === true, viejo);
    await q(`DELETE FROM "Empleado"`);

    // ---- Seed
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Camisas'),('Pantalones')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Camisa',150,5,true,'M',1),('Jeans',300,5,true,'32',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (10,1,1,'A','DISPONIBLE'),(5,1,1,'B','DISPONIBLE'),(3,1,1,'C','DANADA'),(7,2,1,'D','DISPONIBLE'),(4,1,2,'E','DISPONIBLE')`);
    await q(`INSERT INTO "Cliente"(nombre,apellido,email,activo,id_sucursal) VALUES ('Cli','Uno','c1@x.com',true,1)`);

    const tok = {};
    // Registro inicial en carrera: varios a la vez con la base vacía -> un solo ADMIN.
    const carrera = await Promise.all([
      call("POST", "/api/auth/registro", { nombre: "Admin", apellido: "Uno", email: "Admin@T.com", password: "Clave1234" }),
      call("POST", "/api/auth/registro", { nombre: "Intruso", apellido: "1", email: "intruso1@t.com", password: "Clave1234" }),
      call("POST", "/api/auth/registro", { nombre: "Intruso", apellido: "2", email: "intruso2@t.com", password: "Clave1234" }),
    ]);
    const creados = await q(`SELECT email FROM "Empleado"`);
    check("registro inicial simultáneo: solo uno queda como ADMIN", creados.length === 1 && carrera.filter((x) => x.status === 201).length === 1, [carrera.map((x) => x.status), creados]);
    if (creados[0].email !== "admin@t.com") await q(`UPDATE "Empleado" SET email='admin@t.com', nombre='Admin', apellido='Uno'`);
    let r = carrera[0];
    check("registro inicial ADMIN (email se guarda en minúsculas)", (await q(`SELECT email FROM "Empleado"`))[0].email === "admin@t.com", r);
    r = await call("POST", "/api/auth/registro", { nombre: "Tarde", email: "tarde@t.com", password: "Clave1234" });
    check("con un empleado ya registrado, registro sin token -> 403", r.status === 403, r);
    tok.ADMIN = (await call("POST", "/api/auth/login", { email: "ADMIN@t.com", password: "Clave1234" })).data.token;
    check("login sin distinguir mayúsculas en el correo", !!tok.ADMIN);
    for (const [puesto, email] of [["CAJERO", "caja@t.com"], ["BODEGUERO", "bodega@t.com"], ["DISTRITAL", "admin2@t.com"]]) {
      r = await call("POST", "/api/auth/registro", { nombre: puesto, apellido: "T", puesto, email, password: "Clave1234", id_sucursal: 1 }, tok.ADMIN);
      check(`ADMIN registra ${puesto}`, r.status === 201, r);
      tok[email] = (await call("POST", "/api/auth/login", { email, password: "Clave1234" })).data.token;
    }
    tok.CAJERO = tok["caja@t.com"]; tok.BODEGUERO = tok["bodega@t.com"]; tok.ADMIN2 = tok["admin2@t.com"];
    const id = async (email) => (await q(`SELECT id_empleado FROM "Empleado" WHERE email=$1`, [email]))[0].id_empleado;
    const idAdmin = await id("admin@t.com"), idAdmin2 = await id("admin2@t.com"), idCaja = await id("caja@t.com"), idBod = await id("bodega@t.com");

    console.log("\n== Login y contraseñas");
    const a = await call("POST", "/api/auth/login", { email: "noexiste@t.com", password: "Clave1234" });
    const b = await call("POST", "/api/auth/login", { email: "admin@t.com", password: "malaclave1" });
    check("login: mismo 401 y mensaje para correo inexistente y clave mala", a.status === 401 && b.status === 401 && a.data.message === b.data.message, [a, b]);
    r = await call("POST", "/api/auth/registro", { nombre: "X", puesto: "CAJERO", email: "corta@t.com", password: "1234567" }, tok.ADMIN);
    check("registro: contraseña < 8 -> 400", r.status === 400, r);
    r = await call("POST", "/api/auth/registro", { nombre: "X", puesto: "CAJERO", email: "larga@t.com", password: "x".repeat(73) }, tok.ADMIN);
    check("registro: contraseña > 72 -> 400", r.status === 400, r);
    r = await call("POST", "/api/auth/registro", { nombre: "X", puesto: "CAJERO", email: "CAJA@t.com", password: "Clave1234" }, tok.ADMIN);
    check("registro: email duplicado sin distinguir mayúsculas -> 400", r.status === 400, r);
    r = await call("POST", "/api/auth/registro", { nombre: "X", puesto: "CAJERO", email: "no-es-correo", password: "Clave1234" }, tok.ADMIN);
    check("registro: email inválido -> 400", r.status === 400, r);
    r = await call("GET", "/api/auth/yo", undefined, tok.CAJERO);
    check("GET /api/auth/yo devuelve el puesto y no la contraseña", r.status === 200 && r.data.puesto === "CAJERO" && !("password" in r.data), r);
    r = await call("PUT", "/api/auth/password", { actual: "incorrecta1", nueva: "NuevaClave1" }, tok.CAJERO);
    check("cambiar contraseña con la actual mala -> 400 (no cierra sesión)", r.status === 400, r);
    r = await call("PUT", "/api/auth/password", { actual: "Clave1234", nueva: "corta" }, tok.CAJERO);
    check("cambiar contraseña: nueva corta -> 400", r.status === 400, r);
    r = await call("PUT", "/api/auth/password", { actual: "Clave1234", nueva: "Clave1234" }, tok.CAJERO);
    check("cambiar contraseña: igual a la actual -> 400", r.status === 400, r);
    const tokCajaOtraSesion = (await call("POST", "/api/auth/login", { email: "caja@t.com", password: "Clave1234" })).data.token;
    r = await call("PUT", "/api/auth/password", { actual: "Clave1234", nueva: "NuevaClave1" }, tok.CAJERO);
    check("cambiar contraseña 200 y devuelve token nuevo", r.status === 200 && !!r.data.token, r);
    const tokViejo = tok.CAJERO;
    tok.CAJERO = r.data.token;
    check("tras cambiar la contraseña, el token anterior deja de servir", (await call("GET", "/api/auth/yo", undefined, tokViejo)).status === 401);
    check("…y también el de otra sesión abierta", (await call("GET", "/api/auth/yo", undefined, tokCajaOtraSesion)).status === 401);
    check("el token nuevo sí sirve", (await call("GET", "/api/auth/yo", undefined, tok.CAJERO)).status === 200);
    check("login con la nueva contraseña", (await call("POST", "/api/auth/login", { email: "caja@t.com", password: "NuevaClave1" })).status === 200);
    check("login con la vieja falla", (await call("POST", "/api/auth/login", { email: "caja@t.com", password: "Clave1234" })).status === 401);
    const pw = (await q(`SELECT password FROM "Empleado" WHERE id_empleado=$1`, [idCaja]))[0].password;
    check("hash nuevo con bcrypt costo 10", pw.startsWith("$2a$10$") || pw.startsWith("$2b$10$"), pw.slice(0, 7));
    const audPw = await q(`SELECT detalles FROM auditoria WHERE accion='EMPLEADO_PASSWORD_CAMBIADA'`);
    check("auditoría del cambio sin la contraseña", audPw.length === 1 && !audPw[0].detalles.includes("NuevaClave1"), audPw);

    console.log("\n== Empleados");
    r = await call("GET", "/api/empleados", undefined, tok.CAJERO);
    check("GET /api/empleados con CAJERO -> 403", r.status === 403, r);
    r = await call("GET", "/api/empleados", undefined, tok.BODEGUERO);
    check("GET /api/empleados con BODEGUERO -> 403", r.status === 403, r);
    r = await call("GET", "/api/empleados", undefined, tok.ADMIN);
    check("GET /api/empleados ADMIN: sin hashes, con sucursal y tiene_acceso", r.status === 200 && r.data.length === 4 && r.data.every((e) => !("password" in e) && e.tiene_acceso === true) && r.data.some((e) => e.Sucursal && e.Sucursal.nombre === "Centro"), r.data);
    r = await call("PUT", `/api/empleados/${idCaja}`, { puesto: "ADMIN" }, tok.CAJERO);
    check("CAJERO no puede ascenderse -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { puesto: "SUPERUSER" }, tok.ADMIN);
    check("puesto inválido -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { email: "BODEGA@t.com" }, tok.ADMIN);
    check("email de otro empleado -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { id_sucursal: 999 }, tok.ADMIN);
    check("sucursal inexistente -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { activo: "no" }, tok.ADMIN);
    check("activo no booleano -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, {}, tok.ADMIN);
    check("sin cambios -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/9999`, { nombre: "X" }, tok.ADMIN);
    check("empleado inexistente -> 404", r.status === 404, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { password: "hackeada1", id_empleado: 77, nombre: "Carla" }, tok.ADMIN);
    const caja = (await q(`SELECT id_empleado, nombre, password FROM "Empleado" WHERE id_empleado=$1`, [idCaja]))[0];
    check("PUT ignora password e id del body (lista blanca)", r.status === 200 && caja.nombre === "Carla" && caja.password === pw && !("password" in r.data), r);

    // Cambio de puesto efectivo sin volver a iniciar sesión
    r = await call("POST", "/api/inventario/ajustes", { id_sucursal: 1, motivo: "PERDIDA", ajustes: [{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 9 }] }, tok.CAJERO);
    check("CAJERO no puede dar de baja stock -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { puesto: "BODEGUERO" }, tok.ADMIN);
    check("ADMIN cambia CAJERO a BODEGUERO", r.status === 200 && r.data.puesto === "BODEGUERO", r);
    r = await call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.CAJERO);
    check("cambiarle el puesto cierra su sesión (y su token viejo ya no sirve)", r.status === 401, r);
    r = await call("PUT", `/api/empleados/${idCaja}`, { puesto: "CAJERO" }, tok.ADMIN);
    tok.CAJERO = (await call("POST", "/api/auth/login", { email: "caja@t.com", password: "NuevaClave1" })).data.token;

    // Autoprotección y último ADMIN
    r = await call("PUT", `/api/empleados/${idAdmin}`, { activo: false }, tok.ADMIN);
    check("ADMIN no puede desactivarse -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idAdmin}`, { puesto: "CAJERO" }, tok.ADMIN);
    check("ADMIN no puede quitarse el puesto -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idAdmin}`, { nombre: "Admin Editado" }, tok.ADMIN);
    check("ADMIN sí puede editar su propio nombre", r.status === 200, r);
    // Una ficha ADMIN sin contraseña no cuenta como administrador utilizable.
    r = await call("POST", "/api/empleados", { nombre: "Fantasma", apellido: "Admin", puesto: "DISTRITAL", id_sucursal: 1, email: "fantasma@t.com" }, tok.ADMIN);
    check("ficha ADMIN sin contraseña creada", r.status === 201 && !("password" in r.data) && !("token_version" in r.data), r);
    // Ambos ADMIN intentan desactivarse mutuamente a la vez: siempre debe quedar uno que pueda entrar.
    const [x1, x2] = await Promise.all([
      call("PUT", `/api/empleados/${idAdmin2}`, { activo: false }, tok.ADMIN),
      call("PUT", `/api/empleados/${idAdmin}`, { activo: false }, tok.ADMIN2),
    ]);
    const adminsActivos = (await q(`SELECT count(*)::int n FROM "Empleado" WHERE upper(puesto)='DISTRITAL' AND activo AND password IS NOT NULL`))[0].n;
    check("desactivación cruzada simultánea: queda al menos un DISTRITAL con acceso", adminsActivos >= 1 && [x1.status, x2.status].filter((s) => s === 200).length <= 1, [x1.status, x2.status, adminsActivos]);
    const adminVivo = (await q(`SELECT email FROM "Empleado" WHERE upper(puesto)='DISTRITAL' AND activo AND password IS NOT NULL ORDER BY id_empleado LIMIT 1`))[0].email;
    tok.ADMIN = adminVivo === "admin@t.com" ? tok.ADMIN : tok.ADMIN2;

    // Desactivar corta el acceso al instante
    r = await call("PUT", `/api/empleados/${idBod}`, { activo: false }, tok.ADMIN);
    check("ADMIN desactiva al BODEGUERO", r.status === 200 && r.data.activo === false, r);
    r = await call("GET", "/api/auth/yo", undefined, tok.BODEGUERO);
    check("token del desactivado -> 401 (el panel cierra la sesión)", r.status === 401, r);
    r = await call("POST", "/api/categorias", { nombre: "Hackeo" }, tok.BODEGUERO);
    check("desactivado no puede operar -> 401", r.status === 401, r);
    r = await call("POST", "/api/auth/login", { email: "bodega@t.com", password: "Clave1234" });
    check("login del desactivado (clave correcta) -> 403", r.status === 403 && r.data.token === null, r);
    r = await call("POST", "/api/auth/login", { email: "bodega@t.com", password: "malaclave1" });
    check("login del desactivado (clave mala) -> 401, no revela que existe", r.status === 401, r);
    r = await call("PUT", `/api/empleados/${idBod}/password`, { password: "Temporal1" }, tok.ADMIN);
    check("ADMIN restablece contraseña", r.status === 200, r);
    r = await call("PUT", `/api/empleados/${idBod}/password`, { password: "corta" }, tok.ADMIN);
    check("restablecer con contraseña corta -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${idBod}/password`, { password: "Temporal1" }, tok.CAJERO);
    check("CAJERO no puede restablecer contraseñas -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${idBod}`, { activo: true }, tok.ADMIN);
    check("reactivar no revive el token anterior", (await call("GET", "/api/auth/yo", undefined, tok.BODEGUERO)).status === 401);
    tok.BODEGUERO = (await call("POST", "/api/auth/login", { email: "bodega@t.com", password: "Temporal1" })).data.token;
    check("reactivado entra con la contraseña temporal", !!tok.BODEGUERO);
    const tokBodAntes = tok.BODEGUERO;
    await call("PUT", `/api/empleados/${idBod}/password`, { password: "Temporal2" }, tok.ADMIN);
    check("restablecer contraseña cierra la sesión abierta del empleado", (await call("GET", "/api/auth/yo", undefined, tokBodAntes)).status === 401);
    tok.BODEGUERO = (await call("POST", "/api/auth/login", { email: "bodega@t.com", password: "Temporal2" })).data.token;
    // Ficha sin contraseña (POST /api/empleados): mismas validaciones que el registro
    r = await call("POST", "/api/empleados", { nombre: "Ficha", apellido: "X", puesto: "CAJERO", id_sucursal: 1, email: "ADMIN@t.com" }, tok.ADMIN);
    check("ficha con correo de otro empleado (mayúsculas) -> 400", r.status === 400, r);
    r = await call("POST", "/api/empleados", { nombre: "Ficha", apellido: "X", puesto: "CAJERO", id_sucursal: 1, email: "no-es-correo" }, tok.ADMIN);
    check("ficha con correo inválido -> 400", r.status === 400, r);
    r = await call("POST", "/api/empleados", { nombre: "Ficha", apellido: "X", puesto: "CAJERO", id_sucursal: 1, email: "ficha@t.com", activo: "abc" }, tok.ADMIN);
    check("ficha con activo no booleano -> 400", r.status === 400, r);
    r = await call("POST", "/api/empleados", { nombre: "Ficha", apellido: "X", puesto: "CAJERO", id_sucursal: 999, email: "ficha@t.com" }, tok.ADMIN);
    check("ficha con sucursal inexistente -> 400", r.status === 400, r);
    let dup = null;
    try { await q(`INSERT INTO "Empleado"(nombre,email,activo,token_version) VALUES ('Dup','ADMIN@T.COM',true,0)`); } catch (err) { dup = err.message; }
    check("la base rechaza correos repetidos sin distinguir mayúsculas (índice único)", !!dup && /unico|unique|duplicate|duplicad/i.test(dup), dup);
    const sinCorreo = (await q(`INSERT INTO "Empleado"(nombre,puesto,activo,token_version) VALUES ('SinCorreo','CAJERO',true,0) RETURNING id_empleado`))[0].id_empleado;
    r = await call("PUT", `/api/empleados/${sinCorreo}/password`, { password: "Acceso123" }, tok.ADMIN);
    check("dar acceso a un empleado sin correo -> 400", r.status === 400, r);
    r = await call("POST", "/api/empleados", { nombre: "Ficha", apellido: "X", puesto: "CAJERO", fecha_contratacion: "2026-01-01", id_sucursal: 1, email: "ficha@t.com" }, tok.ADMIN);
    const idFicha = r.data.id_empleado;
    r = await call("GET", "/api/empleados", undefined, tok.ADMIN);
    check("ficha sin contraseña: tiene_acceso=false", r.data.find((e) => e.id_empleado === idFicha).tiene_acceso === false, r.data);
    await call("PUT", `/api/empleados/${idFicha}/password`, { password: "Acceso123" }, tok.ADMIN);
    check("ficha con acceso dado puede iniciar sesión", (await call("POST", "/api/auth/login", { email: "ficha@t.com", password: "Acceso123" })).status === 200);
    const audEmp = await q(`SELECT accion FROM auditoria WHERE tabla_afectada='Empleado' ORDER BY id_auditoria`);
    check("auditoría de empleados (registro, actualización, contraseña)", ["EMPLEADO_REGISTRADO", "EMPLEADO_ACTUALIZADO", "EMPLEADO_PASSWORD_RESTABLECIDA"].every((x) => audEmp.some((a) => a.accion === x)), audEmp.map((a) => a.accion));

    console.log("\n== Tipos de prenda");
    r = await call("PUT", "/api/categorias/1", { descripcion: "Camisas de vestir" }, tok.CAJERO);
    check("CAJERO no edita tipos -> 403", r.status === 403, r);
    r = await call("PUT", "/api/categorias/1", { nombre: "  Camisas y blusas ", descripcion: "Vestir" }, tok.ADMIN);
    check("DISTRITAL edita tipo (nombre recortado)", r.status === 200 && r.data.nombre === "Camisas y blusas" && r.data.descripcion === "Vestir", r);
    r = await call("PUT", "/api/categorias/1", { descripcion: "" }, tok.ADMIN);
    check("descripción vacía -> null", r.status === 200 && r.data.descripcion === null, r);
    r = await call("PUT", "/api/categorias/1", { nombre: "PANTALONES" }, tok.ADMIN);
    check("nombre repetido (sin distinguir mayúsculas) -> 400", r.status === 400, r);
    r = await call("POST", "/api/categorias", { nombre: "pantalones" }, tok.ADMIN);
    check("crear tipo repetido -> 400 (no 500)", r.status === 400, r);
    r = await call("PUT", "/api/categorias/1", { nombre: "   " }, tok.ADMIN);
    check("nombre vacío -> 400", r.status === 400, r);
    r = await call("PUT", "/api/categorias/1", { nombre: "x".repeat(61) }, tok.ADMIN);
    check("nombre > 60 -> 400", r.status === 400, r);
    r = await call("PUT", "/api/categorias/999", { nombre: "Nada" }, tok.ADMIN);
    check("tipo inexistente -> 404", r.status === 404, r);
    r = await call("DELETE", "/api/categorias/2", undefined, tok.BODEGUERO);
    check("BODEGUERO no elimina tipos -> 403", r.status === 403, r);
    r = await call("DELETE", "/api/categorias/1", undefined, tok.ADMIN);
    check("eliminar tipo con prendas -> 409 con cuántas", r.status === 409 && /2 prenda/.test(r.data.message), r);
    r = await call("DELETE", "/api/categorias/2", undefined, tok.ADMIN);
    check("eliminar tipo sin prendas -> 200", r.status === 200 && (await q(`SELECT count(*)::int n FROM "Categoria" WHERE id_categoria=2`))[0].n === 0, r);
    r = await call("DELETE", "/api/categorias/2", undefined, tok.ADMIN);
    check("eliminar de nuevo -> 404", r.status === 404, r);
    const audCat = await q(`SELECT accion, id_empleado FROM auditoria WHERE tabla_afectada='Categoria' ORDER BY id_auditoria`);
    check("auditoría de tipos con empleado", audCat.length === 3 && audCat.every((x) => x.id_empleado) && audCat[2].accion === "CATEGORIA_ELIMINADA", audCat);

    console.log("\n== Sucursales");
    r = await call("POST", "/api/sucursales", { nombre: "Sur", direccion: "z", ciudad: "Escuintla" }, tok.BODEGUERO);
    check("BODEGUERO no crea sucursales -> 403", r.status === 403, r);
    r = await call("POST", "/api/sucursales", { nombre: "Sur", direccion: "z" }, tok.ADMIN);
    check("crear sin ciudad -> 400", r.status === 400, r);
    r = await call("POST", "/api/sucursales", { nombre: "Sur", direccion: "z", ciudad: "Escuintla", telefono: "1".repeat(21) }, tok.ADMIN);
    check("teléfono > 20 -> 400", r.status === 400, r);
    r = await call("POST", "/api/sucursales", { nombre: " Sur ", direccion: "z", ciudad: "Escuintla", id_sucursal: 50, activo: false }, tok.ADMIN);
    const idSur = r.data.id_sucursal;
    check("crear sucursal: recorta, ignora id del body, respeta activo", r.status === 201 && r.data.nombre === "Sur" && idSur !== 50 && r.data.activo === false, r);
    r = await call("PUT", `/api/sucursales/${idSur}`, { activo: true, telefono: "" }, tok.ADMIN);
    check("editar sucursal 200 (teléfono vacío -> null)", r.status === 200 && r.data.sucursal.activo === true && r.data.sucursal.telefono === null, r);
    r = await call("PUT", "/api/sucursales/999", { nombre: "X" }, tok.ADMIN);
    check("editar inexistente -> 404", r.status === 404, r);
    r = await call("DELETE", `/api/sucursales/${idSur}`, undefined, tok.BODEGUERO);
    check("BODEGUERO no elimina sucursales -> 403", r.status === 403, r);
    r = await call("DELETE", "/api/sucursales/1", undefined, tok.ADMIN);
    check("eliminar sucursal con empleados/inventario -> 409", r.status === 409 && /empleado/.test(r.data.message) && /inventario/.test(r.data.message), r);
    r = await call("DELETE", "/api/sucursales/2", undefined, tok.ADMIN);
    check("eliminar sucursal solo con inventario -> 409", r.status === 409, r);
    r = await call("DELETE", `/api/sucursales/${idSur}`, undefined, tok.ADMIN);
    check("eliminar sucursal sin historial -> 200", r.status === 200 && (await q(`SELECT count(*)::int n FROM "Sucursal" WHERE id_sucursal=$1`, [idSur]))[0].n === 0, r);
    r = await call("DELETE", "/api/sucursales/abc", undefined, tok.ADMIN);
    check("id no numérico -> 4xx/500 controlado (no cae el servidor)", r.status >= 400, r);
    check("sigue respondiendo", (await call("GET", "/api/sucursales")).status === 200);
    const audSuc = await q(`SELECT accion FROM auditoria WHERE tabla_afectada='Sucursal' ORDER BY id_auditoria`);
    check("auditoría de sucursales (creada, actualizada, eliminada)", audSuc.map((x) => x.accion).join() === "SUCURSAL_CREADA,SUCURSAL_ACTUALIZADA,SUCURSAL_ELIMINADA", audSuc);

    console.log("\n== Ingreso y bajas de stock");
    r = await call("POST", "/api/inventario", { id_producto: 1, id_sucursal: 1, cantidad: -5 }, tok.BODEGUERO);
    check("ingreso negativo -> 400", r.status === 400, r);
    r = await call("POST", "/api/inventario", { id_producto: 1, id_sucursal: 1, cantidad: 2.5 }, tok.BODEGUERO);
    check("ingreso decimal -> 400", r.status === 400, r);
    r = await call("POST", "/api/inventario", { id_producto: 1, id_sucursal: 1, cantidad: 3, estado: "VENDIDO" }, tok.BODEGUERO);
    check("ingreso con estado inválido -> 400", r.status === 400, r);
    r = await call("POST", "/api/inventario", { id_producto: 999, id_sucursal: 1, cantidad: 3 }, tok.BODEGUERO);
    check("ingreso de prenda inexistente -> 400", r.status === 400, r);
    r = await call("GET", "/api/inventario?id_sucursal=1", undefined, tok.CAJERO);
    check("inventario filtrado por sucursal", r.status === 200 && r.data.length === 4 && r.data.every((i) => i.id_sucursal === 1), r.data.length);
    r = await call("GET", "/api/inventario?id_sucursal=x", undefined, tok.CAJERO);
    check("filtro inválido -> 400", r.status === 400, r);
    r = await call("GET", "/api/inventario", undefined, tok.ADMIN);
    check("sin filtro sigue devolviendo todo (pantalla Inventario)", r.status === 200 && r.data.length === 5, r.data.length);

    const base = { id_sucursal: 1, motivo: "CORRECCION_CONTEO" };
    const aj = (ajustes, extra = {}, t = tok.BODEGUERO) => call("POST", "/api/inventario/ajustes", { ...base, ...extra, ajustes }, t);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 12 }]);
    check("ajuste que sube -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 10 }]);
    check("ajuste sin cambio -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: -1 }]);
    check("cantidad nueva negativa -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 1.5 }]);
    check("cantidad decimal -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 5 }, { id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 4 }]);
    check("fila repetida -> 400", r.status === 400, r);
    r = await aj([]);
    check("sin filas -> 400", r.status === 400, r);
    r = await aj(Array.from({ length: 201 }, (_, i) => ({ id_inventario: i + 1, cantidad_actual: 1, cantidad_nueva: 0 })));
    check("más de 200 filas -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 5 }], { motivo: "INVENTADO" });
    check("motivo inválido -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 5 }], { motivo: "OTRO" });
    check("motivo OTRO sin observación -> 400", r.status === 400, r);
    r = await aj([{ id_inventario: 5, cantidad_actual: 4, cantidad_nueva: 0 }]);
    check("fila de otra sucursal -> 400", r.status === 400 && /no pertenecen/.test(r.data.message), r);
    r = await aj([{ id_inventario: 999, cantidad_actual: 4, cantidad_nueva: 0 }]);
    check("fila inexistente -> 404", r.status === 404, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 5 }], { id_sucursal: 999 }, tok.ADMIN);
    check("sucursal inexistente -> 404", r.status === 404, r);
    r = await aj([{ id_inventario: 1, cantidad_actual: 9, cantidad_nueva: 5 }]);
    check("cantidad_actual desactualizada -> 409 y no toca nada", r.status === 409 && (await q(`SELECT cantidad FROM "Inventario" WHERE id_inventario=1`))[0].cantidad === 10, r);
    // Baja de varias filas de golpe (una parcial, una a 0, una DANADA a 0)
    r = await aj([{ id_inventario: 1, cantidad_actual: 10, cantidad_nueva: 8 }, { id_inventario: 2, cantidad_actual: 5, cantidad_nueva: 0 }, { id_inventario: 3, cantidad_actual: 3, cantidad_nueva: 0 }],
      { motivo: "dano", observacion: "Goteras en bodega" });
    const inv = await q(`SELECT id_inventario, cantidad FROM "Inventario" WHERE id_inventario IN (1,2,3) ORDER BY 1`);
    check("baja múltiple 200: 2+5+3 = 10 unidades", r.status === 200 && r.data.unidades === 10 && inv.map((x) => x.cantidad).join() === "8,0,0", [r, inv]);
    const movs = await q(`SELECT id_inventario, cantidad, tipo_movimiento, estado_anterior, estado_nuevo, id_empleado, observacion FROM "MovimientoInventario" WHERE tipo_movimiento='AJUSTE_SALIDA' ORDER BY id_inventario`);
    check("un movimiento AJUSTE_SALIDA por fila, con empleado y motivo", movs.length === 3 && movs.every((m) => m.id_empleado === idBod && /Daño en bodega\. Goteras/.test(m.observacion)) && movs.map((m) => m.cantidad).join() === "2,5,3", movs);
    check("estados del movimiento (DISPONIBLE→DISPONIBLE, →AGOTADO, DANADA→AGOTADO)", movs[0].estado_nuevo === "DISPONIBLE" && movs[1].estado_nuevo === "AGOTADO" && movs[2].estado_anterior === "DANADA", movs);
    check("las filas en 0 no se borran (las referencian los movimientos)", (await q(`SELECT count(*)::int n FROM "Inventario" WHERE id_inventario IN (2,3)`))[0].n === 2);
    const audInv = await q(`SELECT id_empleado, detalles FROM auditoria WHERE accion='INVENTARIO_AJUSTADO'`);
    check("auditoría del ajuste", audInv.length === 1 && audInv[0].id_empleado === idBod && /10 u\./.test(audInv[0].detalles), audInv);
    r = await call("GET", "/api/productos/1/historial", undefined, tok.CAJERO);
    check("la baja aparece en la trazabilidad de la prenda", r.status === 200 && r.data.movimientos.some((m) => m.tipo_movimiento === "AJUSTE_SALIDA" && m.Empleado), r.status);
    r = await aj([{ id_inventario: 1, cantidad_actual: 8, cantidad_nueva: 7 }], {}, tok.ADMIN);
    check("ADMIN también ajusta", r.status === 200, r);

    // Concurrencia: dos bajas simultáneas sobre la misma fila con la misma cantidad vista
    const [c1, c2] = await Promise.all([aj([{ id_inventario: 4, cantidad_actual: 7, cantidad_nueva: 5 }]), aj([{ id_inventario: 4, cantidad_actual: 7, cantidad_nueva: 2 }], {}, tok.ADMIN)]);
    const d4 = (await q(`SELECT cantidad FROM "Inventario" WHERE id_inventario=4`))[0].cantidad;
    check("bajas simultáneas: una 200 y otra 409, sin descontar dos veces", [c1.status, c2.status].sort().join() === "200,409" && (d4 === 5 || d4 === 2), [c1.status, c2.status, d4]);
    // Concurrencia con ventas: baja de todo el stock disponible mientras se vende
    await q(`UPDATE "Inventario" SET cantidad=6 WHERE id_inventario=1`);
    const [v, b2] = await Promise.all([
      call("POST", "/api/pedidos", { id_cliente: 1, id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 4 }] }, tok.CAJERO),
      aj([{ id_inventario: 1, cantidad_actual: 6, cantidad_nueva: 0 }], { motivo: "ROBO" }),
    ]);
    const d1 = (await q(`SELECT cantidad FROM "Inventario" WHERE id_inventario=1`))[0].cantidad;
    const okUno = (v.status === 201 && b2.status === 409 && d1 === 2) || (b2.status === 200 && v.status === 400 && d1 === 0);
    check("venta y baja simultáneas: nunca stock negativo ni doble descuento", okUno && d1 >= 0, [v.status, b2.status, d1]);

    console.log("\n== Auditoría");
    r = await call("GET", "/api/auditoria?tabla_afectada=Empleado", undefined, tok.CAJERO);
    check("CAJERO no lee la auditoría -> 403", r.status === 403, r);
    r = await call("POST", "/api/auditoria", { accion: "FALSA", tabla_afectada: "Empleado", id_empleado: idCaja }, tok.CAJERO);
    check("CAJERO no escribe auditoría -> 403", r.status === 403, r);
    r = await call("POST", "/api/auditoria", { accion: "MANUAL", tabla_afectada: "Producto", id_empleado: idCaja }, tok.ADMIN);
    check("auditoría manual del ADMIN queda a su nombre (ignora id_empleado del body)", r.status === 201 && r.data.id_empleado !== idCaja, r);
    r = await call("GET", "/api/auditoria?tabla_afectada=Empleado", undefined, tok.ADMIN);
    check("ADMIN lee la auditoría", r.status === 200 && r.data.length > 0, r.status);

    console.log("\n== Concurrencia en tipos y sucursales");
    const [e1, e2] = await Promise.all([
      call("POST", "/api/categorias", { nombre: "Gorras" }, tok.ADMIN),
      call("POST", "/api/categorias", { nombre: "GORRAS" }, tok.ADMIN),
    ]);
    check("altas simultáneas «Gorras»/«GORRAS»: solo una (la otra 400, no 500)", [e1.status, e2.status].sort().join() === "201,400" && (await q(`SELECT count(*)::int n FROM "Categoria" WHERE lower(nombre)='gorras'`))[0].n === 1, [e1, e2]);
    const idGorras = (e1.status === 201 ? e1 : e2).data.id_categoria;
    const [u1, d1x] = await Promise.all([
      call("PUT", `/api/categorias/${idGorras}`, { descripcion: "Cambio" }, tok.ADMIN),
      call("DELETE", `/api/categorias/${idGorras}`, undefined, tok.ADMIN),
    ]);
    const audFantasma = await q(`SELECT a1.id_auditoria FROM auditoria a1 JOIN auditoria a2 ON a2.registro_afectado_id=a1.registro_afectado_id WHERE a1.tabla_afectada='Categoria' AND a2.tabla_afectada='Categoria' AND a1.accion='CATEGORIA_ACTUALIZADA' AND a2.accion='CATEGORIA_ELIMINADA' AND a1.id_auditoria > a2.id_auditoria AND a1.registro_afectado_id=$1`, [idGorras]);
    check("editar y eliminar a la vez: nunca se audita una edición posterior al borrado", d1x.status === 200 && audFantasma.length === 0 && (u1.status === 200 || u1.status === 404), [u1.status, d1x.status, audFantasma]);

    console.log("\n== Proveedores");
    r = await call("POST", "/api/proveedores", { nombre_empresa: "Intruso" });
    check("crear proveedor sin token -> 403", r.status === 403, r);
    r = await call("POST", "/api/proveedores", { nombre_empresa: "Intruso" }, tok.CAJERO);
    check("crear proveedor con CAJERO -> 403", r.status === 403, r);
    r = await call("GET", "/api/proveedores");
    check("listar proveedores sin token -> 403", r.status === 403, r);
    r = await call("POST", "/api/proveedores", { nombre_empresa: "Telas GT", nombre_contacto: "Ana", telefono: "1", email: "t@g.com", direccion: "x", activo: true }, tok.BODEGUERO);
    check("BODEGUERO crea proveedor", r.status === 201, r);

    console.log("\n== Tokens");
    r = await call("GET", "/api/auth/yo", undefined, "basura");
    check("token inválido -> 401", r.status === 401, r);
    r = await call("GET", "/api/auth/yo");
    check("sin token -> 403", r.status === 403, r);
  } catch (e) {
    console.error(e);
    fails.push("excepción: " + e.message);
  } finally {
    if (srv) srv.kill();
    await pg.end();
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
