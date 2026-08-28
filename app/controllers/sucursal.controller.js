const db = require("../models");
const Sucursal = db.sucursal;

// 1. Crear y guardar una nueva Sucursal
exports.create = async (req, res) => {
  try {
    // Validación básica: campos obligatorios
    if (!req.body.nombre || !req.body.direccion || !req.body.ciudad) {
      return res.status(400).send({ message: "El nombre, dirección y ciudad son obligatorios." });
    }

    // Preparar el objeto con los datos del request
    const nuevaSucursal = {
      nombre: req.body.nombre,
      direccion: req.body.direccion,
      ciudad: req.body.ciudad,
      telefono: req.body.telefono,
      activo: req.body.activo !== undefined ? req.body.activo : true
    };

    // Guardar en PostgreSQL (Neon)
    const data = await Sucursal.create(nuevaSucursal);
    res.status(201).send(data);

  } catch (error) {
    res.status(500).send({
      message: error.message || "Ocurrió un error al crear la Sucursal."
    });
  }
};

// 2. Obtener todas las Sucursales
exports.findAll = async (req, res) => {
  try {
    const data = await Sucursal.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({
      message: error.message || "Ocurrió un error al recuperar las sucursales."
    });
  }
};

// 3. Actualizar una Sucursal por su ID
exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const [num] = await Sucursal.update(req.body, { where: { id_sucursal: id } });

    if (num == 1) {
      res.send({ message: "La sucursal fue actualizada exitosamente." });
    } else {
      res.status(404).send({ message: `No se puede actualizar la sucursal con id=${id}. Tal vez no fue encontrada o el body está vacío.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar la sucursal con id=" + req.params.id });
  }
};