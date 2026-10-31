const jwt = require("jsonwebtoken");
const db = require("../models");
const Empleado = db.empleado;

// Puestos que reconocen los controles de rol. DISTRITAL (gerente distrital) está por encima del
// ADMIN (gerente de una sucursal): ve y opera todas las sucursales y es el único que maneja el
// catálogo, las sucursales y la auditoría. ADMIN, CAJERO y BODEGUERO trabajan solo con los datos
// de su propia sucursal (ver app/utils/alcance.js).
exports.PUESTOS_VALIDOS = ["DISTRITAL", "ADMIN", "CAJERO", "BODEGUERO"];

const puestoDe = (empleado) => String((empleado && empleado.puesto) || "").trim().toUpperCase();
exports.puestoDe = puestoDe;

// Valida el JWT de un empleado y que su cuenta siga existiendo y activa: así, desactivar a un
// empleado le corta el acceso al instante aunque su token aún no haya expirado. El empleado
// queda en req.empleado para que los controles de rol no lo vuelvan a consultar.
exports.verificarToken = (req, res, next) => {
  let tokenHeader = req.headers["authorization"];

  if (!tokenHeader) {
    return res.status(403).send({ message: "¡No se proporcionó un token de seguridad!" });
  }

  const token = tokenHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "¡Token no autorizado o expirado!" });
    }
    // Los tokens de la tienda en línea (clientes) no dan acceso al panel de empleados.
    if (decoded.tipo === "CLIENTE" || !decoded.id) {
      return res.status(403).send({ message: "¡Acceso denegado! Este token no pertenece a un empleado." });
    }
    try {
      const empleado = await Empleado.findByPk(decoded.id, { attributes: { exclude: ['password'] } });
      if (!empleado || empleado.activo === false) {
        return res.status(401).send({ message: "¡Token no autorizado! La cuenta del empleado no existe o está desactivada." });
      }
      // Tokens emitidos antes de un cambio de contraseña (o de una desactivación) ya no valen.
      if ((decoded.v || 0) !== (empleado.token_version || 0)) {
        return res.status(401).send({ message: "¡Token no autorizado! La sesión ya no es válida, inicia sesión de nuevo." });
      }
      req.empleadoId = empleado.id_empleado;
      req.empleado = empleado;
      next();
    } catch (error) {
      res.status(500).send({ message: "Error al validar la sesión del empleado." });
    }
  });
};

// Rutas de la tienda en línea: exige un token de cliente (tipo CLIENTE) de una cuenta activa.
exports.verificarCliente = (req, res, next) => {
  const tokenHeader = req.headers["authorization"];
  if (!tokenHeader) {
    return res.status(403).send({ message: "¡No se proporcionó un token de seguridad!" });
  }

  jwt.verify(tokenHeader.split(" ")[1], process.env.JWT_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "¡Token no autorizado o expirado!" });
    }
    if (decoded.tipo !== "CLIENTE" || !decoded.id_cliente) {
      return res.status(403).send({ message: "¡Acceso denegado! Este token no pertenece a un cliente de la tienda." });
    }
    try {
      const cliente = await db.cliente.unscoped().findByPk(decoded.id_cliente, { attributes: ["id_cliente", "activo", "token_version"] });
      if (!cliente || !cliente.activo) {
        return res.status(401).send({ message: "¡Token no autorizado! La cuenta no existe o está desactivada." });
      }
      // La contraseña cambió después de emitir este token: la sesión ya no vale.
      if ((decoded.v || 0) !== (cliente.token_version || 0)) {
        return res.status(401).send({ message: "Tu sesión se cerró porque la contraseña cambió. Vuelve a iniciar sesión." });
      }
      req.clienteId = cliente.id_cliente;
      next();
    } catch (error) {
      res.status(500).send({ message: "Error al validar la sesión del cliente." });
    }
  });
};

// Fábrica de controles de rol: el puesto se lee de la base en cada petición (req.empleado),
// así un cambio de puesto aplica de inmediato aunque el token se haya emitido antes.
function exigirPuesto(puestos, mensaje) {
  return async (req, res, next) => {
    try {
      const empleado = req.empleado || await Empleado.findByPk(req.empleadoId);
      if (empleado && empleado.activo !== false && puestos.includes(puestoDe(empleado))) {
        return next();
      }
      res.status(403).send({ message: mensaje });
    } catch (error) {
      res.status(500).send({ message: "Error al validar el rol de usuario." });
    }
  };
}

exports.isDistrital = exigirPuesto(["DISTRITAL"], "¡Acceso denegado! Esta acción es solo del gerente distrital.");

exports.isAdmin = exigirPuesto(["ADMIN", "DISTRITAL"], "¡Acceso denegado! Esta acción requiere privilegios de Administrador.");


// Registro de empleados: con la base vacía, el primer empleado puede registrarse sin token
// (queda como ADMIN, ver auth.controller). A partir de ahí solo un ADMIN autenticado registra.
exports.permitirRegistro = async (req, res, next) => {
  try {
    if (await Empleado.count() === 0) {
      req.registroInicial = true;
      return next();
    }
  } catch (error) {
    return res.status(500).send({ message: "Error al validar el registro." });
  }
  exports.verificarToken(req, res, () => exports.isAdmin(req, res, next));
};


exports.isCajero = exigirPuesto(["CAJERO", "ADMIN", "DISTRITAL"], "¡Acceso denegado! Solo los cajeros autorizados pueden realizar ventas.");


exports.isBodeguero = exigirPuesto(["BODEGUERO", "ADMIN", "DISTRITAL"], "¡Acceso denegado! Solo el personal de bodega puede alterar el inventario.");
