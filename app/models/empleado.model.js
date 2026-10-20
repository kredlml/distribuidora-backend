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

    password: { type: Sequelize.STRING },
    // Sucursal opcional: un ADMIN puede no estar asignado a ninguna (trabaja con todas).
    id_sucursal: { type: Sequelize.INTEGER, allowNull: true },
    // Un empleado que deja la empresa se desactiva (no se borra: su id queda en pedidos,
    // movimientos y auditoría). Desactivado no puede iniciar sesión y su token deja de servir.
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    // Versión de las sesiones: va dentro del JWT y se incrementa al cambiar o restablecer la
    // contraseña o al desactivar la cuenta, así los tokens emitidos antes dejan de servir.
    token_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    freezeTableName: true,
    timestamps: false
  });
  return Empleado;
};
