module.exports = (sequelize, Sequelize) => {
  const DetalleDevolucion = sequelize.define("DetalleDevolucion", {
    id_detalle_devolucion: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    id_devolucion: { type: Sequelize.INTEGER, allowNull: false },
    id_detalle_pedido: { type: Sequelize.INTEGER, allowNull: false },
    id_producto: { type: Sequelize.INTEGER, allowNull: false },
    cantidad: { type: Sequelize.INTEGER, allowNull: false },
    // Solo aplica si la devolución es de tipo CAMBIO_TALLA / CAMBIO_VARIANTE
    id_producto_nuevo: { type: Sequelize.INTEGER, allowNull: true },
    resultado_revision: {
      type: Sequelize.ENUM('PENDIENTE', 'BUEN_ESTADO', 'DANADO', 'DEFECTUOSO'),
      allowNull: false,
      defaultValue: 'PENDIENTE'
    }
  }, {
    tableName: 'DetalleDevolucion',
    timestamps: false
  });
  return DetalleDevolucion;
};
