module.exports = app => {
  const imagenes = require("../controllers/imagen.controller.js");
  const { verificarToken, isDistrital } = require("../middlewares/authJwt.js");
  const { limitarIntentos } = require("../middlewares/limitador.js");
  var router = require("express").Router();

  // Fotos de prendas (Cloudinary). Las sube y descarta quien edita el catálogo: el DISTRITAL.
  router.get("/config", verificarToken, imagenes.config);
  router.post("/firma", [limitarIntentos({ max: 60 }), verificarToken, isDistrital], imagenes.firma);
  router.post("/descartar", [verificarToken, isDistrital], imagenes.descartar);

  app.use('/api/imagenes', router);
};
