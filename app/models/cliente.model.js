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
    // Sucursal donde se registró en mostrador (NULL si se registró en la tienda en línea). Cada
    // sucursal ve a los clientes que registró y a los que le han comprado.
    id_sucursal: { type: Sequelize.INTEGER, allowNull: true },
    // Hash bcrypt para la tienda en línea. NULL = cliente registrado en mostrador, sin cuenta web.
    password: { type: Sequelize.STRING, allowNull: true },
    // Código de un solo uso que entrega caja (en persona) para que un cliente de mostrador active
    // su cuenta web con el mismo correo y conserve su historial. Se guarda solo su hash SHA-256.
    codigo_activacion: { type: Sequelize.STRING(64), allowNull: true },
    codigo_activacion_expira: { type: Sequelize.DATE, allowNull: true },
    // "Olvidé mi contraseña": hash SHA-256 del enlace de un solo uso enviado al correo y su vencimiento.
    reset_token_hash: { type: Sequelize.STRING(64), allowNull: true },
    reset_expira: { type: Sequelize.DATE, allowNull: true },
    // Va dentro del token de la tienda (v): al cambiar o restablecer la contraseña aumenta y las
    // sesiones abiertas en otros dispositivos dejan de valer.
    token_version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'Cliente',
    timestamps: false,
    // El hash y los códigos nunca salen en consultas normales (listados, includes); el login usa
    // el scope conPassword, la activación conCodigo y el restablecimiento conReset.
    defaultScope: { attributes: { exclude: ['password', 'codigo_activacion', 'codigo_activacion_expira', 'reset_token_hash', 'reset_expira', 'token_version'] } },
    scopes: {
      conPassword: { attributes: { include: ['password', 'token_version'], exclude: ['codigo_activacion', 'codigo_activacion_expira', 'reset_token_hash', 'reset_expira'] } },
      conCodigo: { attributes: { include: ['password', 'codigo_activacion', 'codigo_activacion_expira', 'token_version'], exclude: ['reset_token_hash', 'reset_expira'] } },
      conReset: { attributes: { include: ['password', 'reset_token_hash', 'reset_expira', 'token_version'], exclude: ['codigo_activacion', 'codigo_activacion_expira'] } }
    }
  });
  return Cliente;
};
