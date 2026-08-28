const db = require("../models");
const Categoria = db.categoria;

exports.create = async (req, res) => {
  try {
    if (!req.body.nombre) {
      return res.status(400).send({ message: "El nombre de la categoría es obligatorio." });
    }
    const nuevaCategoria = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion
    };
    const data = await Categoria.create(nuevaCategoria);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear la Categoría." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Categoria.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar las categorías." });
  }
};