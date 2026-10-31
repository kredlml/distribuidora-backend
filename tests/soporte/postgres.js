// PostgreSQL DESECHABLE para las pruebas: un clúster propio en tests/.pgdata, puerto 54329, usuario
// "tester" sin contraseña y base "distrib_test". Las pruebas borran y recrean el esquema en cada
// corrida, por eso NUNCA se conectan a la base del proyecto (la de .env.development).
const { spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const PUERTO = 54329;
const DATOS = path.join(__dirname, "..", ".pgdata");

// Carpeta bin de PostgreSQL: PG_BIN, o la versión más nueva instalada en Windows, o el PATH.
function binarios() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const base = "C:/Program Files/PostgreSQL";
  if (fs.existsSync(base)) {
    const versiones = fs.readdirSync(base).filter((v) => fs.existsSync(path.join(base, v, "bin", "pg_ctl.exe"))).sort((a, b) => Number(b) - Number(a));
    if (versiones.length) return path.join(base, versiones[0], "bin");
  }
  return ""; // se usan los del PATH
}
const exe = (nombre) => { const b = binarios(); return b ? path.join(b, nombre + (process.platform === "win32" ? ".exe" : "")) : nombre; };
const correr = (nombre, args) => spawnSync(exe(nombre), args, { encoding: "utf8" });

const escuchando = () => new Promise((res) => {
  const s = net.connect({ port: PUERTO, host: "127.0.0.1" }, () => { s.destroy(); res(true); });
  s.on("error", () => res(false));
});

// Deja el clúster listo. Devuelve true si lo arrancó esta llamada (para detenerlo al terminar).
async function iniciar() {
  if (await escuchando()) return false;
  if (!fs.existsSync(path.join(DATOS, "PG_VERSION"))) {
    fs.rmSync(DATOS, { recursive: true, force: true });
    const r = correr("initdb", ["-D", DATOS, "-U", "tester", "-A", "trust", "-E", "UTF8", "--locale=C"]);
    if (r.status !== 0) throw new Error("initdb falló (¿está instalado PostgreSQL? Indica su carpeta bin con PG_BIN):\n" + (r.stderr || r.error));
  }
  // pg_ctl deja corriendo al servidor: su salida va al log y NO a una tubería (si no, en Windows la
  // espera nunca termina porque el servidor hereda la tubería abierta).
  const r = spawnSync(exe("pg_ctl"), ["-D", DATOS, "-o", `-p ${PUERTO}`, "-l", path.join(DATOS, "..", "salidas", "postgres.log"), "start"], { stdio: "ignore" });
  if (r.error) throw new Error("No se pudo arrancar el PostgreSQL de pruebas: " + r.error.message);
  for (let i = 0; i < 60 && !(await escuchando()); i++) await new Promise((ok) => setTimeout(ok, 500));
  if (!(await escuchando())) throw new Error("El PostgreSQL de pruebas no arrancó; revisa tests/salidas/postgres.log.");
  const bd = correr("createdb", ["-p", String(PUERTO), "-U", "tester", "distrib_test"]);
  if (bd.status !== 0 && !/already exists|ya existe/.test(bd.stderr)) throw new Error("createdb falló:\n" + bd.stderr);
  return true;
}

function detener() {
  spawnSync(exe("pg_ctl"), ["-D", DATOS, "-m", "fast", "stop"], { stdio: "ignore" });
}

module.exports = { iniciar, detener, PUERTO };
