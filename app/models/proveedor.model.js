module.exports = (sequelize, Sequelize) => {
  const Proveedor = sequelize.define("Proveedor", {
    id_proveedor: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    nombre_empresa: { type: Sequelize.STRING(120), allowNull: false },
    nombre_contacto: { type: Sequelize.STRING(100) },
    telefono: { type: Sequelize.STRING(20) },
    email: { type: Sequelize.STRING(120) },
    direccion: { type: Sequelize.STRING(200) },
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'Proveedor',
    timestamps: false
  });
  return Proveedor;
};