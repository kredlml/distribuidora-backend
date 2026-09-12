const db = require("../models");
const Auditoria = db.auditoria;


exports.registrarAuditoria = async (idEmpleado, accion, tabla, idRegistro, detalles = "") => {
  try {
    await Auditoria.create({
      id_empleado: idEmpleado,
      accion: accion,
      tabla_afectada: tabla,
      registro_afectado_id: idRegistro,
      detalles: detalles
    });
  } catch (error) {
    console.error(" Error silencioso al registrar auditoría:", error.message);
    
  }
};