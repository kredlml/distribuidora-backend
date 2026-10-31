const db = require("../models");
const { crearMigrador } = require("../utils/migrador");
const { diferencias } = require("../utils/esquema");
const { leerPaginacion, pagina } = require("../utils/paginacion");
const { MODO: CORREO_MODO } = require("../utils/correo");
const { STRIPE_SIMULADO } = require("../config/stripe.config");
const { HORAS_PEDIDO_PENDIENTE } = require("../utils/vencimientos");

const INICIO = Date.now();

async function pingBase() {
  const t0 = Date.now();
  await db.sequelize.query("SELECT 1");
  return Date.now() - t0;
}

// GET /api/salud — 200 si la API y la base responden; 503 si la base no. Sin datos internos.
exports.salud = async (req, res) => {
  try {
    const ms = await pingBase();
    res.send({ estado: "ok", base: "ok", latencia_base_ms: ms, hora: new Date() });
  } catch (error) {
    res.status(503).send({ estado: "degradado", base: "sin respuesta", hora: new Date() });
  }
};

// GET /api/salud/detalle — DISTRITAL: migraciones, errores recientes, tareas y servicios.
exports.detalle = async (req, res) => {
  const detalle = { hora: new Date(), en_marcha_desde: new Date(INICIO), version_node: process.version, memoria_mb: Math.round(process.memoryUsage().rss / 1048576) };
  try {
    detalle.latencia_base_ms = await pingBase();
    detalle.base = "ok";
  } catch (error) {
    detalle.base = "sin respuesta";
    return res.status(503).send(detalle);
  }
  try {
    const m = crearMigrador(db);
    const [hechas, pendientes] = await Promise.all([m.executed(), m.pending()]);
    detalle.migraciones = { aplicadas: hechas.length, pendientes: pendientes.map((x) => x.name), ultima: hechas.length ? hechas[hechas.length - 1].name : null };
    detalle.esquema_faltante = await diferencias(db.sequelize);
    const [[errores]] = await db.sequelize.query(`SELECT count(*) FILTER (WHERE fecha > now() - interval '24 hours')::int AS dia, count(*) FILTER (WHERE fecha > now() - interval '7 days')::int AS semana, max(fecha) AS ultimo FROM "ErrorServidor"`);
    detalle.errores = errores;
    const [[pend]] = await db.sequelize.query(`SELECT
      (SELECT count(*)::int FROM "Pedido" WHERE estado = 'PENDIENTE') AS pedidos_pendientes,
      (SELECT count(*)::int FROM "Reembolso" WHERE estado = 'PENDIENTE') AS reembolsos_pendientes,
      (SELECT count(*)::int FROM "Reembolso" WHERE estado = 'FALLIDO') AS reembolsos_fallidos`);
    detalle.pendientes = pend;
    detalle.servicios = {
      correo: CORREO_MODO,
      stripe: STRIPE_SIMULADO ? "simulado" : process.env.STRIPE_SECRET_KEY ? (String(process.env.STRIPE_SECRET_KEY).startsWith("sk_live_") ? "real (producción)" : "real (pruebas)") : "sin configurar",
      cloudinary: process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET ? "configurado" : "sin configurar",
      sentry: process.env.SENTRY_DSN ? "activado" : "no",
      vencimiento_pedidos_horas: HORAS_PEDIDO_PENDIENTE
    };
    res.send(detalle);
  } catch (error) {
    res.status(500).send({ message: "No se pudo obtener el detalle del sistema." });
  }
};

// GET /api/salud/errores?pagina=1 — DISTRITAL: errores registrados, del más reciente al más viejo.
exports.errores = async (req, res) => {
  try {
    const pag = leerPaginacion({ ...req.query, pagina: req.query.pagina || 1 });
    const [filas] = await db.sequelize.query(`SELECT id, fecha, request_id, metodo, ruta, estado, mensaje, usuario FROM "ErrorServidor" ORDER BY id DESC LIMIT :limit OFFSET :offset`, { replacements: { limit: pag.limit, offset: pag.offset } });
    const [[{ total }]] = await db.sequelize.query(`SELECT count(*)::int AS total FROM "ErrorServidor"`);
    res.send(pagina(filas, total, pag));
  } catch (error) {
    res.status(error.status || 500).send({ message: error.message || "No se pudieron leer los errores." });
  }
};
