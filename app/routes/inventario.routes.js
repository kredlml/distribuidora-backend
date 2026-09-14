module.exports = app => {
  const inventarios = require("../controllers/inventario.controller.js");
  const { verificarToken, isBodeguero } = require("../middlewares/authJwt.js"); 
  
  var router = require("express").Router();

  
  router.post("/", [verificarToken, isBodeguero], inventarios.create);
  
  
  router.get("/", verificarToken, inventarios.findAll);
  router.get("/stock", verificarToken, inventarios.getStockGlobal);

  app.use('/api/inventario', router);
};