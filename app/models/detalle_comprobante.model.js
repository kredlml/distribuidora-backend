// Línea de un comprobante. Guarda una copia de la descripción de la prenda: si después se
// renombra, el comprobante sigue diciendo lo que entró o salió.
module.exports = (sequelize, Sequelize) => {
  const DetalleComprobante = sequelize.define("DetalleComprobante", {
    id_detalle_comprobante: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    id_comprobante: { type: Sequelize.INTEGER, allowNull: false },
    id_producto: { type: Sequelize.INTEGER, allowNull: false },
    descripcion: { type: Sequelize.STRING(200), allowNull: false },
    cantidad: { type: Sequelize.INTEGER, allowNull: false },
    // Estado con que la prenda entra o sale del inventario: DISPONIBLE, DANADA o DEFECTUOSA.
    estado_inventario: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'DISPONIBLE' },
    lote: { type: Sequelize.STRING(255), allowNull: true },
    // Costo de compra (entradas de proveedor) o precio de venta (ventas). NULL si no aplica.
    valor_unitario: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
    subtotal: { type: Sequelize.DECIMAL(12, 2), allowNull: true }
  }, {
    tableName: 'DetalleComprobante',
    timestamps: false
  });
  return DetalleComprobante;
};
