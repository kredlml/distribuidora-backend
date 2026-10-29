const db = require("../models");
const { puestoDe } = require("../middlewares/authJwt");

// Alcance por sucursal de cada empleado. El DISTRITAL ve todas las sucursales; ADMIN, CAJERO y
// BODEGUERO solo la suya (Empleado.id_sucursal). Un empleado sin sucursal que no sea DISTRITAL no
// ve datos de ninguna (alcance -1). Requiere req.empleado (lo deja verificarToken).

const SIN_SUCURSAL = -1;
const esDistrital = (req) => puestoDe(req.empleado) === "DISTRITAL";

// null = todas las sucursales; número = solo esa.
function sucursalDe(req) {
  if (esDistrital(req)) return null;
  return (req.empleado && req.empleado.id_sucursal) || SIN_SUCURSAL;
}

function enAlcance(req, idSucursal) {
  const s = sucursalDe(req);
  return s === null || (idSucursal !== null && idSucursal !== undefined && Number(idSucursal) === s);
}

// Condición para un where de Sequelize sobre la columna indicada ({} si ve todas).
function whereSucursal(req, campo = "id_sucursal") {
  const s = sucursalDe(req);
  return s === null ? {} : { [campo]: s };
}

// Fábrica de middlewares: `cargarSucursal(req)` devuelve la sucursal del registro que se quiere
// tocar, o undefined si el registro no existe (el controlador responde 404 como siempre). Si el
// registro es de otra sucursal se responde 404: para ese empleado no existe.
function exigirAlcance(cargarSucursal) {
  return async (req, res, next) => {
    if (sucursalDe(req) === null) return next();
    try {
      const idSucursal = await cargarSucursal(req);
      if (idSucursal === undefined) return next();
      if (!enAlcance(req, idSucursal)) {
        return res.status(404).send({ message: "No se encontró el registro en tu sucursal." });
      }
      next();
    } catch (error) {
      res.status(500).send({ message: "Error al validar la sucursal del registro." });
    }
  };
}

// Cargadores habituales (devuelven la sucursal o undefined si no existe).
const pedidoSucursal = async (id) => {
  if (!Number.isInteger(Number(id)) || Number(id) <= 0) return undefined;
  const p = await db.pedido.findByPk(id, { attributes: ["id_sucursal"] });
  return p ? p.id_sucursal : undefined;
};
const cargadores = {
  pedidoParam: (req) => pedidoSucursal(req.params.id),
  pedidoBody: (req) => pedidoSucursal(req.body && req.body.id_pedido),
  pedidoParamIdPedido: (req) => pedidoSucursal(req.params.id_pedido),
  pagoParam: async (req) => {
    const pago = await db.pago.findByPk(req.params.id, { attributes: ["id_pedido"] });
    return pago ? pedidoSucursal(pago.id_pedido) : undefined;
  },
  detalleParam: async (req) => {
    const d = await db.detalle_pedido.findByPk(req.params.id, { attributes: ["id_pedido"] });
    return d ? pedidoSucursal(d.id_pedido) : undefined;
  },
  devolucionParam: async (req) => {
    if (!Number.isInteger(Number(req.params.id)) || Number(req.params.id) <= 0) return undefined;
    const d = await db.devolucion.findByPk(req.params.id, { attributes: ["id_pedido"] });
    return d ? pedidoSucursal(d.id_pedido) : undefined;
  },
};

// Clientes que "pertenecen" a una sucursal: los que se registraron en ella o le han comprado
// (un pedido cancelado no cuenta).
function whereClientesDeSucursal(idSucursal) {
  const { Op } = db.Sequelize;
  return {
    [Op.or]: [
      { id_sucursal: idSucursal },
      { id_cliente: { [Op.in]: db.sequelize.literal(`(SELECT "id_cliente" FROM "Pedido" WHERE "id_sucursal" = ${Number(idSucursal)} AND "estado" <> 'CANCELADO')`) } }
    ]
  };
}
async function clienteEnAlcance(req, idCliente) {
  const s = sucursalDe(req);
  if (s === null) return true;
  const n = await db.cliente.count({ where: { id_cliente: idCliente, ...whereClientesDeSucursal(s) } });
  return n > 0;
}

module.exports = { SIN_SUCURSAL, esDistrital, sucursalDe, enAlcance, whereSucursal, exigirAlcance, cargadores, whereClientesDeSucursal, clienteEnAlcance };
