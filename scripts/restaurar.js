// Restaura un respaldo hecho con "npm run respaldo". REEMPLAZA todo el contenido de la base.
//   npm run restaurar -- respaldos/<archivo>.dump --base <nombre de la base>
// --base debe coincidir con DB_NAME de la configuración: así no se restaura por error sobre otra
// base. Detén el servidor antes. Pasos:
//   1) respaldo de seguridad de cómo está la base ahora (respaldos/antes-de-restaurar-…);
//   2) se vacía el esquema public (también lo que el respaldo no trae: tablas nuevas, SequelizeMeta);
//   3) pg_restore en una sola transacción; si falla, se vuelve a cargar el respaldo de seguridad.
// Al arrancar, el servidor aplica las migraciones que el respaldo no tenga.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { config, exe, entorno, cliente } = require("./pg");
const { respaldar } = require("./respaldo");

function pgRestore(c, archivo) {
  const r = spawnSync(exe("pg_restore"), ["-h", c.host, "-p", String(c.port), "-U", c.user, "-d", c.base, "--no-owner", "--no-privileges", "--single-transaction", "--exit-on-error", archivo],
    { env: entorno(c), encoding: "utf8" });
  if (r.error) throw new Error(`No se pudo ejecutar pg_restore (${r.error.message}). Indica la carpeta bin de PostgreSQL con PG_BIN.`);
  if (r.status !== 0) throw new Error((r.stderr || "").trim() || `pg_restore terminó con código ${r.status}`);
}

async function vaciarEsquema(c) {
  const pg = cliente(c);
  await pg.connect();
  try { await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"); }
  finally { await pg.end().catch(() => {}); }
}

(async () => {
  try {
    const args = process.argv.slice(2);
    const iBase = args.indexOf("--base");
    const base = iBase >= 0 ? args[iBase + 1] : null;
    const archivo = args.find((a, i) => !a.startsWith("--") && (iBase < 0 || i !== iBase + 1));
    const c = config();
    if (!archivo) throw new Error("Indica el archivo .dump a restaurar.");
    if (!fs.existsSync(archivo)) throw new Error(`No existe el archivo ${archivo}.`);
    if (base !== c.base) throw new Error(`Para confirmar, agrega --base ${c.base} (la base configurada). No se restauró nada.`);
    // El archivo debe ser un respaldo válido antes de tocar nada.
    const lista = spawnSync(exe("pg_restore"), ["-l", archivo], { encoding: "utf8" });
    if (lista.error || lista.status !== 0) throw new Error(`El archivo no es un respaldo válido de pg_dump: ${(lista.stderr || (lista.error && lista.error.message) || "").trim()}`);

    console.log("1/3 Respaldo de seguridad del estado actual…");
    const seguridad = respaldar({ prefijo: "antes-de-restaurar-", rotar: false });
    console.log(`2/3 Vaciando la base "${c.base}"…`);
    await vaciarEsquema(c);
    console.log(`3/3 Restaurando ${path.basename(archivo)}…`);
    try {
      pgRestore(c, archivo);
    } catch (error) {
      console.error(`La restauración falló; vuelvo a dejar la base como estaba…\n${error.message}`);
      await vaciarEsquema(c);
      pgRestore(c, seguridad);
      throw new Error(`No se restauró ${path.basename(archivo)}; la base quedó como antes (respaldo ${path.basename(seguridad)}).`);
    }
    console.log(`Listo. El estado anterior quedó en ${seguridad}. Arranca el servidor: aplicará las migraciones que el respaldo no tenga.`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
})();
