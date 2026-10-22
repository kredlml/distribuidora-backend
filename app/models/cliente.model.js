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
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    // Hash bcrypt para la tienda en línea. NULL = cliente registrado en mostrador, sin cuenta web.
    password: { type: Sequelize.STRING, allowNull: true },
    // Código de un solo uso que entrega caja (en persona) para que un cliente de mostrador active
    // su cuenta web con el mismo correo y conserve su historial. Se guarda solo su hash SHA-256.
    codigo_activacion: { type: Sequelize.STRING(64), allowNull: true },
    codigo_activacion_expira: { type: Sequelize.DATE, allowNull: true }
  }, {
    tableName: 'Cliente',
    timestamps: false,
    // El hash y el código nunca salen en consultas normales (listados, includes); el login usa
    // el scope conPassword y la activación, conCodigo.
    defaultScope: { attributes: { exclude: ['password', 'codigo_activacion', 'codigo_activacion_expira'] } },
    scopes: {
      conPassword: { attributes: { include: ['password'], exclude: ['codigo_activacion', 'codigo_activacion_expira'] } },
      conCodigo: { attributes: { include: ['password', 'codigo_activacion', 'codigo_activacion_expira'] } }
    }
  });
  return Cliente;
};
