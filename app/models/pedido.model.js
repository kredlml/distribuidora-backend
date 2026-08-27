module.exports = (sequelize, Sequelize) => {
  const Pedido = sequelize.define("Pedido", {
    id_pedido: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    fecha_pedido: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
    estado: { 
      type: Sequelize.ENUM('PENDIENTE', 'PROCESADO', 'ENVIADO', 'ENTREGADO', 'CANCELADO'), 
      allowNull: false, 
      defaultValue: 'PENDIENTE' 
    },
    total: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    id_cliente: { type: Sequelize.INTEGER, allowNull: false },
    id_sucursal: { type: Sequelize.INTEGER, allowNull: false },
    id_empleado: { type: Sequelize.INTEGER }
  }, {
    tableName: 'Pedido',
    timestamps: false
  });
  return Pedido;
};