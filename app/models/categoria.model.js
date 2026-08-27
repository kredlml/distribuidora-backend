module.exports = (sequelize, Sequelize) => {
  const Categoria = sequelize.define("Categoria", {
    id_categoria: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    nombre: { type: Sequelize.STRING(60), allowNull: false, unique: true },
    descripcion: { type: Sequelize.STRING(200) }
  }, {
    tableName: 'Categoria',
    timestamps: false
  });
  return Categoria;
};