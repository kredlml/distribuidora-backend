module.exports = (sequelize, Sequelize) => {
  // Recalcula el total del Pedido sumando el subtotal de todos sus detalles
  const actualizarTotalPedido = async (detalle, options) => {
    const Pedido = sequelize.models.Pedido;
    const totalActual = await DetallePedido.sum('subtotal', {
      where: { id_pedido: detalle.id_pedido },
      transaction: options.transaction
    });

    await Pedido.update(
      { total: totalActual || 0 },
      { where: { id_pedido: detalle.id_pedido }, transaction: options.transaction }
    );
  };

  const DetallePedido = sequelize.define("DetallePedido", {
    id_detalle_pedido: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    cantidad: { type: Sequelize.INTEGER, allowNull: false },
    precio_unitario: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    subtotal: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    id_pedido: { type: Sequelize.INTEGER, allowNull: false },
    id_producto: { type: Sequelize.INTEGER, allowNull: false }
  }, {
    tableName: 'DetallePedido',
    timestamps: false,
    hooks: {
      afterCreate: actualizarTotalPedido,
      afterDestroy: actualizarTotalPedido
    }
  });

  return DetallePedido;
};