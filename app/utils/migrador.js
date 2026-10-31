// Migraciones controladas (Umzug). Cada archivo de app/migraciones (0001-…, 0002-…) se aplica una
// sola vez y queda anotado en la tabla SequelizeMeta. Reemplaza a sync({ alter: true }), que en cada
// arranque comparaba modelos y base y podía borrar columnas o cambiar tipos sin avisar.
const fs = require("fs");
const path = require("path");
const { Umzug, SequelizeStorage } = require("umzug");
const { diferencias, asegurarModelo, modelosOrdenados } = require("./esquema");
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

// Vuelve a agregar las columnas (y valores de ENUM) que los modelos tienen y la base no; nunca
// borra ni crea tablas (una tabla que falta solo se avisa: crearla vacía escondería el problema).
// Hace falta porque las versiones viejas del backend (ramas anteriores a las migraciones) arrancan
// con sync({ alter: true }): si alguien corre una contra la misma base, alter BORRA las columnas que
// su modelo no conoce, aunque SequelizeMeta diga que la migración ya corrió. Los datos de esas
// columnas se pierden; vuelven con su valor por defecto y queda registrado en ErrorServidor (lo ve
// el DISTRITAL en el panel) para que un borrado que se repite no pase inadvertido.
// Cada tabla se repara en su propia transacción con lock_timeout: si una transacción larga tiene
// tomada la tabla, el ALTER se rinde en segundos en vez de dejar en cola todas sus consultas.
const ESPERA_BLOQUEO = "5s";
async function repararEsquema(db) {
  const sequelize = db.sequelize;
  const faltaban = await diferencias(sequelize);
  const resultado = { faltaban, agregadas: [], errores: [] };
  if (!faltaban.length) return resultado;
  for (const modelo of modelosOrdenados(sequelize)) {
    if (modelo.name === "SequelizeMeta") continue;
    try {
      const agregadas = await sequelize.transaction(async (transaction) => {
        await sequelize.query(`SET LOCAL lock_timeout = '${ESPERA_BLOQUEO}'`, { transaction });
        const hecho = await asegurarModelo(sequelize, modelo, { crearTabla: false, transaction });
        // token_version vuelve en 0, y 0 puede ser la versión de una sesión que ya se había cerrado
        // (cambio de contraseña): se le pone una que ningún token emitido tiene (segundos desde 1970,
        // siempre mayor que la anterior). Cierra todas las sesiones de esa tabla; nadie revive.
        const tabla = modelo.getTableName();
        if (hecho.includes(`${tabla}.token_version`)) {
          await sequelize.query(`UPDATE "${tabla}" SET token_version = floor(extract(epoch FROM now()))::int`, { transaction });
        }
        return hecho;
      });
      resultado.agregadas.push(...agregadas);
    } catch (error) {
      resultado.errores.push(`${modelo.name}: ${error.message}`); // sigue con los demás modelos
    }
  }
  const siguen = await diferencias(sequelize).catch(() => faltaban);
  const mensaje = `Faltaban en la base: ${faltaban.join(", ")}. Se agregaron (vacías, con su valor por defecto): ${resultado.agregadas.join(", ") || "ninguna"}.`
    + (siguen.length ? ` Siguen faltando: ${siguen.join(", ")}.` : "")
    + (resultado.errores.length ? ` Errores: ${resultado.errores.join(" | ")}.` : "")
    + " Causa probable: otra versión del backend con sync({ alter: true }) contra esta base; si no, falta una migración en app/migraciones.";
  console.warn(`[migración] ATENCIÓN: ${mensaje}`);
  await require("./monitoreo").registrarError({ metodo: "ESQUEMA", ruta: "reparación del esquema", estado: 500, mensaje });
  return resultado;
}

// Aplica las migraciones pendientes, repara lo que falte y corre el mantenimiento de datos (todo
// bajo el candado: dos arranques simultáneos no promueven a dos DISTRITAL). La usa server.js antes
// de escuchar peticiones: si una migración falla, el servidor no arranca a medias.
async function prepararBase(db) {
  await conCandado(db, async () => {
    const aplicadas = await crearMigrador(db).up();
    if (!aplicadas.length) console.log("[migración] la base está al día.");
    await repararEsquema(db).catch((e) => console.error(`[migración] No se pudo reparar el esquema: ${e.message}`));
    await mantenimiento(db);
  });
}

// Con el servidor ya corriendo: si Postgres responde "no existe la columna" (42703), alguien la
// borró mientras tanto (ver repararEsquema). Se repara en segundo plano, a lo sumo una vez por
// `esperaMs`; la petición que falló responde su error y las siguientes ya funcionan. Una tabla que
// falta (42P01) no dispara nada: alter no borra tablas.
const COLUMNA_INEXISTENTE = "42703";
function vigilarEsquema(db, { esperaMs = 60000 } = {}) {
  const sequelize = db.sequelize;
  const consultar = sequelize.query.bind(sequelize);
  let enCurso = null;
  let ultima = 0;
  const reparar = (error) => {
    if (enCurso || Date.now() - ultima < esperaMs) return;
    ultima = Date.now();
    console.warn(`[migración] Postgres dice que falta una columna (${error.message}); revisando el esquema.`);
    enCurso = conCandado(db, () => repararEsquema(db), { intentar: true })
      .then((r) => {
        if (r === null) console.warn("[migración] Otro servidor está migrando o reparando la base; no se repara aquí.");
        else if (!r.faltaban.length) console.warn("[migración] No falta ninguna columna de los modelos: el error viene de una consulta SQL escrita a mano o de una tabla sin modelo.");
      })
      .catch((e) => console.error(`[migración] No se pudo reparar el esquema: ${e.message}`))
      .finally(() => { enCurso = null; });
  };
  sequelize.query = (...args) => consultar(...args).catch((error) => {
    const codigo = error && ((error.original && error.original.code) || (error.parent && error.parent.code));
    if (codigo === COLUMNA_INEXISTENTE) reparar(error);
    throw error;
  });
}

module.exports = { crearMigrador, conCandado, prepararBase, repararEsquema, vigilarEsquema };
