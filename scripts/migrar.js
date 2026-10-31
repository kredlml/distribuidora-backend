// Migraciones de la base desde la consola (usa la misma configuración que el servidor):
//   npm run migrar            aplica las pendientes (el servidor también lo hace al arrancar)
//   npm run migrar:estado     lista aplicadas y pendientes, y avisa si un modelo no tiene migración
//   node scripts/migrar.js deshacer   revierte la ÚLTIMA aplicada (si tiene "down"; haz un respaldo antes)
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", process.env.NODE_ENV === "production" ? ".env.production" : ".env.development"), quiet: true });

const db = require("../app/models");
const { crearMigrador, conCandado, prepararBase } = require("../app/utils/migrador");
const { diferencias } = require("../app/utils/esquema");

(async () => {
  const accion = process.argv[2] || "aplicar";
  try {
    console.log(`Base: ${db.sequelize.config.database} en ${db.sequelize.config.host}:${db.sequelize.config.port || 5432}`);
    if (accion === "aplicar") {
      await prepararBase(db);
    } else if (accion === "estado") {
      const m = crearMigrador(db);
      const [hechas, pendientes] = await Promise.all([m.executed(), m.pending()]);
      console.log(`\nAplicadas (${hechas.length}):`); hechas.forEach((x) => console.log(`  ✓ ${x.name}`));
      console.log(`\nPendientes (${pendientes.length}):`); pendientes.forEach((x) => console.log(`  • ${x.name}`));
      const faltan = await diferencias(db.sequelize);
      console.log(faltan.length ? `\nATENCIÓN: en la base faltan ${faltan.join(", ")}.` : "\nLa base tiene todas las columnas de los modelos.");
    } else if (accion === "deshacer") {
      const hecho = await conCandado(db, () => crearMigrador(db).down());
      console.log(hecho.length ? `Revertida: ${hecho.map((x) => x.name).join(", ")}` : "No hay migraciones que revertir.");
    } else {
      console.error(`Acción desconocida "${accion}". Usa: aplicar | estado | deshacer`);
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
})();
