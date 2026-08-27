module.exports = (sequelize, Sequelize) => {
  const Pago = sequelize.define("Pago", {
    id_pago: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    metodo_pago: { type: Sequelize.ENUM('STRIPE', 'PAYPAL'), allowNull: false },
    monto: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    fecha_pago: { type: Sequelize.DATE, defaultValue: Sequelize.NOW },
    estado_pago: { 
      type: Sequelize.ENUM('PENDIENTE', 'COMPLETADO', 'FALLIDO', 'REEMBOLSADO'), 
      allowNull: false, 
      defaultValue: 'PENDIENTE' 
    },
    id_transaccion_externa: { type: Sequelize.STRING(150) },
    id_pedido: { type: Sequelize.INTEGER, allowNull: false }
  }, {
    tableName: 'Pago',
    timestamps: false
  });
  return Pago;
};