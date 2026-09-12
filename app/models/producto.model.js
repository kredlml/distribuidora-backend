module.exports = (sequelize, Sequelize) => {
  const Producto = sequelize.define("Producto", {
    id_producto: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    nombre: { type: Sequelize.STRING(120), allowNull: false },
    descripcion: { type: Sequelize.STRING(255) },
    talla: { type: Sequelize.STRING(10) },
    color: { type: Sequelize.STRING(40) },
    precio_unitario: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    id_categoria: { type: Sequelize.INTEGER },
  
    id_producto_padre: { type: Sequelize.INTEGER, allowNull: true }
  }, {
    tableName: 'Producto',
    timestamps: false
  });
  return Producto;
};