// Utilidades comunes de los scripts de respaldo: configuración de la base (la misma del servidor),
// ubicación de pg_dump/pg_restore y entorno con la contraseña (nunca va en la línea de comandos).
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", process.env.NODE_ENV === "production" ? ".env.production" : ".env.development"), quiet: true });

// pg_dump/pg_restore NO deben pasar por un pooler en modo transacción (PgBouncer, como el endpoint
// "-pooler" de Neon): sus ajustes de sesión podrían aplicarse en otra conexión y el respaldo salir
// mal. Se usa DB_HOST_DIRECTO si está definido o, en Neon, el mismo host sin "-pooler".
function hostDirecto(host) {
  if (process.env.DB_HOST_DIRECTO) return process.env.DB_HOST_DIRECTO;
  return /-pooler\./.test(host) && /\.neon\.tech$/i.test(host) ? host.replace("-pooler.", ".") : host;
}

function config() {
  const c = { host: process.env.DB_HOST, port: process.env.DB_PORT || "5432", user: process.env.DB_USER, password: process.env.DB_PASSWORD, base: process.env.DB_NAME };
  for (const [k, v] of Object.entries({ DB_HOST: c.host, DB_USER: c.user, DB_NAME: c.base })) if (!v) throw new Error(`Falta ${k} en la configuración.`);
  c.host = hostDirecto(c.host);
  if (/-pooler\./.test(c.host)) console.warn("Aviso: el host parece un pooler; define DB_HOST_DIRECTO con la conexión directa para respaldar y restaurar.");
  return c;
}

// Cliente de node-postgres con la misma configuración (para sentencias sueltas al restaurar).
function cliente(c) {
  const { Client } = require("pg");
  return new Client({ host: c.host, port: Number(c.port), user: c.user, password: c.password, database: c.base, ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false } });
}

// Ejecutable de PostgreSQL: PG_BIN, o la versión más nueva instalada en Windows, o el del PATH.
function exe(nombre) {
  const sufijo = process.platform === "win32" ? ".exe" : "";
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, nombre + sufijo);
  const base = "C:/Program Files/PostgreSQL";
  if (process.platform === "win32" && fs.existsSync(base)) {
    const v = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, "bin", nombre + sufijo))).sort((a, b) => Number(b) - Number(a))[0];
    if (v) return path.join(base, v, "bin", nombre + sufijo);
  }
  return nombre;
}

// La contraseña va por PGPASSWORD; SSL igual que el servidor (DB_SSL=false lo desactiva).
function entorno(c) {
  return { ...process.env, PGPASSWORD: c.password || "", PGSSLMODE: process.env.DB_SSL === "false" ? "disable" : "require" };
}

module.exports = { config, exe, entorno, cliente };
