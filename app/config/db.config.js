module.exports = {
  HOST: process.env.DB_HOST,
  // Puerto opcional (por defecto el de PostgreSQL, 5432).
  PORT: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
  USER: process.env.DB_USER,
  PASSWORD: process.env.DB_PASSWORD,
  DB: process.env.DB_NAME,
  dialect: process.env.DB_DIALECT || "postgres",
  // SSL activado salvo DB_SSL=false (bases locales o de pruebas sin SSL).
  ssl: process.env.DB_SSL !== "false",
  pool: {
    max: Number(process.env.DB_POOL_MAX) || 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
};
