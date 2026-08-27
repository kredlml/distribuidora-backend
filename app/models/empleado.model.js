module.exports = (sequelize, Sequelize) => {
  const Empleado = sequelize.define("Empleado", {
    id_empleado: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: { type: Sequelize.STRING(80), allowNull: false },
    apellido: { type: Sequelize.STRING(80), allowNull: false },
    puesto: { type: Sequelize.STRING(60), allowNull: false },
    telefono: { type: Sequelize.STRING(20) },
    email: { type: Sequelize.STRING(120), unique: true },
    fecha_contratacion: { type: Sequelize.DATEONLY, allowNull: false },
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    id_sucursal: { 
      type: Sequelize.INTEGER, 
      allowNull: false 
      // La relación real la definiremos en el index.js
    }
  }, {
    tableName: 'Empleado',
    timestamps: false
  });
  return Empleado;
};