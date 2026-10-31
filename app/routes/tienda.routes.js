module.exports = app => {
  const auth = require("../controllers/tienda_auth.controller.js");
  const tienda = require("../controllers/tienda.controller.js");
  const { verificarCliente } = require("../middlewares/authJwt.js");
  const { limitarIntentos } = require("../middlewares/limitador.js");
  var router = require("express").Router();
  // Un :id no numérico o fuera de rango responde 400 (no un 500 con el error de Postgres).
  router.param("id", require("../middlewares/validarId.js"));

  // Cuenta del cliente (pública: registro e inicio de sesión, con límite de intentos por IP).
  router.post("/auth/registro", limitarIntentos({ max: 10 }), auth.registro);
  router.post("/auth/login", limitarIntentos({ max: 20 }), auth.login);
  // Cliente de mostrador: activa su cuenta web con el código que le dio caja.
  router.post("/auth/activar", limitarIntentos({ max: 10 }), auth.activar);
  // ¿Olvidaste tu contraseña?: enlace de un solo uso al correo, y la contraseña nueva con ese enlace.
  router.post("/auth/olvide", limitarIntentos({ max: 5 }), auth.olvide);
  router.post("/auth/restablecer", limitarIntentos({ max: 10 }), auth.restablecer);
  router.get("/perfil", verificarCliente, auth.perfil);
  router.put("/perfil", verificarCliente, auth.actualizarPerfil);
  router.put("/perfil/password", [limitarIntentos({ max: 10 }), verificarCliente], auth.cambiarPassword);

  // Catálogo (público).
  router.get("/catalogo", tienda.catalogo);
  router.get("/catalogo/:id", tienda.prenda);

  // Pedidos del cliente autenticado.
  router.post("/cotizar", [limitarIntentos({ max: 300 }), verificarCliente], tienda.cotizar);
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
