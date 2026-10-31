// Comprobante de entrada (CE-000001) o de salida (CS-000001) de mercadería. Lo genera el sistema
// en la misma transacción que mueve el stock, y nunca se edita ni se borra (no hay rutas para eso).
// El número es correlativo por tipo y sin huecos (ver utils/comprobantes.js).
module.exports = (sequelize, Sequelize) => {
  const Comprobante = sequelize.define("Comprobante", {
    id_comprobante: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    tipo: { type: Sequelize.ENUM('ENTRADA', 'SALIDA'), allowNull: false },
    numero: { type: Sequelize.INTEGER, allowNull: false },
    // ENTRADA: INGRESO_PROVEEDOR, INGRESO_DIRECTO (sin proveedor: inventario inicial u otro),
    //          DEVOLUCION (prendas reintegradas), CAMBIO (prenda que la clienta devuelve).
    // SALIDA:  VENTA, BAJA (ajuste de stock), CAMBIO (prenda nueva que se entrega).
    concepto: {
      type: Sequelize.ENUM('INGRESO_PROVEEDOR', 'INGRESO_DIRECTO', 'VENTA', 'BAJA', 'DEVOLUCION', 'CAMBIO'),
      allowNull: false
    },
    id_sucursal: { type: Sequelize.INTEGER, allowNull: false },
    // Quien registró la operación; NULL si la originó el sistema (p. ej. un pago en línea confirmado por Stripe).
    id_empleado: { type: Sequelize.INTEGER, allowNull: true },
    id_proveedor: { type: Sequelize.INTEGER, allowNull: true },
    // Número de la factura o del envío del proveedor.
    documento_proveedor: { type: Sequelize.STRING(60), allowNull: true },
    id_pedido: { type: Sequelize.INTEGER, allowNull: true },
    id_devolucion: { type: Sequelize.INTEGER, allowNull: true },
    motivo: { type: Sequelize.STRING(255), allowNull: true },
    total_unidades: { type: Sequelize.INTEGER, allowNull: false },
    // Ventas: lo que descontó el cupón del pedido (el envío no es mercadería y no se incluye).
    descuento: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    // Suma de las líneas con costo (entradas de proveedor) o precio de venta (ventas) menos el
    // descuento: en una venta es lo que se cobró por la mercadería. NULL si ninguna línea tiene valor.
    valor_total: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
    fecha: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW }
  }, {
    tableName: 'Comprobante',
    timestamps: false
  });
  return Comprobante;
};
