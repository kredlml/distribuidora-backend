module.exports = (sequelize, Sequelize) => {
  const Inventario = sequelize.define("Inventario", {
    id_inventario: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cantidad: { type: Sequelize.INTEGER },
    id_producto: { type: Sequelize.INTEGER },
    id_sucursal: { type: Sequelize.INTEGER },
    lote: { type: Sequelize.STRING },
    estado: { 
      type: Sequelize.STRING, 
      defaultValue: 'DISPONIBLE' 
    }
  }, {
    freezeTableName: true,
    timestamps: false
  });
  return Inventario;
};