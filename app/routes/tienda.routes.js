module.exports = app => {
  const auth = require("../controllers/tienda_auth.controller.js");
  const tienda = require("../controllers/tienda.controller.js");
  const { verificarCliente } = require("../middlewares/authJwt.js");
  const { limitarIntentos } = require("../middlewares/limitador.js");
  var router = require("express").Router();

  // Cuenta del cliente (pública: registro e inicio de sesión, con límite de intentos por IP).
  router.post("/auth/registro", limitarIntentos({ max: 10 }), auth.registro);
  router.post("/auth/login", limitarIntentos({ max: 20 }), auth.login);
  // Cliente de mostrador: activa su cuenta web con el código que le dio caja.
  router.post("/auth/activar", limitarIntentos({ max: 10 }), auth.activar);
  router.get("/perfil", verificarCliente, auth.perfil);
  router.put("/perfil", verificarCliente, auth.actualizarPerfil);

  // Catálogo (público).
  router.get("/catalogo", tienda.catalogo);
  router.get("/catalogo/:id", tienda.prenda);

  // Pedidos del cliente autenticado.
  router.post("/pedidos", verificarCliente, tienda.crearPedido);
  router.get("/pedidos", verificarCliente, tienda.misPedidos);
  router.get("/pedidos/:id", verificarCliente, tienda.miPedido);
  router.post("/pedidos/:id/cancelar", verificarCliente, tienda.cancelarPedido);
  router.post("/pedidos/:id/pago", verificarCliente, tienda.iniciarPago);
  router.post("/pedidos/:id/pago/confirmar", verificarCliente, tienda.confirmarPago);
  router.get("/pedidos/:id/devolvible", verificarCliente, tienda.devolvible);

  // Devoluciones y cambios (entran al flujo de Logística inversa).
  router.post("/devoluciones", verificarCliente, tienda.solicitarDevolucion);
  router.get("/devoluciones", verificarCliente, tienda.misDevoluciones);
  router.get("/devoluciones/:id", verificarCliente, tienda.miDevolucion);

  app.use('/api/tienda', router);
};
