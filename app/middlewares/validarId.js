// Valida el parámetro :id de las rutas antes de llegar a la base: un id no numérico (o "1e3", o
// fuera del rango de INTEGER de Postgres) respondería 500 con el error interno de la base.
// Uso: router.param("id", validarId). esIdValido se reutiliza para ids en query/body.
const MAX_INT = 2147483647;
const esIdValido = (valor) => /^[1-9]\d{0,9}$/.test(String(valor)) && Number(valor) <= MAX_INT;

module.exports = (req, res, next, id) => {
  if (!esIdValido(id)) {
    return res.status(400).send({ message: "El identificador no es válido." });
  }
  next();
};
module.exports.esIdValido = esIdValido;
