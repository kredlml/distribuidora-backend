const db = require("../models");
const sequelize = db.sequelize; // Usaremos la instancia directa para lanzar SQL puro

// 1. Reporte de Ventas (JOIN de Pedidos, Clientes y Sucursales)
exports.historialVentas = async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id_pedido,
        p.fecha_pedido,
        s.nombre AS sucursal,
        c.nombre AS nombre_cliente,
        c.apellido AS apellido_cliente,
        p.total,
        p.estado
      FROM "Pedido" p
      INNER JOIN "Sucursal" s ON p.id_sucursal = s.id_sucursal
      INNER JOIN "Cliente" c ON p.id_cliente = c.id_cliente
      ORDER BY p.id_pedido DESC;
    `;
    
    // Ejecutamos la consulta
    const [resultados] = await sequelize.query(query);
    res.status(200).send(resultados);

  } catch (error) {
    res.status(500).send({ message: error.message || "Error al generar el reporte de ventas." });
  }
};

// 2. Reporte de Alertas: Productos con stock bajo
exports.stockCritico = async (req, res) => {
  try {
    const query = `
      SELECT
        prod.nombre AS producto,
        prod.talla,
        prod.color,
        s.nombre AS sucursal,
        SUM(inv.cantidad) AS stock_actual,
        prod.stock_minimo
      FROM "Inventario" inv
      INNER JOIN "Producto" prod ON inv.id_producto = prod.id_producto
      INNER JOIN "Sucursal" s ON inv.id_sucursal = s.id_sucursal
      WHERE inv.estado = 'DISPONIBLE'
      GROUP BY prod.id_producto, prod.nombre, prod.talla, prod.color, s.id_sucursal, s.nombre, prod.stock_minimo
      HAVING SUM(inv.cantidad) <= prod.stock_minimo;
    `;

    const [resultados] = await sequelize.query(query);
    res.status(200).send(resultados);

  } catch (error) {
    res.status(500).send({ message: error.message || "Error al generar el reporte de stock." });
  }
};