module.exports = (sequelize, Sequelize) => {
  const MovimientoInventario = sequelize.define("MovimientoInventario", {
    id_movimiento: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    id_inventario: { type: Sequelize.INTEGER, allowNull: true },
    id_producto: { type: Sequelize.INTEGER, allowNull: false },
    id_pedido: { type: Sequelize.INTEGER, allowNull: true },
    id_devolucion: { type: Sequelize.INTEGER, allowNull: true },
    // Empleado responsable de la operación. NULL cuando el movimiento lo
    // origina el propio cliente (p.ej. solicitud de devolución) o el sistema.
    id_empleado: { type: Sequelize.INTEGER, allowNull: true },
    tipo_movimiento: {
      type: Sequelize.ENUM(
        'VENTA',
        'DEVOLUCION_SOLICITADA',
        'DEVOLUCION_RECIBIDA',
        'EN_REVISION',
        'REINTEGRACION',
        'CAMBIO_SALIDA',
        'CAMBIO_ENTRADA',
        'PRODUCTO_DANADO',
        'PRODUCTO_DEFECTUOSO'
      ),
      allowNull: false
    },
    cantidad: { type: Sequelize.INTEGER, allowNull: false },
    estado_anterior: { type: Sequelize.STRING(30), allowNull: true },
    estado_nuevo: { type: Sequelize.STRING(30), allowNull: true },
    observacion: { type: Sequelize.STRING(255), allowNull: true },
    fecha_movimiento: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
  }, {
    tableName: 'MovimientoInventario',
    // Sin timestamps de Sequelize: el historial es inmutable y solo se crea (create),
    // nunca se expone update/delete desde el controlador.
    timestamps: false
  });
  return MovimientoInventario;
};
