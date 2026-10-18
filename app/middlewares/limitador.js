// Límite simple de intentos por IP y ruta (en memoria). Frena el uso por fuerza bruta de los
// endpoints públicos de cuentas: adivinar contraseñas o consultar qué correos están registrados.
// Para varias instancias del servidor habría que guardar los contadores en un almacén compartido.
exports.limitarIntentos = ({ max = 20, ventanaMs = 15 * 60 * 1000 } = {}) => {
  const intentos = new Map(); // clave -> { n, desde }

  // Limpieza periódica para que el mapa no crezca sin límite.
  setInterval(() => {
    const ahora = Date.now();
    for (const [clave, r] of intentos) if (ahora - r.desde > ventanaMs) intentos.delete(clave);
  }, ventanaMs).unref();

  return (req, res, next) => {
    const clave = `${req.ip}|${req.baseUrl}${req.path}`;
    const ahora = Date.now();
    const r = intentos.get(clave);
    if (!r || ahora - r.desde > ventanaMs) {
      intentos.set(clave, { n: 1, desde: ahora });
      return next();
    }
    r.n += 1;
    if (r.n > max) {
      const espera = Math.ceil((r.desde + ventanaMs - ahora) / 60000);
      res.set('Retry-After', String(Math.ceil((r.desde + ventanaMs - ahora) / 1000)));
      return res.status(429).send({ message: `Demasiados intentos. Vuelve a intentarlo en ${espera} minuto(s).` });
    }
    next();
  };
};
