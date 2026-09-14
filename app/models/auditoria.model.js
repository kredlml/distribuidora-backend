module.exports = (sequelize, Sequelize) => {
  const Auditoria = sequelize.define("auditoria", {
    id_auditoria: {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    accion: {
      type: Sequelize.STRING, 
      allowNull: false
    },
    tabla_afectada: {
      type: Sequelize.STRING, 
      allowNull: false
    },
    registro_afectado_id: {
      type: Sequelize.INTEGER, 
      allowNull: true
    },
    detalles: {
      type: Sequelize.TEXT, 
      allowNull: true
    }
  });

  return Auditoria;
};