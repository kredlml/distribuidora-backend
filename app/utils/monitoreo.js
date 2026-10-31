// Monitoreo de errores: id por petición (cabecera X-Request-Id), registro de las respuestas 5xx y
// de las excepciones no controladas en la tabla ErrorServidor (migración 0003), manejador final de
// errores en JSON y, si se configura SENTRY_DSN, envío a Sentry (opcional: npm install @sentry/node).
const crypto = require("crypto");

let db = null;
const base = () => db || (db = require("../models"));
const DIAS_RETENCION = 30;
const recortar = (s, n) => (s == null ? null : String(s).slice(0, n));

// ---- Sentry (opcional). Sin SENTRY_DSN no se carga nada.
let sentry = null;
function iniciarSentry() {
  if (!process.env.SENTRY_DSN || sentry) return sentry;
  try {
    sentry = require("@sentry/node");
    sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV || "development", sendDefaultPii: false, tracesSampleRate: 0 });
    console.log("[monitoreo] Sentry activado.");
  } catch (error) {
    sentry = null;
    console.warn("[monitoreo] SENTRY_DSN está configurado pero falta el paquete: npm install @sentry/node");
  }
  return sentry;
}

// Guarda un error (nunca lanza). `datos`: { request_id, metodo, ruta, estado, mensaje, pila, usuario }.
async function registrarError(datos) {
  try {
    await base().sequelize.query(
      `INSERT INTO "ErrorServidor" (request_id, metodo, ruta, estado, mensaje, pila, usuario) VALUES (:request_id, :metodo, :ruta, :estado, :mensaje, :pila, :usuario)`,
      { replacements: {
        request_id: recortar(datos.request_id, 36), metodo: recortar(datos.metodo, 10), ruta: recortar(datos.ruta, 300),
        estado: datos.estado || null, mensaje: recortar(datos.mensaje, 2000), pila: recortar(datos.pila, 8000), usuario: recortar(datos.usuario, 60)
      } }
    );
  } catch (error) {
    console.error(`[monitoreo] No se pudo registrar el error: ${error.message}`);
  }
  if (sentry) {
    try { sentry.captureMessage(`${datos.metodo || ""} ${datos.ruta || ""} ${datos.estado || ""}: ${datos.mensaje || ""}`.trim(), { level: "error", tags: { request_id: datos.request_id } }); } catch { /* sin efecto */ }
  }
}

// Ruta sin la query (puede traer correos o tokens) y sin ids largos de más.
const rutaDe = (req) => recortar((req.originalUrl || req.url || "").split("?")[0], 300);
const usuarioDe = (req) => (req.empleadoId ? `empleado:${req.empleadoId}` : req.clienteId ? `cliente:${req.clienteId}` : null);

// 1) Id de petición: se devuelve en X-Request-Id y acompaña a los errores registrados.
function idDePeticion(req, res, next) {
  req.id = crypto.randomUUID();
  res.set("X-Request-Id", req.id);
  next();
}

// 2) Registra toda respuesta 5xx, también las que los controladores responden ellos mismos
//    (capturan el error y envían { message }). Se guarda el mensaje, no el cuerpo de la petición.
function registrarRespuestas5xx(req, res, next) {
  const enviar = res.send;
  res.send = function (cuerpo) {
    if (res.statusCode >= 500 && !res.locals.errorRegistrado) {
      res.locals.errorRegistrado = true;
      let mensaje = cuerpo;
      try { mensaje = typeof cuerpo === "string" ? (JSON.parse(cuerpo).message || cuerpo) : cuerpo && cuerpo.message ? cuerpo.message : JSON.stringify(cuerpo); } catch { /* texto plano */ }
      // El controlador pudo responder un mensaje genérico y dejar el detalle real aquí.
      if (res.locals.mensajeError) mensaje = `${mensaje} — ${res.locals.mensajeError}`;
      registrarError({ request_id: req.id, metodo: req.method, ruta: rutaDe(req), estado: res.statusCode, mensaje, pila: res.locals.pilaError, usuario: usuarioDe(req) });
    }
    return enviar.call(this, cuerpo);
  };
  next();
}

// 3) Rutas /api inexistentes: JSON en vez de la página HTML de Express.
function noEncontrado(req, res) {
  res.status(404).send({ message: `No existe la ruta ${req.method} ${rutaDe(req)}.` });
}

// 4) Manejador final: errores que llegan a Express (excepciones en controladores, JSON mal
//    formado, cuerpos comprimidos o demasiado grandes). Al cliente nunca se le muestra la pila.
// eslint-disable-next-line no-unused-vars
function manejadorDeErrores(err, req, res, next) {
  const porTipo = { "entity.parse.failed": [400, "El cuerpo de la petición no es JSON válido."], "encoding.unsupported": [415, "No se aceptan cuerpos comprimidos."], "entity.too.large": [413, "El cuerpo de la petición es demasiado grande."] };
  const conocido = porTipo[err && err.type];
  const estado = conocido ? conocido[0] : (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500);
  if (res.headersSent) return;
  if (estado >= 500) res.locals.pilaError = err && err.stack;
  res.status(estado).send({ message: conocido ? conocido[1] : estado >= 500 ? `Error interno del servidor (referencia ${req.id}).` : (err && err.message) || "Petición inválida.", referencia: req.id });
}

// 5) Excepciones fuera de una petición (timers, promesas sin catch).
function vigilarProceso() {
  process.on("unhandledRejection", (motivo) => {
    console.error("[monitoreo] Promesa rechazada sin manejar:", motivo);
    registrarError({ metodo: "PROCESO", ruta: "unhandledRejection", estado: 500, mensaje: motivo && motivo.message ? motivo.message : String(motivo), pila: motivo && motivo.stack });
  });
  process.on("uncaughtException", (error) => {
    // El proceso quedó en un estado desconocido: se registra y se termina (el gestor lo reinicia).
    console.error("[monitoreo] Excepción no controlada:", error);
    Promise.race([registrarError({ metodo: "PROCESO", ruta: "uncaughtException", estado: 500, mensaje: error.message, pila: error.stack }), new Promise((ok) => setTimeout(ok, 1500))])
      .finally(() => process.exit(1));
  });
  setInterval(() => {
    base().sequelize.query(`DELETE FROM "ErrorServidor" WHERE fecha < now() - make_interval(days => ${DIAS_RETENCION})`).catch(() => {});
  }, 6 * 60 * 60 * 1000).unref();
}

module.exports = { iniciarSentry, registrarError, idDePeticion, registrarRespuestas5xx, noEncontrado, manejadorDeErrores, vigilarProceso };
