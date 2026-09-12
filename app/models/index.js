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

//  Modelos del ERP
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

// Logística inversa y trazabilidad
db.devolucion = require("./devolucion.model.js")(sequelize, Sequelize);
db.detalle_devolucion = require("./detalle_devolucion.model.js")(sequelize, Sequelize);
db.movimiento_inventario = require("./movimiento_inventario.model.js")(sequelize, Sequelize);
// Aquí iremos agregando: db.producto, db.inventario, etc.
db.auditoria = require("./auditoria.model.js")(sequelize, Sequelize);

db.empleado.belongsTo(db.sucursal, { foreignKey: 'id_sucursal' });

db.sucursal.hasMany(db.empleado, { foreignKey: 'id_sucursal' });

db.empleado.hasMany(db.auditoria, { foreignKey: 'id_empleado' });
db.auditoria.belongsTo(db.empleado, { foreignKey: 'id_empleado' });

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

// 6. Variantes de producto (talla/color) agrupadas bajo un mismo producto padre
db.producto.belongsTo(db.producto, { as: 'ProductoPadre', foreignKey: 'id_producto_padre' });
db.producto.hasMany(db.producto, { as: 'Variantes', foreignKey: 'id_producto_padre' });

// 7. Relaciones de Devolucion (logística inversa)
db.pedido.hasMany(db.devolucion, { foreignKey: 'id_pedido' });
db.devolucion.belongsTo(db.pedido, { foreignKey: 'id_pedido' });
db.cliente.hasMany(db.devolucion, { foreignKey: 'id_cliente' });
db.devolucion.belongsTo(db.cliente, { foreignKey: 'id_cliente' });
db.empleado.hasMany(db.devolucion, { foreignKey: 'id_empleado_gestor' });
db.devolucion.belongsTo(db.empleado, { foreignKey: 'id_empleado_gestor' });

// 8. Relaciones de DetalleDevolucion
db.devolucion.hasMany(db.detalle_devolucion, { foreignKey: 'id_devolucion' });
db.detalle_devolucion.belongsTo(db.devolucion, { foreignKey: 'id_devolucion' });
db.detalle_pedido.hasMany(db.detalle_devolucion, { foreignKey: 'id_detalle_pedido' });
db.detalle_devolucion.belongsTo(db.detalle_pedido, { foreignKey: 'id_detalle_pedido' });
db.producto.hasMany(db.detalle_devolucion, { foreignKey: 'id_producto' });
db.detalle_devolucion.belongsTo(db.producto, { foreignKey: 'id_producto' });
db.producto.hasMany(db.detalle_devolucion, { as: 'DetallesComoProductoNuevo', foreignKey: 'id_producto_nuevo' });
db.detalle_devolucion.belongsTo(db.producto, { as: 'ProductoNuevo', foreignKey: 'id_producto_nuevo' });

// 9. Relaciones de MovimientoInventario (trazabilidad / historial inmutable)
db.producto.hasMany(db.movimiento_inventario, { foreignKey: 'id_producto' });
db.movimiento_inventario.belongsTo(db.producto, { foreignKey: 'id_producto' });
db.inventario.hasMany(db.movimiento_inventario, { foreignKey: 'id_inventario' });
db.movimiento_inventario.belongsTo(db.inventario, { foreignKey: 'id_inventario' });
db.pedido.hasMany(db.movimiento_inventario, { foreignKey: 'id_pedido' });
db.movimiento_inventario.belongsTo(db.pedido, { foreignKey: 'id_pedido' });
db.devolucion.hasMany(db.movimiento_inventario, { foreignKey: 'id_devolucion' });
db.movimiento_inventario.belongsTo(db.devolucion, { foreignKey: 'id_devolucion' });
db.empleado.hasMany(db.movimiento_inventario, { foreignKey: 'id_empleado' });
db.movimiento_inventario.belongsTo(db.empleado, { foreignKey: 'id_empleado' });

module.exports = db;