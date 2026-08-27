const dbConfig = require("../config/db.config.js");
const Sequelize = require("sequelize");

const sequelizeOptions = {
  host: dbConfig.HOST,
  dialect: dbConfig.dialect,
  pool: {
    max: dbConfig.pool.max,
    min: dbConfig.pool.min,
    acquire: dbConfig.pool.acquire,
    idle: dbConfig.pool.idle
  },
  dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    },
};

if (dbConfig.ssl) {
  sequelizeOptions.dialectOptions = {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  };
}

const sequelize = new Sequelize(dbConfig.DB, dbConfig.USER, dbConfig.PASSWORD, sequelizeOptions);
const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

// 🚀 Registramos los NUEVOS modelos del ERP
db.sucursal = require("./sucursal.model.js")(sequelize, Sequelize);
db.cliente = require("./cliente.model.js")(sequelize, Sequelize);
db.empleado = require("./empleado.model.js")(sequelize, Sequelize);
db.proveedor = require("./proveedor.model.js")(sequelize, Sequelize);
db.categoria = require("./categoria.model.js")(sequelize, Sequelize);
db.producto = require("./producto.model.js")(sequelize, Sequelize);
db.inventario = require("./inventario.model.js")(sequelize, Sequelize);
db.pedido = require("./pedido.model.js")(sequelize, Sequelize);
db.detalle_pedido = require("./detalle_pedido.model.js")(sequelize, Sequelize);
db.pago = require("./pago.model.js")(sequelize, Sequelize);
// Aquí iremos agregando: db.producto, db.inventario, etc.
db.empleado.belongsTo(db.sucursal, { foreignKey: 'id_sucursal' });

db.sucursal.hasMany(db.empleado, { foreignKey: 'id_sucursal' });

// 1. Categoría -> Producto
db.categoria.hasMany(db.producto, { foreignKey: 'id_categoria' });
db.producto.belongsTo(db.categoria, { foreignKey: 'id_categoria' });

// 2. Relaciones del Inventario (Llave compuesta)
db.producto.hasMany(db.inventario, { foreignKey: 'id_producto' });
db.inventario.belongsTo(db.producto, { foreignKey: 'id_producto' });
db.sucursal.hasMany(db.inventario, { foreignKey: 'id_sucursal' });
db.inventario.belongsTo(db.sucursal, { foreignKey: 'id_sucursal' });

// 3. Relaciones del Pedido
db.cliente.hasMany(db.pedido, { foreignKey: 'id_cliente' });
db.pedido.belongsTo(db.cliente, { foreignKey: 'id_cliente' });
db.sucursal.hasMany(db.pedido, { foreignKey: 'id_sucursal' });
db.pedido.belongsTo(db.sucursal, { foreignKey: 'id_sucursal' });
db.empleado.hasMany(db.pedido, { foreignKey: 'id_empleado' });
db.pedido.belongsTo(db.empleado, { foreignKey: 'id_empleado' });

// 4. Relaciones de Detalle de Pedido
db.pedido.hasMany(db.detalle_pedido, { foreignKey: 'id_pedido' });
db.detalle_pedido.belongsTo(db.pedido, { foreignKey: 'id_pedido' });
db.producto.hasMany(db.detalle_pedido, { foreignKey: 'id_producto' });
db.detalle_pedido.belongsTo(db.producto, { foreignKey: 'id_producto' });

// 5. Relaciones de Pago
db.pedido.hasMany(db.pago, { foreignKey: 'id_pedido' });
db.pago.belongsTo(db.pedido, { foreignKey: 'id_pedido' });

module.exports = db;