// Respaldo de la base con pg_dump (formato custom: comprimido y restaurable con pg_restore).
//   npm run respaldo
// Guarda respaldos/<base>-AAAAMMDD-HHMMSS.dump y conserva los últimos RESPALDOS_MAX (14 por defecto).
// Carpeta configurable con RESPALDOS_DIR. Para programarlo a diario en Windows:
//   schtasks /Create /SC DAILY /ST 23:00 /TN "Respaldo distribuidora" /TR "cmd /c cd /d <carpeta del proyecto> && npm run respaldo"
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { config, exe, entorno } = require("./pg");

const DIR = path.resolve(process.env.RESPALDOS_DIR || path.join(__dirname, "..", "respaldos"));
const MAX = Math.max(1, Number(process.env.RESPALDOS_MAX) || 14);
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Crea el respaldo y devuelve su ruta. `prefijo` permite respaldos especiales (antes de restaurar).
function respaldar({ prefijo = "", rotar = true } = {}) {
  const c = config();
  fs.mkdirSync(DIR, { recursive: true });
  const ahora = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const sello = `${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}-${p(ahora.getHours())}${p(ahora.getMinutes())}${p(ahora.getSeconds())}`;
  let archivo = path.join(DIR, `${prefijo}${c.base}-${sello}.dump`);
  for (let i = 2; fs.existsSync(archivo) || fs.existsSync(archivo + ".parcial"); i++) archivo = path.join(DIR, `${prefijo}${c.base}-${sello}-${i}.dump`);
  const parcial = archivo + ".parcial";

  console.log(`Respaldando la base "${c.base}" de ${c.host}:${c.port}…`);
  const r = spawnSync(exe("pg_dump"), ["-h", c.host, "-p", String(c.port), "-U", c.user, "-d", c.base, "-F", "c", "--no-owner", "--no-privileges", "-f", parcial],
    { env: entorno(c), encoding: "utf8" });
  if (r.error) throw new Error(`No se pudo ejecutar pg_dump (${r.error.message}). Indica la carpeta bin de PostgreSQL con PG_BIN.`);
  if (r.status !== 0) { fs.rmSync(parcial, { force: true }); throw new Error(`pg_dump falló:\n${(r.stderr || "").trim()}`); }
  // Solo un respaldo completo queda con el nombre final (un corte a medias no se confunde con uno bueno).
  fs.renameSync(parcial, archivo);
  console.log(`Listo: ${archivo} (${(fs.statSync(archivo).size / 1024).toFixed(1)} KB)`);

  if (rotar) {
    // Solo los respaldos normales de ESTA base (nombre exacto), nunca el recién creado.
    const patron = new RegExp(`^${escapar(c.base)}-\\d{8}-\\d{6}(-\\d+)?\\.dump$`);
    const mios = fs.readdirSync(DIR).filter((f) => patron.test(f) && f !== path.basename(archivo)).sort();
    for (const viejo of mios.slice(0, Math.max(0, mios.length - (MAX - 1)))) {
      fs.rmSync(path.join(DIR, viejo));
      console.log(`Borrado respaldo antiguo: ${viejo}`);
    }
    // Restos de respaldos interrumpidos (Ctrl+C, corte de luz) de más de 6 horas.
    const patronParcial = new RegExp(`^${escapar(c.base)}-.*\\.dump\\.parcial$`);
    for (const f of fs.readdirSync(DIR).filter((f) => patronParcial.test(f))) {
      if (Date.now() - fs.statSync(path.join(DIR, f)).mtimeMs > 6 * 3600 * 1000) { fs.rmSync(path.join(DIR, f)); console.log(`Borrado respaldo interrumpido: ${f}`); }
    }
  }
  return archivo;
}

if (require.main === module) {
  try {
    respaldar();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { respaldar, DIR };
