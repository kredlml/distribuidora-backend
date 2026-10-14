const db = require("../models");
const Producto = db.producto;

exports.create = async (req, res) => {
  try {
    // Validar campos obligatorios (incluyendo la llave foránea de categoría)
    if (!req.body.nombre || !req.body.precio_unitario || !req.body.id_categoria) {
      return res.status(400).send({ message: "El nombre, precio unitario y id_categoria son obligatorios." });
    }
    
    // Variante: id_producto_padre opcional. El padre debe existir y ser un producto base
    // (no otra variante), porque los grupos de variantes tienen un solo nivel.
    let id_producto_padre = null;
    const padreRecibido = req.body.id_producto_padre;
    if (padreRecibido !== undefined && padreRecibido !== null && padreRecibido !== '') {
      if (!Number.isInteger(Number(padreRecibido)) || Number(padreRecibido) <= 0) {
        return res.status(400).send({ message: "id_producto_padre debe ser un número de producto válido." });
      }
      const padre = await Producto.findByPk(padreRecibido);
      if (!padre) {
        return res.status(400).send({ message: "El producto padre indicado no existe." });
      }
      if (padre.id_producto_padre) {
        return res.status(400).send({ message: "El producto padre debe ser un producto base: no puede ser a su vez una variante." });
      }
      id_producto_padre = padre.id_producto;
    }

    const nuevoProducto = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion,
      talla: req.body.talla,
      color: req.body.color,
      precio_unitario: req.body.precio_unitario,
      id_categoria: req.body.id_categoria,
      stock_minimo: req.body.stock_minimo,
      activo: req.body.activo !== undefined ? req.body.activo : true,
      id_producto_padre: id_producto_padre
    };

    const data = await Producto.create(nuevoProducto);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Producto." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Producto.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los productos." });
  }
};

// GET /api/productos/:id/historial — trazabilidad completa de una prenda/producto:
// ventas, devoluciones solicitadas/recibidas, revisiones y reintegraciones/cambios.
exports.historial = async (req, res) => {
  try {
    const id = req.params.id;

    const producto = await Producto.findByPk(id);
    if (!producto) {
      return res.status(404).send({ message: `No se encontró el Producto con id=${id}.` });
    }

    const movimientos = await db.movimiento_inventario.findAll({
      where: { id_producto: id },
      include: [
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }
      ],
      order: [['id_movimiento', 'ASC']]
    });

    res.status(200).send({ producto, movimientos });
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el historial del producto: " + error.message });
  }
};