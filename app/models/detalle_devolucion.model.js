module.exports = (sequelize, Sequelize) => {
  const DetalleDevolucion = sequelize.define("DetalleDevolucion", {
    id_detalle_devolucion: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    id_devolucion: { type: Sequelize.INTEGER, allowNull: false },
    id_detalle_pedido: { type: Sequelize.INTEGER, allowNull: false },
    id_producto: { type: Sequelize.INTEGER, allowNull: false },
    cantidad: { type: Sequelize.INTEGER, allowNull: false },
    // Solo aplica si la devolución es de tipo CAMBIO_TALLA / CAMBIO_VARIANTE
    id_producto_nuevo: { type: Sequelize.INTEGER, allowNull: true },
    // Precio de la variante nueva cuando se pidió el cambio (el que se validó). La diferencia a
    // reembolsar se calcula con él aunque después cambie el precio del catálogo.
    precio_unitario_nuevo: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
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
