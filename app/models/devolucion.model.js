module.exports = (sequelize, Sequelize) => {
  const Devolucion = sequelize.define("Devolucion", {
    id_devolucion: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    id_pedido: { type: Sequelize.INTEGER, allowNull: false },
    id_cliente: { type: Sequelize.INTEGER, allowNull: false },
    tipo: {
      type: Sequelize.ENUM('DEVOLUCION', 'CAMBIO_TALLA', 'CAMBIO_VARIANTE'),
      allowNull: false
    },
    motivo: {
      type: Sequelize.ENUM('DEFECTUOSO', 'TALLA_INCORRECTA', 'PRODUCTO_INCORRECTO', 'DANADO_ENVIO', 'OTRO'),
      allowNull: false
    },
    estado: {
      type: Sequelize.ENUM(
        'SOLICITADA',
        'APROBADA',
        'RECHAZADA',
        'RECIBIDA',
        'EN_REVISION',
        'ACEPTADA',
        'RECHAZADA_EN_REVISION',
        'REINTEGRADA',
        'CAMBIADA'
      ),
      allowNull: false,
      defaultValue: 'SOLICITADA'
    },
    observacion: { type: Sequelize.STRING(255) },
    id_empleado_gestor: { type: Sequelize.INTEGER, allowNull: true },
    fecha_solicitud: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
    fecha_actualizacion: { type: Sequelize.DATE, allowNull: true }
  }, {
    tableName: 'Devolucion',
    timestamps: false
  });
  return Devolucion;
};
