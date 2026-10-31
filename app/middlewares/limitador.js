// Límite de intentos por IP y ruta para los endpoints públicos de cuentas (adivinar contraseñas,
// consultar qué correos existen, abusar del envío de correos). Los contadores viven en la tabla
// IntentoLimite (migración 0002): sobreviven a un reinicio y valen para varias instancias del
// servidor. Si la base no responde, se usa un contador en memoria para no dejar la ruta sin límite.
const crypto = require("crypto");

let db = null;
const base = () => db || (db = require("../models"));
const LIMPIEZA_MS = 60 * 60 * 1000;
let limpiezaIniciada = false;

// Una sola sentencia atómica: suma un intento o reinicia la ventana si ya venció.
const SQL = `
  INSERT INTO "IntentoLimite" (clave, n, desde) VALUES (:clave, 1, now())
  ON CONFLICT (clave) DO UPDATE SET
    n = CASE WHEN "IntentoLimite".desde <= now() - make_interval(secs => :ventana) THEN 1 ELSE "IntentoLimite".n + 1 END,
    desde = CASE WHEN "IntentoLimite".desde <= now() - make_interval(secs => :ventana) THEN now() ELSE "IntentoLimite".desde END
  RETURNING n, extract(epoch FROM (desde + make_interval(secs => :ventana) - now())) AS restante`;

function iniciarLimpieza() {
  if (limpiezaIniciada) return;
  limpiezaIniciada = true;
  setInterval(() => {
    base().sequelize.query(`DELETE FROM "IntentoLimite" WHERE desde < now() - interval '1 day'`).catch(() => {});
  }, LIMPIEZA_MS).unref();
}

// Suma un intento a una clave cualquiera (p. ej. un correo) y devuelve { n, restante } o null si la
// base no responde. Lo usa «olvidé mi contraseña» para limitar también por correo.
async function contarIntento(nombre, ventanaSeg) {
  const clave = crypto.createHash("sha256").update(String(nombre)).digest("hex");
  try {
    iniciarLimpieza();
    const [filas] = await base().sequelize.query(SQL, { replacements: { clave, ventana: ventanaSeg } });
    return { n: Number(filas[0].n), restante: Number(filas[0].restante) };
  } catch (error) {
    return null;
  }
}
exports.contarIntento = contarIntento;

// Express atiende igual /auth/LOGIN y /auth/login/ (sin distinguir mayúsculas ni la barra final):
// la ruta se normaliza para que esas variantes compartan el mismo contador.
const rutaNormalizada = (req) => `${req.baseUrl}${req.path}`.toLowerCase().replace(/\/+$/, "");

// Un proveedor entrega a cada conexión IPv6 una red /64 completa: cambiar de dirección dentro de
// ella no debe dar un contador nuevo. Las IPv4 (también las mapeadas ::ffff:a.b.c.d) se usan tal cual.
function ipClave(ip) {
  const s = String(ip || "");
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  if (!s.includes(":")) return s;
  const [izq, der = ""] = s.toLowerCase().split("::");
  const a = izq ? izq.split(":") : [], b = der ? der.split(":") : [];
  const completa = s.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return completa.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
exports.ipClave = ipClave;

exports.limitarIntentos = ({ max = 20, ventanaMs = 15 * 60 * 1000 } = {}) => {
  const memoria = new Map(); // respaldo: clave -> { n, desde }
  const ventana = ventanaMs / 1000;

  const enMemoria = (clave) => {
    const ahora = Date.now();
    const r = memoria.get(clave);
    if (!r || ahora - r.desde > ventanaMs) {
      // Tope de memoria: primero se borran las vencidas y, si sigue llena, las más antiguas.
      if (memoria.size >= 10000) {
        for (const [k, v] of memoria) if (ahora - v.desde > ventanaMs) memoria.delete(k);
        for (const k of memoria.keys()) { if (memoria.size < 10000) break; memoria.delete(k); }
      }
      memoria.set(clave, { n: 1, desde: ahora });
      return { n: 1, restante: ventana };
    }
    r.n += 1;
    return { n: r.n, restante: (r.desde + ventanaMs - ahora) / 1000 };
  };

  return async (req, res, next) => {
    iniciarLimpieza();
    const clave = crypto.createHash("sha256").update(`${ipClave(req.ip)}|${rutaNormalizada(req)}`).digest("hex");
    let cuenta;
    try {
      const [filas] = await base().sequelize.query(SQL, { replacements: { clave, ventana } });
      cuenta = { n: Number(filas[0].n), restante: Number(filas[0].restante) };
    } catch (error) {
      cuenta = enMemoria(clave);
    }
    if (cuenta.n > max) {
      const segundos = Math.max(1, Math.ceil(cuenta.restante));
      res.set("Retry-After", String(segundos));
      return res.status(429).send({ message: `Demasiados intentos. Vuelve a intentarlo en ${Math.ceil(segundos / 60)} minuto(s).` });
    }
    next();
  };
};
