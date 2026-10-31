// Línea base: deja cualquier base (vacía, o una que se manejaba con sync({ alter: true }) antes de
// existir las migraciones) con el esquema actual del proyecto. Es idempotente y solo AGREGA:
// tablas, columnas y valores de ENUM que falten, y los índices únicos sin distinguir mayúsculas.
// Los cambios de esquema posteriores van en migraciones nuevas (0002-…, 0003-…), nunca aquí.
const { asegurarModelo, modelosOrdenados } = require("../utils/esquema");

const INDICES_UNICOS = [
  { nombre: "empleado_email_lower_unico", tabla: '"Empleado"', expresion: "lower(email)", que: "correos de empleados" },
  { nombre: "categoria_nombre_lower_unico", tabla: '"Categoria"', expresion: "lower(nombre)", que: "nombres de tipos de prenda" },
  { nombre: "cliente_email_lower_unico", tabla: '"Cliente"', expresion: "lower(email)", que: "correos de clientes" },
];

exports.up = async ({ sequelize }) => {
  for (const modelo of modelosOrdenados(sequelize)) {
    if (modelo.name === "SequelizeMeta") continue;
    const hecho = await asegurarModelo(sequelize, modelo);
    if (hecho.length) console.log(`[migración] agregado: ${hecho.join(", ")}`);
  }
  for (const i of INDICES_UNICOS) {
    try {
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${i.nombre} ON ${i.tabla} (${i.expresion})`);
    } catch (error) {
      // Con valores repetidos el índice no se puede crear: se avisa y el sistema sigue (la app ya
      // valida duplicados sin distinguir mayúsculas al guardar).
      console.warn(`[migración] No se pudo crear el índice único de ${i.que} (¿hay valores repetidos?): ${error.message}`);
    }
  }
};

// La línea base no se deshace: borraría todas las tablas.
exports.down = async () => { throw new Error("La migración base no se puede deshacer (borraría toda la base). Restaura un respaldo."); };
