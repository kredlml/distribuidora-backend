const db = require("../models");

// Registra una fila en Auditoria. Si se pasa "t" (transacción de Sequelize), el registro
// de auditoría se confirma o revierte junto con el resto de la operación que lo origina,
// evitando que quede una auditoría de algo que en realidad falló (o viceversa).
async function registrarAuditoria({ id_empleado, accion, tabla_afectada, registro_afectado_id, detalles }, t) {
  return db.auditoria.create({
    id_empleado: id_empleado || null,
    accion,
    tabla_afectada,
    registro_afectado_id: registro_afectado_id || null,
    detalles: detalles || null
  }, t ? { transaction: t } : undefined);
}

module.exports = { registrarAuditoria };
