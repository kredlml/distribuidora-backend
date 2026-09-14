const db = require("../models");
const DetallePedido = db.detalle_pedido;
const Inventario = db.inventario;
const sequelize = db.sequelize;


exports.create = async (req, res) => {
  
  const t = await sequelize.transaction();

  try {
    const { id_pedido, id_producto, cantidad, precio_unitario, id_sucursal } = req.body;

    
    const inventario = await Inventario.findOne({
      where: { 
        id_producto: id_producto,
        id_sucursal: id_sucursal 
      },
      transaction: t
    });

    if (!inventario) {
      await t.rollback();
      return res.status(404).send({ message: "No se encontró el inventario para este producto." });
    }

   
    if (inventario.cantidad < cantidad) {
      await t.rollback();
      return res.status(400).send({ message: "Stock insuficiente." });
    }

    
    const detalle = await DetallePedido.create({
      id_pedido: id_pedido,
      id_producto: id_producto,
      cantidad: cantidad,
      precio_unitario: precio_unitario,
      subtotal: cantidad * precio_unitario
    }, { transaction: t });

    
    await inventario.update(
      { cantidad: inventario.cantidad - cantidad }, 
      { transaction: t }
    );

   
    await t.commit();
    res.status(201).send(detalle);

  } catch (error) {
    // Si cualquier paso falla, deshacemos todo para evitar inconsistencias
    await t.rollback();
    res.status(500).send({
      message: error.message || "Ocurrió un error al agregar el detalle al pedido."
    });
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


exports.findOne = async (req, res) => {
  try {
    const data = await DetallePedido.findByPk(req.params.id);
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({ message: `No se encontró el detalle con id=${req.params.id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el detalle con id=" + req.params.id });
  }
};