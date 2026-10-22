// Valida el parámetro :id de las rutas antes de llegar a la base: un id no numérico respondería
// 500 con el error interno de Postgres. Uso: router.param("id", validarId).
module.exports = (req, res, next, id) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    return res.status(400).send({ message: "El identificador no es válido." });
  }
  next();
};
