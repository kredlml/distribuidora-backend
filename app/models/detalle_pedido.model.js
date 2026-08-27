module.exports = (sequelize, Sequelize) => {
  const DetallePedido = sequelize.define("DetallePedido", {
    id_detalle_pedido: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    cantidad: { type: Sequelize.INTEGER, allowNull: false },
    precio_unitario: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    subtotal: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    id_pedido: { type: Sequelize.INTEGER, allowNull: false },
    id_producto: { type: Sequelize.INTEGER, allowNull: false }
  }, {
    tableName: 'DetallePedido',
    timestamps: false
  });
  return DetallePedido;
};