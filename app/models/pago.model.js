module.exports = (sequelize, Sequelize) => {
  const Pago = sequelize.define("Pago", {
    id_pago: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    // STRIPE: tarjeta en la tienda en línea. PAYPAL: queda pendiente hasta que caja lo confirma.
    // EFECTIVO y TARJETA (terminal POS de la tienda física): el cajero recibe el dinero en el
    // momento, así que el pago nace COMPLETADO.
    metodo_pago: { type: Sequelize.ENUM('STRIPE', 'PAYPAL', 'EFECTIVO', 'TARJETA'), allowNull: false },
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