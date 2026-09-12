const db = require("../models");
const Auditoria = db.auditoria;

// POST /api/auditoria — normalmente se invoca internamente desde otros controladores
// (ver app/utils/auditoria.js), pero se deja el endpoint por si se necesita registrar
// una auditoría manual desde el front (p.ej. una acción administrativa fuera del flujo de devoluciones).
exports.create = async (req, res) => {
  try {
    if (!req.body.accion || !req.body.tabla_afectada) {
      return res.status(400).send({ message: "accion y tabla_afectada son obligatorios." });
    }
    const data = await Auditoria.create({
      id_empleado: req.body.id_empleado || req.empleadoId || null,
      accion: req.body.accion,
      tabla_afectada: req.body.tabla_afectada,
      registro_afectado_id: req.body.registro_afectado_id || null,
      detalles: req.body.detalles || null
    });
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al registrar la auditoría." });
  }
};

// GET /api/auditoria?tabla_afectada=Devolucion&registro_afectado_id=3
exports.findAll = async (req, res) => {
  try {
    const where = {};
    if (req.query.tabla_afectada) where.tabla_afectada = req.query.tabla_afectada;
    if (req.query.registro_afectado_id) where.registro_afectado_id = req.query.registro_afectado_id;
    if (req.query.id_empleado) where.id_empleado = req.query.id_empleado;

    const data = await Auditoria.findAll({ where, order: [['id_auditoria', 'DESC']] });
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar la auditoría." });
  }
};
