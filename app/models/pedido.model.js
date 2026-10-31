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
    id_empleado: { type: Sequelize.INTEGER },
    // Dirección a la que se despacha (pedidos de la tienda en línea). NULL en ventas de mostrador.
    direccion_entrega: { type: Sequelize.STRING(200), allowNull: true },
    // Momento en que se marcó ENTREGADO: desde ahí corre el plazo para pedir cambio o devolución.
    fecha_entrega: { type: Sequelize.DATE, allowNull: true },
    // Envío a domicilio (tienda en línea; 0 en retiro en sucursal y en mostrador).
    costo_envio: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    // Lo que descontó el cupón sobre las prendas. total = max(0, líneas − descuento) + envío.
    descuento: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    id_cupon: { type: Sequelize.INTEGER, allowNull: true },
    // Copia del cupón al momento de usarlo: si después el DISTRITAL edita el cupón, los pedidos ya
    // creados no cambian de precio.
    cupon_tipo: { type: Sequelize.STRING(12), allowNull: true },
    cupon_valor: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
    cupon_minimo: { type: Sequelize.DECIMAL(10, 2), allowNull: true }
  }, {
    tableName: 'Pedido',
    timestamps: false
  });
  return Pedido;
};