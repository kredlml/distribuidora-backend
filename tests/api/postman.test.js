// Corre la colección de Postman completa (newman) contra el backend sobre la base desechable vacía.
// Puerto propio (18090) y verificación de identidad: nunca toca el backend real (8080).
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");
fs.mkdirSync(SALIDAS, { recursive: true });

const PORT = 18090;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_PORT: "54329", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "", CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-postman"),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });

(async () => {
  if (await ocupado(PORT)) { console.error(`ABORTADO: el puerto ${PORT} ya está en uso.`); process.exit(1); }
  const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const out = fs.openSync(path.join(SALIDAS, "postman-servidor.log"), "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
  let listo = false;
  for (let i = 0; i < 160 && !listo; i++) { await sleep(500); try { listo = (await fetch(`http://localhost:${PORT}/api/sucursales`)).ok; } catch {} }
  const r0 = await fetch(`http://localhost:${PORT}/api/sucursales`).then((r) => r.json()).catch(() => null);
  if (!Array.isArray(r0) || r0.length !== 0) { console.error("ABORTADO: el servidor de prueba no es el de la base desechable."); srv.kill(); process.exit(1); }
  const r = spawnSync("npx", ["--yes", "newman@6.2.1", "run", path.join(B, "postman/distribuidora-backend.postman_collection.json"),
    "--env-var", `baseUrl=http://localhost:${PORT}`, "--reporters", "cli", "--color", "off"], { encoding: "utf8", shell: true, cwd: SALIDAS });
  const salida = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(path.join(SALIDAS, "postman.txt"), salida);
  srv.kill();
  await pg.end();
  const fila = (nombre) => { const m = salida.match(new RegExp(`${nombre}\\s*│\\s*(\\d+)\\s*│\\s*(\\d+)`)); return m ? [Number(m[1]), Number(m[2])] : null; };
  const pet = fila("requests"), ase = fila("assertions");
  const errores = salida.split("\n").filter((l) => /^\s*\d+\.\s+\w*Error/.test(l));
  errores.forEach((l) => console.log("  FAIL " + l.trim()));
  if (!pet || !ase) { console.log(salida.slice(-2000)); console.log("\nRESULTADO: 0 ok, 1 fallos"); process.exit(1); }
  const fallos = pet[1] + ase[1];
  console.log(`  ${pet[0]} peticiones, ${ase[0]} aserciones`);
  console.log(`\nRESULTADO: ${ase[0] - ase[1]} ok, ${fallos} fallos`);
  process.exit(fallos ? 1 : 0);
})();
