const db = require("../models");
const Producto = db.producto;

exports.create = async (req, res) => {
  try {
    // Validar campos obligatorios (incluyendo la llave foránea de categoría)
    if (!req.body.nombre || !req.body.precio_unitario || !req.body.id_categoria) {
      return res.status(400).send({ message: "El nombre, precio unitario y id_categoria son obligatorios." });
    }
    
    const nuevoProducto = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion,
      talla: req.body.talla,
      color: req.body.color,
      precio_unitario: req.body.precio_unitario,
      id_categoria: req.body.id_categoria,
      stock_minimo: req.body.stock_minimo,
      activo: req.body.activo !== undefined ? req.body.activo : true
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
      order: [['id_movimiento', 'ASC']]
    });

    res.status(200).send({ producto, movimientos });
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el historial del producto: " + error.message });
  }
};