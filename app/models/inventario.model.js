module.exports = (sequelize, Sequelize) => {
  const Inventario = sequelize.define("Inventario", {
    id_producto: { type: Sequelize.INTEGER, primaryKey: true },
    id_sucursal: { type: Sequelize.INTEGER, primaryKey: true },
    cantidad_actual: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    stock_minimo: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'Inventario',
    timestamps: false
  });
  return Inventario;
};