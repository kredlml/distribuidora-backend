// Herramientas de esquema para las migraciones. Todo es "solo agregar": crea tablas que faltan,
// agrega columnas que faltan y valores de ENUM que faltan. Nunca borra ni cambia el tipo de una
// columna existente (eso es lo peligroso de sync({ alter: true }): puede borrar columnas y datos).

const tablaDe = (modelo) => { const t = modelo.getTableName(); return typeof t === "string" ? t : t.tableName; };
const esEnum = (attr) => attr.type && attr.type.key === "ENUM";
const nombreEnum = (tabla, campo) => `enum_${tabla}_${campo}`;
const literal = (v) => `'${String(v).replace(/'/g, "''")}'`;

// `op` (opcional en todas): opciones de consulta, p. ej. { transaction } para la reparación.
async function tablaExiste(sequelize, tabla, op = {}) {
  const [[{ n }]] = await sequelize.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :tabla`, { ...op, replacements: { tabla } });
  return n === 1;
}

// Columnas reales de la tabla: { campo: { tipoUdt } }.
async function columnasDe(sequelize, tabla, op = {}) {
  const [filas] = await sequelize.query(`SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :tabla`, { ...op, replacements: { tabla } });
  return Object.fromEntries(filas.map((f) => [f.column_name, { udt: f.udt_name }]));
}

// ¿El tipo existe en el esquema actual y es un ENUM? (typtype 'e')
async function esEnumEnBase(sequelize, tipo, op = {}) {
  const [filas] = await sequelize.query(`SELECT t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = current_schema() AND t.typname = :tipo`, { ...op, replacements: { tipo } });
  return filas.length ? filas[0].typtype === "e" : null; // null = no existe
}
async function valoresEnum(sequelize, tipo, op = {}) {
  const [filas] = await sequelize.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = current_schema() AND t.typname = :tipo`, { ...op, replacements: { tipo } });
  return filas.map((f) => f.enumlabel);
}

// Crea el tipo ENUM si no existe y le agrega los valores que falten. ADD VALUE no puede usarse
// dentro de una transacción en versiones viejas de Postgres: las migraciones no usan una.
async function asegurarEnum(sequelize, tipo, valores, op = {}) {
  const existe = await esEnumEnBase(sequelize, tipo, op);
  if (existe === false) throw new Error(`El tipo "${tipo}" existe en la base pero no es un ENUM: escribe una migración de conversión.`);
  if (existe === null) await sequelize.query(`DO $$ BEGIN CREATE TYPE "${tipo}" AS ENUM (${valores.map(literal).join(", ")}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`, op);
  const actuales = new Set(await valoresEnum(sequelize, tipo, op));
  for (const v of valores) if (!actuales.has(v)) await sequelize.query(`ALTER TYPE "${tipo}" ADD VALUE IF NOT EXISTS ${literal(v)}`, op);
}

// Deja la tabla de un modelo con todas sus columnas (y valores de ENUM). Devuelve lo que agregó.
// crearTabla: false = si la tabla no existe no hace nada (la reparación solo agrega columnas).
async function asegurarModelo(sequelize, modelo, { crearTabla = true, ...op } = {}) {
  const tabla = tablaDe(modelo);
  const qi = sequelize.getQueryInterface();
  const hecho = [];
  if (!(await tablaExiste(sequelize, tabla, op))) {
    if (!crearTabla) return hecho;
    await modelo.sync(op); // CREATE TABLE IF NOT EXISTS, con sus ENUM y llaves foráneas
    return [`tabla ${tabla}`];
  }
  const columnas = await columnasDe(sequelize, tabla, op);
  for (const [nombre, attr] of Object.entries(modelo.rawAttributes)) {
    if (attr.type && attr.type.key === "VIRTUAL") continue;
    const campo = attr.field || nombre;
    if (esEnum(attr)) {
      const tipo = columnas[campo] ? columnas[campo].udt : nombreEnum(tabla, campo);
      if (columnas[campo] && (await esEnumEnBase(sequelize, tipo, op)) !== true) {
        throw new Error(`${tabla}.${campo} es "${tipo}" en la base y ENUM en el modelo: escribe una migración de conversión.`);
      }
      await asegurarEnum(sequelize, tipo, attr.values || attr.type.values, op);
      if (!columnas[campo]) {
        const def = attr.defaultValue !== undefined && attr.defaultValue !== null ? ` DEFAULT ${literal(attr.defaultValue)}` : "";
        await sequelize.query(`ALTER TABLE "${tabla}" ADD COLUMN IF NOT EXISTS "${campo}" "${tipo}"${def}${attr.allowNull === false ? " NOT NULL" : ""}`, op);
        hecho.push(`${tabla}.${campo}`);
      }
      continue;
    }
    if (columnas[campo]) continue;
    // Para filas existentes una columna NOT NULL necesita valor por defecto.
    if (attr.allowNull === false && attr.defaultValue === undefined) {
      throw new Error(`No se puede agregar ${tabla}.${campo} (NOT NULL sin valor por defecto) a una tabla con datos: escribe una migración específica.`);
    }
    const { Model, fieldName, _modelAttribute, ...definicion } = attr; // eslint-disable-line no-unused-vars
    await qi.addColumn(tabla, campo, definicion, op);
    hecho.push(`${tabla}.${campo}`);
  }
  return hecho;
}

// Modelos en orden de dependencias (las tablas referenciadas primero), igual que sequelize.sync().
function modelosOrdenados(sequelize) {
  const modelos = [];
  sequelize.modelManager.forEachModel((m) => modelos.push(m));
  return modelos;
}

// Lo que los modelos tienen y la base no (para avisar si falta escribir una migración).
async function diferencias(sequelize) {
  const faltan = [];
  for (const modelo of modelosOrdenados(sequelize)) {
    const tabla = tablaDe(modelo);
    if (tabla === "SequelizeMeta") continue;
    if (!(await tablaExiste(sequelize, tabla))) { faltan.push(`tabla ${tabla}`); continue; }
    const columnas = await columnasDe(sequelize, tabla);
    for (const [nombre, attr] of Object.entries(modelo.rawAttributes)) {
      if (attr.type && attr.type.key === "VIRTUAL") continue;
      const campo = attr.field || nombre;
      if (!columnas[campo]) { faltan.push(`${tabla}.${campo}`); continue; }
      // Un valor nuevo en un ENUM del modelo también necesita migración (asegurarValoresEnum).
      if (esEnum(attr)) {
        const enBase = new Set(await valoresEnum(sequelize, columnas[campo].udt));
        for (const v of attr.values || attr.type.values) if (!enBase.has(v)) faltan.push(`${tabla}.${campo} = '${v}'`);
      }
    }
  }
  return faltan;
}

// ---- Ayudas para migraciones 0002 en adelante. TODA migración debe poder correr dos veces sin
// fallar: en una base nueva la línea base (0001) ya crea el esquema de los modelos actuales, y
// después corren las demás. Por eso se usan estas ayudas "si no existe".
async function asegurarColumna(sequelize, tabla, campo, definicion) {
  if ((await columnasDe(sequelize, tabla))[campo]) return false;
  await sequelize.getQueryInterface().addColumn(tabla, campo, definicion);
  return true;
}
// Valores nuevos de la columna ENUM de un modelo (toma el tipo real de la columna en la base).
async function asegurarValoresEnum(sequelize, tabla, campo, valores) {
  const col = (await columnasDe(sequelize, tabla))[campo];
  await asegurarEnum(sequelize, col ? col.udt : nombreEnum(tabla, campo), valores);
}

module.exports = { asegurarModelo, asegurarEnum, asegurarColumna, asegurarValoresEnum, modelosOrdenados, diferencias, tablaExiste, columnasDe };
