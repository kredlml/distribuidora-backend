module.exports = (sequelize, Sequelize) => {
  const Cliente = sequelize.define("Cliente", {
    id_cliente: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: { type: Sequelize.STRING(80), allowNull: false },
    apellido: { type: Sequelize.STRING(80), allowNull: false },
    telefono: { type: Sequelize.STRING(20) },
    email: { type: Sequelize.STRING(120), unique: true },
    direccion: { type: Sequelize.STRING(200) },
    fecha_registro: { 
      type: Sequelize.DATEONLY, 
      defaultValue: Sequelize.NOW 
    },
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'Cliente',
    timestamps: false
  });
  return Cliente;
};