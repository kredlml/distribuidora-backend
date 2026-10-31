// Migraciones controladas (Umzug). Cada archivo de app/migraciones (0001-…, 0002-…) se aplica una
// sola vez y queda anotado en la tabla SequelizeMeta. Reemplaza a sync({ alter: true }), que en cada
// arranque comparaba modelos y base y podía borrar columnas o cambiar tipos sin avisar.
const fs = require("fs");
const path = require("path");
const { Umzug, SequelizeStorage } = require("umzug");
const { diferencias } = require("./esquema");
const { mantenimiento } = require("./mantenimiento");

const CARPETA = path.join(__dirname, "..", "migraciones");
// Candado de Postgres: si arrancan dos servidores a la vez, el segundo espera al primero.
const CANDADO = 74210531;

function crearMigrador(db) {
  const archivos = fs.readdirSync(CARPETA).filter((f) => /^\d{4}-[\w-]+\.js$/.test(f)).sort();
  return new Umzug({
    migrations: archivos.map((f) => {
      const m = require(path.join(CARPETA, f));
      return {
        name: f,
        up: ({ context }) => m.up(context),
        down: ({ context }) => (m.down ? m.down(context) : Promise.reject(new Error(`La migración ${f} no tiene "down".`)))
      };
    }),
    context: { db, sequelize: db.sequelize, qi: db.sequelize.getQueryInterface(), Sequelize: db.Sequelize },
    storage: new SequelizeStorage({ sequelize: db.sequelize, tableName: "SequelizeMeta" }),
    logger: {
      info: (e) => { if (e && e.event === "migrated") console.log(`[migración] aplicada ${e.name} (${e.durationSeconds}s)`); },
      warn: (e) => console.warn("[migración]", e),
      error: (e) => console.error("[migración]", e),
      debug: () => {}
    }
  });
}

// Candado de TRANSACCIÓN (pg_advisory_xact_lock) en una conexión dedicada que mantiene abierta una
// transacción mientras dura `fn`. Funciona también detrás de un pooler en modo transacción (PgBouncer,
// p. ej. el endpoint "-pooler" de Neon): durante una transacción el pooler no cambia de backend, y el
// candado se suelta solo con COMMIT/ROLLBACK (con un candado de sesión el unlock podía ir a otro
// backend y dejarlo tomado). `intentar`: no espera; si otro lo tiene, devuelve null sin ejecutar fn.
async function conCandado(db, fn, { clave = CANDADO, intentar = false, esperaSeg = 300 } = {}) {
  const cm = db.sequelize.connectionManager;
  const conexion = await cm.getConnection({ type: "write" });
  let enTransaccion = false;
  try {
    await conexion.query("BEGIN");
    enTransaccion = true;
    if (intentar) {
      const r = await conexion.query(`SELECT pg_try_advisory_xact_lock(${Number(clave)}) AS ok`);
      if (!r.rows[0].ok) return null;
    } else {
      await conexion.query(`SET LOCAL lock_timeout = '${Number(esperaSeg)}s'`);
      await conexion.query(`SELECT pg_advisory_xact_lock(${Number(clave)})`);
    }
    return await fn();
  } finally {
    if (enTransaccion) await conexion.query("COMMIT").catch(() => {});
    cm.releaseConnection(conexion);
  }
}

// Aplica las migraciones pendientes y el mantenimiento de datos (todo bajo el candado: dos
// arranques simultáneos no promueven a dos DISTRITAL). La usa server.js antes de escuchar
// peticiones: si una migración falla, el servidor no arranca a medias.
async function prepararBase(db) {
  await conCandado(db, async () => {
    const aplicadas = await crearMigrador(db).up();
    if (!aplicadas.length) console.log("[migración] la base está al día.");
    await mantenimiento(db);
  });
  // Si alguien cambió un modelo y olvidó escribir la migración, se avisa (no se toca la base).
  const faltan = await diferencias(db.sequelize).catch(() => []);
  if (faltan.length) console.warn(`[migración] ATENCIÓN: los modelos tienen columnas que la base no: ${faltan.join(", ")}. Escribe una migración nueva en app/migraciones.`);
}

module.exports = { crearMigrador, conCandado, prepararBase };
