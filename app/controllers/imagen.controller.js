const db = require("../models");
const cloudinary = require("../config/cloudinary.config");

// Borra la foto de Cloudinary solo si ninguna prenda la usa (las variantes pueden compartirla).
async function borrarSiNadieLaUsa(url) {
  if (!cloudinary.publicIdDe(url)) return false;
  const enUso = await db.producto.count({ where: { imagen_url: url } });
  return enUso === 0 ? cloudinary.destruir(url) : false;
}
exports.borrarSiNadieLaUsa = borrarSiNadieLaUsa;

// GET /api/imagenes/config — si está activada la subida de fotos (para mostrar el botón).
exports.config = (req, res) => {
  res.send({ habilitado: cloudinary.configurado(), max_mb: cloudinary.MAX_MB });
};

// POST /api/imagenes/firma — permiso firmado para subir UNA foto a la carpeta de prendas.
exports.firma = (req, res) => {
  if (!cloudinary.configurado()) {
    return res.status(503).send({ message: "La subida de fotos no está configurada (faltan las variables CLOUDINARY_* del backend). Pega un enlace a la imagen." });
  }
  res.send(cloudinary.firmaDeSubida());
};

// POST /api/imagenes/descartar { urls: [...] } — fotos subidas que al final no se guardaron
// (se cambió por otra o se canceló el formulario). Solo se borran las nuestras que ninguna prenda usa.
exports.descartar = async (req, res) => {
  try {
    const urls = Array.isArray((req.body || {}).urls) ? req.body.urls.filter((u) => typeof u === "string").slice(0, 20) : [];
    let borradas = 0;
    for (const url of urls) if (await borrarSiNadieLaUsa(url)) borradas++;
    res.send({ borradas });
  } catch (error) {
    res.status(500).send({ message: "No se pudieron descartar las fotos." });
  }
};
