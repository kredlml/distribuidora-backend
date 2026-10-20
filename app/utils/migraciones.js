// Ajustes de esquema que sync({ alter: true }) no sabe hacer: índices únicos sin distinguir
// mayúsculas. Se ejecutan después de sync. Si la base ya tiene valores repetidos, el índice
// no se crea y el servidor sigue funcionando: se avisa en consola para corregirlos a mano.
const INDICES_UNICOS = [
  { nombre: "empleado_email_lower_unico", tabla: '"Empleado"', expresion: "lower(email)", que: "correos de empleados" },
  { nombre: "categoria_nombre_lower_unico", tabla: '"Categoria"', expresion: "lower(nombre)", que: "nombres de tipos de prenda" },
];

async function asegurarIndicesUnicos(db) {
  for (const i of INDICES_UNICOS) {
    try {
      await db.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${i.nombre} ON ${i.tabla} (${i.expresion})`);
    } catch (error) {
      console.warn(`[migración] No se pudo crear el índice único de ${i.que} (¿hay valores repetidos?): ${error.message}`);
    }
  }
}

module.exports = { asegurarIndicesUnicos };
