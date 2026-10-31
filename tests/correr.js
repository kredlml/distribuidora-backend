#!/usr/bin/env node
// Corre las pruebas del proyecto sobre un PostgreSQL desechable (tests/.pgdata, puerto 54329).
// Nunca usan la base de .env.development: cada suite borra y recrea su esquema.
//
//   npm test                 pruebas de API (rápidas, sin navegador)
//   npm run test:navegador   pruebas de interfaz con Chrome (panel y tienda)
//   npm run test:todo        todas
//   node tests/correr.js api/ventas    solo las suites cuyo nombre contenga "api/ventas"
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const postgres = require("./soporte/postgres");

const args = process.argv.slice(2);
const grupos = args.includes("--todo") ? ["api", "navegador"] : args.includes("--navegador") ? ["navegador"] : ["api"];
const filtro = args.find((a) => !a.startsWith("--"));

const suites = (filtro ? ["api", "navegador"] : grupos).flatMap((g) =>
  fs.readdirSync(path.join(__dirname, g)).filter((f) => f.endsWith(".test.js")).sort().map((f) => `${g}/${f}`))
  .filter((s) => !filtro || s.includes(filtro));
if (!suites.length) { console.error("No hay suites que coincidan."); process.exit(1); }

(async () => {
  fs.mkdirSync(path.join(__dirname, "salidas"), { recursive: true });
  let arrancado = false;
  try {
    arrancado = await postgres.iniciar();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const resumen = [];
  for (const s of suites) {
    console.log(`\n━━━ ${s}`);
    const inicio = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const salida = (r.stdout || "") + (r.stderr || "");
    const fallas = salida.split("\n").filter((l) => /^\s*FAIL|Error:|excepción/.test(l));
    fallas.slice(0, 15).forEach((l) => console.log(l));
    const m = salida.match(/RESULTADO: (\d+) ok, (\d+) fallos/);
    const ok = m ? Number(m[1]) : 0, mal = m ? Number(m[2]) : 1;
    console.log(m ? m[0] : "Sin resultado (la suite terminó con error)");
    fs.writeFileSync(path.join(__dirname, "salidas", s.replace("/", "-").replace(".test.js", ".txt")), salida);
    resumen.push({ suite: s, ok, mal: r.status === 0 ? mal : Math.max(mal, 1), segundos: Math.round((Date.now() - inicio) / 1000) });
  }
  if (arrancado) postgres.detener();

  console.log("\n━━━ Resumen");
  for (const r of resumen) console.log(`${r.mal ? "✗" : "✓"} ${r.suite.padEnd(30)} ${String(r.ok).padStart(4)} ok  ${String(r.mal).padStart(3)} fallos  ${r.segundos}s`);
  const total = resumen.reduce((a, r) => ({ ok: a.ok + r.ok, mal: a.mal + r.mal }), { ok: 0, mal: 0 });
  console.log(`\nTotal: ${total.ok} verificaciones correctas, ${total.mal} fallos. Detalle en tests/salidas/.`);
  process.exit(total.mal ? 1 : 0);
})();
