// Registro de errores del servidor (respuestas 5xx y excepciones no controladas) para el panel
// «Estado del sistema». Nunca se guarda el cuerpo de la petición (puede traer contraseñas).
exports.up = async ({ sequelize }) => {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS "ErrorServidor" (
    id serial PRIMARY KEY,
    fecha timestamptz NOT NULL DEFAULT now(),
    request_id varchar(36),
    metodo varchar(10),
    ruta varchar(300),
    estado integer,
    mensaje text,
    pila text,
    usuario varchar(60)
  )`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS error_servidor_fecha ON "ErrorServidor" (fecha DESC)`);
};

exports.down = async ({ sequelize }) => {
  await sequelize.query(`DROP TABLE IF EXISTS "ErrorServidor"`);
};
