module.exports = (sequelize, Sequelize) => {
  // Dinero que se le devuelve a la clienta por una devolución (o la diferencia de un cambio por una
  // variante más barata). Con tarjeta en línea (STRIPE) se reembolsa automáticamente en Stripe; con
  // EFECTIVO, TARJETA (POS) o PAYPAL queda PENDIENTE hasta que caja lo entrega y lo confirma.
  const Reembolso = sequelize.define("Reembolso", {
    id_reembolso: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    id_devolucion: { type: Sequelize.INTEGER, allowNull: true },
    id_pedido: { type: Sequelize.INTEGER, allowNull: false },
    // Pago de Stripe sobre el que se hace el reembolso (solo metodo STRIPE).
    id_pago: { type: Sequelize.INTEGER, allowNull: true },
    metodo: { type: Sequelize.ENUM('STRIPE', 'EFECTIVO', 'TARJETA', 'PAYPAL'), allowNull: false },
    monto: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    estado: { type: Sequelize.ENUM('PENDIENTE', 'COMPLETADO', 'FALLIDO'), allowNull: false, defaultValue: 'PENDIENTE' },
    // Id del reembolso en Stripe (re_...) o referencia del voucher/comprobante en caja.
    id_transaccion_externa: { type: Sequelize.STRING(150), allowNull: true },
    // Empleado que lo entregó en caja (o que lo reintentó en Stripe).
    id_empleado: { type: Sequelize.INTEGER, allowNull: true },
    observacion: { type: Sequelize.STRING(255), allowNull: true },
    // Reserva mientras se habla con Stripe: dos «Reintentar» simultáneos no procesan el mismo
    // reembolso a la vez (una reserva de más de 2 minutos se considera abandonada).
    procesando_desde: { type: Sequelize.DATE, allowNull: true },
    fecha_creacion: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW },
    fecha_completado: { type: Sequelize.DATE, allowNull: true }
  }, {
    tableName: 'Reembolso',
    timestamps: false
  });
  return Reembolso;
};
