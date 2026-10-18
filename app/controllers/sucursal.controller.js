const db = require("../models");
const Sucursal = db.sucursal;
const { registrarAuditoria } = require("../utils/logger.js");


exports.create = async (req, res) => {
  try {
    req.body = req.body || {};
    if (!req.body.nombre || !req.body.direccion || !req.body.ciudad) {
      return res.status(400).send({ message: "El nombre, dirección y ciudad son obligatorios." });
    }

    const nuevaSucursal = {
      nombre: req.body.nombre,
      direccion: req.body.direccion,
      ciudad: req.body.ciudad,
      telefono: req.body.telefono,
      activo: req.body.activo !== undefined ? req.body.activo : true
    };

    const data = await Sucursal.create(nuevaSucursal);
    
    
    registrarAuditoria(req.empleadoId, "INSERTAR", "Sucursales", data.id_sucursal, `Nueva sucursal creada: ${data.nombre}`);

    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Ocurrió un error al crear la Sucursal." });
  }
};


exports.findAll = async (req, res) => {
  try {
    const data = await Sucursal.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Ocurrió un error al recuperar las sucursales." });
  }
};

// 3. Actualizar una Sucursal por su ID. Solo se aplican los campos editables (nunca
// id_sucursal ni columnas no previstas) y se validan antes de guardar.
const CAMPOS_TEXTO_OBLIGATORIOS = ['nombre', 'direccion', 'ciudad'];

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const cambios = {};

    for (const campo of CAMPOS_TEXTO_OBLIGATORIOS) {
      if (body[campo] !== undefined) {
        if (typeof body[campo] !== 'string' || !body[campo].trim()) {
          return res.status(400).send({ message: `El campo ${campo} no puede quedar vacío.` });
        }
        cambios[campo] = body[campo].trim();
      }
    }
    if (body.telefono !== undefined) {
      cambios.telefono = body.telefono === null ? null : String(body.telefono).trim();
    }
    if (body.activo !== undefined) {
      if (typeof body.activo !== 'boolean') {
        return res.status(400).send({ message: "El campo activo debe ser verdadero o falso." });
      }
      cambios.activo = body.activo;
    }
    if (Object.keys(cambios).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios válidos (nombre, direccion, ciudad, telefono, activo)." });
    }

    const [num] = await Sucursal.update(cambios, { where: { id_sucursal: id } });

    if (num == 1) {
      // AUDITORÍA: Registramos quién modificó los datos
      registrarAuditoria(req.empleadoId, "ACTUALIZAR", "Sucursales", id, `Datos de la sucursal modificados: ${Object.keys(cambios).join(", ")}`);
      
      res.send({ message: "La sucursal fue actualizada exitosamente." });
    } else {
      res.status(404).send({ message: `No se puede actualizar la sucursal con id=${id}. Tal vez no fue encontrada o el body está vacío.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar la sucursal con id=" + req.params.id });
  }
};


exports.delete = async (req, res) => {
  const id = req.params.id;

  try {
    const num = await db.sucursal.destroy({ where: { id_sucursal: id } });

    if (num == 1) {
      
      registrarAuditoria(req.empleadoId, "ELIMINAR", "Sucursales", id, "Sucursal eliminada permanentemente del sistema");
      
      res.send({ message: "La sucursal fue eliminada con éxito." });
    } else {
      res.send({ message: `No se pudo eliminar la sucursal con id=${id}.` });
    }
  } catch (err) {
    res.status(500).send({ message: "No se pudo eliminar la sucursal con id=" + id });
  }
};