module.exports = (sequelize, Sequelize) => {
  const Empleado = sequelize.define("Empleado", {
    id_empleado: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    nombre: { type: Sequelize.STRING },
    apellido: { type: Sequelize.STRING },
    puesto: { type: Sequelize.STRING },
    email: { type: Sequelize.STRING },
  
    password: { type: Sequelize.STRING }
  }, {
    freezeTableName: true,
    timestamps: false
  });
  return Empleado;
};