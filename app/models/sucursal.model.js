module.exports = (sequelize, Sequelize) => {
  const Sucursal = sequelize.define("Sucursal", {
    id_sucursal: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: {
      type: Sequelize.STRING(100),
      allowNull: false
    },
    direccion: {
      type: Sequelize.STRING(200),
      allowNull: false
    },
    ciudad: {
      type: Sequelize.STRING(80),
      allowNull: false
    },
    telefono: {
      type: Sequelize.STRING(20)
    },
    activo: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  }, {
    // Configuraciones adicionales del modelo
    tableName: 'Sucursal',
    timestamps: false 
  });

  return Sucursal;
};