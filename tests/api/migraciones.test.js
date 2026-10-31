// E2E de migraciones (Umzug) y respaldos (pg_dump/pg_restore) contra el Postgres desechable.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18074, PORT2 = 18075;
const RESPALDOS = path.join(SALIDAS, "respaldos-prueba");
const envR = { RESPALDOS_DIR: RESPALDOS, RESPALDOS_MAX: "2" }; // nunca la carpeta respaldos/ del proyecto
const ENV = {
  NODE_ENV: "development", DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-migraciones"),
};
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 600) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, p) => (await pg.query(sql, p)).rows;
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
const col = async (t, c) => (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c]))[0].n === 1;
const tabla = async (t) => (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]))[0].n === 1;
const meta = async () => (await tabla("SequelizeMeta")) ? (await q(`SELECT name FROM "SequelizeMeta" ORDER BY name`)).map((x) => x.name) : [];
const migraciones = fs.readdirSync(path.join(B, "app", "migraciones")).filter((f) => /^\d{4}-/.test(f)).sort();

function arrancar(port, log) {
  const archivo = path.join(SALIDAS, log);
  const out = fs.openSync(archivo, "w");
  const p = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV, PORT: String(port) }, stdio: ["ignore", out, out] });
  p.log = () => fs.readFileSync(archivo, "utf8");
  return p;
}
async function escuchando(port) { for (let i = 0; i < 160; i++) { await sleep(500); try { if ((await fetch(`http://localhost:${port}/`)).ok) return true; } catch {} } return false; }
// Un proceso que terminó por señal queda con exitCode null y signalCode puesto: hay que mirar ambos.
const detener = async (p) => {
  if (!p || p.exitCode !== null || p.signalCode !== null) return;
  const fin = new Promise((ok) => p.once("exit", ok));
  p.kill();
  await Promise.race([fin, sleep(5000)]);
};
const script = (archivo, args = [], env = {}) => spawnSync(process.execPath, [path.join(B, "scripts", archivo), ...args], { cwd: B, env: { ...process.env, ...ENV, ...env }, encoding: "utf8" });

(async () => {
  if (await ocupado(PORT) || await ocupado(PORT2)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv, srv2;
  try {
    console.log("\n== Base vacía");
    srv = arrancar(PORT, "migraciones-1.log");
    check("el servidor arranca (escucha solo después de migrar)", await escuchando(PORT));
    check("SequelizeMeta registra todas las migraciones", JSON.stringify(await meta()) === JSON.stringify(migraciones), await meta());
    check("crea las tablas, incluida Reembolso", (await tabla("Reembolso")) && (await tabla("Pedido")) && (await tabla("auditoria")));
    check("ya no usa sync alter (no aparece en server.js)", !/alter:\s*true/.test(fs.readFileSync(path.join(B, "server.js"), "utf8")));
    await detener(srv);

    console.log("\n== Reinicio sin cambios");
    srv = arrancar(PORT, "migraciones-2.log");
    await escuchando(PORT);
    check("segundo arranque: 'la base está al día' y no repite migraciones", /al día/.test(srv.log()) && (await meta()).length === migraciones.length, srv.log());
    check("sin avisos de columnas faltantes", !/ATENCIÓN/.test(srv.log()), srv.log());
    await detener(srv);

    console.log("\n== Base de antes de las migraciones (manejada con sync alter)");
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true)`);
    await q(`INSERT INTO "Cliente"(nombre,apellido,email,activo) VALUES ('Ana','Vieja','ana@x.com',true)`);
    await q(`DROP TABLE "SequelizeMeta"`);
    await q(`DROP TABLE "Reembolso"`);
    await q(`ALTER TABLE "Cliente" DROP COLUMN reset_token_hash, DROP COLUMN reset_expira, DROP COLUMN token_version`);
    await q(`ALTER TABLE "DetalleDevolucion" DROP COLUMN precio_unitario_nuevo`);
    // Una columna que no está en los modelos (sync alter la habría BORRADO con sus datos).
    await q(`ALTER TABLE "Sucursal" ADD COLUMN nota_manual text`);
    await q(`UPDATE "Sucursal" SET nota_manual='dato importante'`);
    srv = arrancar(PORT, "migraciones-3.log");
    check("arranca sobre la base vieja", await escuchando(PORT), srv.log());
    check("agrega lo que faltaba (tabla Reembolso y columnas nuevas)", (await tabla("Reembolso")) && (await col("Cliente", "token_version")) && (await col("Cliente", "reset_token_hash")) && (await col("DetalleDevolucion", "precio_unitario_nuevo")), srv.log());
    check("los clientes existentes quedan con token_version 0 y conservan sus datos", JSON.stringify(await q(`SELECT nombre, token_version FROM "Cliente"`)) === JSON.stringify([{ nombre: "Ana", token_version: 0 }]));
    check("NO borra columnas que no están en los modelos (lo que hacía alter)", (await col("Sucursal", "nota_manual")) && (await q(`SELECT nota_manual FROM "Sucursal"`))[0].nota_manual === "dato importante");
    check("queda registrada en SequelizeMeta", (await meta()).length === migraciones.length);
    await detener(srv);
    await q(`ALTER TABLE "Sucursal" DROP COLUMN nota_manual`);

    console.log("\n== Modelo cambiado sin migración");
    await q(`ALTER TABLE "Proveedor" DROP COLUMN IF EXISTS telefono`);
    srv = arrancar(PORT, "migraciones-4.log");
    await escuchando(PORT);
    check("avisa en el log qué falta (y no toca la base por su cuenta)", /ATENCIÓN.*Proveedor\.telefono/.test(srv.log()) && !(await col("Proveedor", "telefono")), srv.log());
    let r = script("migrar.js", ["estado"]);
    check("migrar:estado lista aplicadas, pendientes y lo que falta", r.status === 0 && /Aplicadas \(\d+\)/.test(r.stdout) && /Pendientes \(0\)/.test(r.stdout) && /Proveedor\.telefono/.test(r.stdout), r.stdout + r.stderr);
    check("migrar:estado no muestra la contraseña de la base", !/DB_PASSWORD|password=/i.test(r.stdout + r.stderr));
    await detener(srv);
    await q(`ALTER TABLE "Proveedor" ADD COLUMN telefono varchar(20)`);
    // Deshacer revierte solo la última; la línea base nunca se deshace.
    const ultima = migraciones[migraciones.length - 1];
    r = script("migrar.js", ["deshacer"]);
    check(`deshacer revierte solo la última (${ultima})`, r.status === 0 && r.stdout.includes(ultima) && (await meta()).length === migraciones.length - 1, r.stdout + r.stderr);
    r = script("migrar.js", ["aplicar"]);
    check("npm run migrar la vuelve a aplicar", r.status === 0 && (await meta()).length === migraciones.length, r.stdout + r.stderr);
    for (let i = 1; i < migraciones.length; i++) script("migrar.js", ["deshacer"]);
    r = script("migrar.js", ["deshacer"]);
    check("deshacer la línea base se rechaza y la base queda intacta", r.status === 1 && /no se puede deshacer/.test(r.stderr) && (await meta()).length === 1 && (await tabla("Pedido")), r.stdout + r.stderr);
    r = script("migrar.js", ["aplicar"]);
    check("y se reaplican todas", r.status === 0 && (await meta()).length === migraciones.length, r.stdout + r.stderr);

    console.log("\n== Dos servidores arrancando a la vez sobre una base vacía");
    await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    srv = arrancar(PORT, "migraciones-5a.log"); srv2 = arrancar(PORT2, "migraciones-5b.log");
    const [a, b] = await Promise.all([escuchando(PORT), escuchando(PORT2)]);
    check("ambos arrancan (el candado ordena las migraciones)", a && b, [srv.log(), srv2.log()]);
    check("cada migración se aplica una sola vez", JSON.stringify(await meta()) === JSON.stringify(migraciones), await meta());
    await detener(srv); await detener(srv2);

    console.log("\n== Respaldo y restauración");
    fs.rmSync(RESPALDOS, { recursive: true, force: true });
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);
    for (let i = 0; i < 3; i++) {
      r = script("respaldo.js", [], envR);
      if (r.status !== 0) break;
      await sleep(1100); // el nombre lleva la hora con segundos
    }
    const dumps = fs.existsSync(RESPALDOS) ? fs.readdirSync(RESPALDOS).filter((f) => f.endsWith(".dump")) : [];
    check("npm run respaldo crea el .dump y rota (conserva solo RESPALDOS_MAX=2)", r.status === 0 && dumps.length === 2 && dumps.every((f) => f.startsWith("distrib_test-")), [r.stdout, r.stderr, dumps]);
    check("el respaldo no muestra la contraseña", !/PGPASSWORD|"x"/.test(r.stdout + r.stderr));
    check("no quedan archivos .parcial", fs.readdirSync(RESPALDOS).every((f) => !f.endsWith(".parcial")));
    const ultimo = path.join(RESPALDOS, dumps.sort().pop());
    await q(`DELETE FROM "Sucursal" WHERE nombre='Norte'`);
    r = script("restaurar.js", [ultimo], envR);
    check("restaurar sin --base se rechaza y no toca nada", r.status === 1 && /--base distrib_test/.test(r.stderr) && (await q(`SELECT count(*)::int n FROM "Sucursal"`))[0].n === 1, r.stderr);
    r = script("restaurar.js", [ultimo, "--base", "otra_base"], envR);
    check("restaurar con otra base se rechaza", r.status === 1, r.stderr);
    // Después del respaldo aparece una tabla nueva con llave foránea a Pedido (como Reembolso tras
    // la primera migración): con pg_restore --clean la restauración fallaba.
    await q(`CREATE TABLE "TablaNueva" (id serial PRIMARY KEY, id_pedido integer REFERENCES "Pedido"(id_pedido))`);
    r = script("restaurar.js", [ultimo, "--base", "distrib_test"], envR);
    check("restaurar con --base correcta recupera los datos", r.status === 0 && (await q(`SELECT count(*)::int n FROM "Sucursal"`))[0].n === 2 && (await meta()).length === migraciones.length, r.stdout + r.stderr);
    check("…aunque después del respaldo se creara una tabla con llave foránea (queda como en el respaldo)", !(await tabla("TablaNueva")));
    check("antes de restaurar guarda un respaldo de seguridad del estado anterior", fs.readdirSync(RESPALDOS).some((f) => f.startsWith("antes-de-restaurar-distrib_test-") && f.endsWith(".dump")), fs.readdirSync(RESPALDOS));
    fs.writeFileSync(path.join(RESPALDOS, "roto.dump"), "esto no es un respaldo");
    const antes = (await q(`SELECT count(*)::int n FROM "Sucursal"`))[0].n;
    r = script("restaurar.js", [path.join(RESPALDOS, "roto.dump"), "--base", "distrib_test"], envR);
    check("un archivo que no es respaldo se rechaza antes de tocar la base", r.status === 1 && /no es un respaldo válido/.test(r.stderr) && (await q(`SELECT count(*)::int n FROM "Sucursal"`))[0].n === antes, r.stderr);
    r = script("respaldo.js", [], { ...envR, DB_NAME: "no_existe_esta_base" });
    check("respaldo de una base inexistente: error claro y sin archivo a medias", r.status === 1 && /pg_dump falló/.test(r.stderr) && fs.readdirSync(RESPALDOS).every((f) => !f.startsWith("no_existe")), r.stderr);
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("EXCEPCIÓN", e);
  } finally {
    await detener(srv); await detener(srv2);
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
