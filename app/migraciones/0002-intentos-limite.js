// Contadores del límite de intentos (login, registro, «olvidé mi contraseña»…) en la base en vez
// de en memoria: sobreviven a un reinicio y se comparten entre varias instancias del servidor.
// La clave es un hash SHA-256 de IP + ruta (no se guarda la IP en claro).
exports.up = async ({ sequelize }) => {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS "IntentoLimite" (
    clave varchar(64) PRIMARY KEY,
    n integer NOT NULL,
    desde timestamptz NOT NULL
  )`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS intento_limite_desde ON "IntentoLimite" (desde)`);
};

exports.down = async ({ sequelize }) => {
  await sequelize.query(`DROP TABLE IF EXISTS "IntentoLimite"`);
};
