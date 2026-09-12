const db = require("../models");
const DetallePedido = db.detalle_pedido;
const Inventario = db.inventario;
const Pedido = db.pedido;
const sequelize = db.sequelize; // Importamos sequelize para manejar la transacción

exports.create = async (req, res) => {
  // 1. Iniciamos la transacción de seguridad
  const t = await sequelize.transaction();

  try {
    const { cantidad, precio_unitario, id_pedido, id_producto } = req.body;

    if (!cantidad || !precio_unitario || !id_pedido || !id_producto) {
      await t.rollback(); // Cancelamos si faltan datos
      return res.status(400).send({ message: "Faltan datos obligatorios." });
    }

    // 2. Buscar a qué sucursal pertenece este pedido
    const pedido = await Pedido.findByPk(id_pedido);
    if (!pedido) {
      await t.rollback();
      return res.status(404).send({ message: "El pedido no existe." });
    }

    // 3. Buscar el inventario de ese producto en esa sucursal específica
    const inventario = await Inventario.findOne({
      where: { id_producto: id_producto, id_sucursal: pedido.id_sucursal }
    });

    if (!inventario) {
      await t.rollback();
      return res.status(404).send({ message: "Este producto no tiene inventario en esta sucursal." });
    }

    // 4. Validar si hay stock suficiente
    if (inventario.cantidad_actual < cantidad) {
      await t.rollback();
      return res.status(400).send({ 
        message: `Stock insuficiente. Solo hay ${inventario.cantidad_actual} unidades disponibles.` 
      });
    }

    // 5. Crear el detalle del pedido (Agregamos { transaction: t })
    const subtotalCalc = cantidad * precio_unitario;
    const nuevoDetalle = await DetallePedido.create({
      cantidad: cantidad,
      precio_unitario: precio_unitario,
      subtotal: subtotalCalc,
      id_pedido: id_pedido,
      id_producto: id_producto
    }, { transaction: t });

    // 6. Descontar la cantidad del inventario
    await inventario.update({
      cantidad_actual: inventario.cantidad_actual - cantidad
    }, { transaction: t });

    // 7. Confirmar y guardar todos los cambios de golpe en Neon
    await t.commit();
    res.status(201).send(nuevoDetalle);

  } catch (error) {
    
    await t.rollback();
    res.status(500).send({ message: error.message || "Error al procesar la venta." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await DetallePedido.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los detalles." });
  }
};