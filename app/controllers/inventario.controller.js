const db = require("../models");
const Inventario = db.inventario;


exports.create = (req, res) => {
  if (!req.body.id_producto || !req.body.id_sucursal || !req.body.cantidad) {
    return res.status(400).send({ message: "El id_producto, id_sucursal y cantidad son obligatorios." });
  }

  const nuevoInventario = {
    cantidad: req.body.cantidad,
    id_producto: req.body.id_producto,
    id_sucursal: req.body.id_sucursal,
    lote: req.body.lote,                     
    fecha_caducidad: req.body.fecha_caducidad, 
    estado: req.body.estado || 'DISPONIBLE'  
  };

  Inventario.create(nuevoInventario)
    .then(data => res.status(201).send(data))
    .catch(err => res.status(500).send({ message: err.message || "Error al registrar el inventario." }));
};


exports.findAll = (req, res) => {
  Inventario.findAll()
    .then(data => res.send(data))
    .catch(err => res.status(500).send({ message: err.message || "Error al recuperar inventarios." }));
};


exports.findOne = (req, res) => {
  const id = req.params.id;
  Inventario.findByPk(id)
    .then(data => res.send(data))
    .catch(err => res.status(500).send({ message: "Error al recuperar el inventario con id=" + id }));
};


exports.update = (req, res) => {
  const id = req.params.id;
  Inventario.update(req.body, { where: { id_inventario: id } })
    .then(num => {
      if (num == 1) { res.send({ message: "Inventario actualizado exitosamente." }); } 
      else { res.send({ message: `No se pudo actualizar el inventario id=${id}.` }); }
    })
    .catch(err => res.status(500).send({ message: "Error actualizando inventario id=" + id }));
};


exports.delete = (req, res) => {
  const id = req.params.id;
  Inventario.destroy({ where: { id_inventario: id } })
    .then(num => {
      if (num == 1) { res.send({ message: "Inventario borrado exitosamente!" }); } 
      else { res.send({ message: `No se pudo borrar el inventario id=${id}.` }); }
    })
    .catch(err => res.status(500).send({ message: "No se pudo borrar el inventario id=" + id }));
};

exports.getStockGlobal = async (req, res) => {
  try {
    const stockGlobal = await Inventario.findAll({
      attributes: [
        'id_producto',
        'id_sucursal',
        [db.sequelize.fn('SUM', db.sequelize.col('cantidad')), 'stock_total']
      ],
      where: {
        estado: 'DISPONIBLE'
      },
      group: ['id_producto', 'id_sucursal']
    });

    res.status(200).send(stockGlobal);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al calcular el stock global." });
  }
};