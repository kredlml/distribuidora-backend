const db = require("../models");
const Empleado = db.empleado;
const { registrarAuditoria } = require("../utils/auditoria");
const { puestoDe } = require("../middlewares/authJwt.js");
const { whereSucursal } = require("../utils/alcance");
const { validarPassword, hashPassword, leerDatosEmpleado, activosConAcceso, aplicarReglasDeGestion, publico } = require("../utils/empleados");

// POST /api/empleados — ficha de empleado SIN contraseña (no puede iniciar sesión hasta que le den
// acceso con PUT /:id/password). Mismas validaciones y reglas de gestión que el registro con
// contraseña: el ADMIN solo da de alta cajeros y bodegueros de su sucursal.
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.nombre || !body.apellido || !body.puesto) {
      return res.status(400).send({ message: "Faltan campos obligatorios (nombre, apellido, puesto, email, id_sucursal)." });
    }
    const { datos, error } = await leerDatosEmpleado(
      { nombre: body.nombre, apellido: body.apellido, email: body.email, puesto: body.puesto, id_sucursal: body.id_sucursal, activo: body.activo },
      { esAlta: true }
    );
    if (error) return res.status(400).send({ message: error });
    const regla = aplicarReglasDeGestion(req.empleado, null, datos);
    if (regla) return res.status(regla.status).send({ message: regla.message });

    const data = await db.sequelize.transaction(async (t) => {
      const empleado = await Empleado.create({ activo: true, ...datos }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'EMPLEADO_REGISTRADO', tabla_afectada: 'Empleado',
        registro_afectado_id: empleado.id_empleado,
        detalles: `Ficha de empleado #${empleado.id_empleado} (${empleado.email}) creada sin acceso, puesto ${empleado.puesto}.`.slice(0, 255)
      }, t);
      return empleado;
    });
    res.status(201).send(publico(data));
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).send({ message: "Ya existe un empleado registrado con ese email." });
    }
    res.status(500).send({ message: error.message || "Error al crear el Empleado." });
  }
};

// GET /api/empleados — el DISTRITAL ve a todos; el ADMIN, a los de su sucursal.
exports.findAll = async (req, res) => {
  try {
    // Nunca se exponen los hashes de contraseña; sí si la cuenta puede iniciar sesión.
    const data = await Empleado.findAll({
      where: whereSucursal(req),
      include: [{ model: db.sucursal, attributes: ['id_sucursal', 'nombre'] }],
      order: [['id_empleado', 'ASC']]
    });
    res.send(data.map((e) => ({ ...publico(e), tiene_acceso: !!e.password })));
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los empleados." });
  }
};

// PUT /api/empleados/:id — edita nombre, apellido, email, puesto, sucursal y activo.
// Reglas:
//  - el DISTRITAL gestiona a cualquiera; el ADMIN, solo cajeros y bodegueros de su sucursal;
//  - nadie puede desactivarse ni cambiarse el puesto a sí mismo;
//  - siempre debe quedar al menos un DISTRITAL activo que pueda iniciar sesión;
//  - quien edita debe seguir siendo ADMIN o DISTRITAL activo al aplicar (se revisa con el bloqueo).
// Desactivar a alguien cierra sus sesiones abiertas (sube token_version).
exports.update = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const { datos, error } = await leerDatosEmpleado(
      { nombre: body.nombre, apellido: body.apellido, email: body.email, puesto: body.puesto, id_sucursal: body.id_sucursal, activo: body.activo },
      { esAlta: false, idExcluir: id }
    );
    if (error) return res.status(400).send({ message: error });
    if (Object.keys(datos).length === 0) {
      return res.status(400).send({ message: "No se enviaron cambios (nombre, apellido, email, puesto, id_sucursal, activo)." });
    }

    const resultado = await db.sequelize.transaction(async (t) => {
      const activos = await activosConAcceso(t); // bloquea antes de leer al empleado: mismo orden siempre
      const yo = activos.find((a) => a.id_empleado === req.empleadoId);
      if (!yo || !["ADMIN", "DISTRITAL"].includes(yo.puesto)) {
        return { status: 403, message: "¡Acceso denegado! Esta acción requiere privilegios de Administrador." };
      }
      const empleado = await Empleado.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!empleado) return { status: 404, message: `No se encontró el empleado con id=${req.params.id}.` };
      // Un ADMIN no "ve" empleados de otra sucursal: para él no existen.
      if (yo.puesto !== "DISTRITAL" && Number(empleado.id_sucursal) !== Number(yo.id_sucursal)) {
        return { status: 404, message: `No se encontró el empleado con id=${req.params.id}.` };
      }

      if (empleado.id_empleado === req.empleadoId && (datos.activo === false || (datos.puesto && datos.puesto !== puestoDe(empleado)))) {
        return { status: 400, message: "No puedes desactivarte ni cambiarte el puesto a ti mismo. Pídeselo a tu superior." };
      }
      if (empleado.id_empleado === req.empleadoId) {
        // Sus propios datos (nombre, apellido, correo) sí; su sucursal, no.
        if (datos.id_sucursal !== undefined && (datos.id_sucursal ?? null) !== (empleado.id_sucursal ?? null)) {
          return { status: 400, message: "No puedes cambiarte de sucursal a ti mismo. Pídeselo a tu superior." };
        }
        delete datos.id_sucursal;
      } else {
        const regla = aplicarReglasDeGestion(yo, empleado, datos);
        if (regla) return regla;
      }

      const distritales = activos.filter((a) => a.puesto === "DISTRITAL");
      const dejaDeSerDistrital = distritales.some((a) => a.id_empleado === empleado.id_empleado)
        && ((datos.puesto && datos.puesto !== "DISTRITAL") || datos.activo === false);
      if (dejaDeSerDistrital && distritales.length <= 1) {
        return { status: 400, message: "Debe quedar al menos un DISTRITAL activo." };
      }

      const diffs = Object.keys(datos).filter((k) => (empleado[k] ?? null) !== datos[k])
        .map((k) => `${k}: ${empleado[k] ?? "vacío"} → ${datos[k] ?? "vacío"}`);
      if (diffs.length) {
        const cambios = { ...datos };
        // Desactivarlo, o cambiarle el puesto o la sucursal, cierra sus sesiones: al volver a
        // entrar el panel le muestra lo que corresponde a su nuevo puesto y sucursal.
        const cambiaAlcance = (datos.puesto !== undefined && datos.puesto !== puestoDe(empleado))
          || (datos.id_sucursal !== undefined && (datos.id_sucursal ?? null) !== (empleado.id_sucursal ?? null));
        if ((datos.activo === false && empleado.activo !== false) || cambiaAlcance) cambios.token_version = (empleado.token_version || 0) + 1;
        await empleado.update(cambios, { transaction: t });
        await registrarAuditoria({
          id_empleado: req.empleadoId, accion: 'EMPLEADO_ACTUALIZADO', tabla_afectada: 'Empleado',
          registro_afectado_id: empleado.id_empleado,
          detalles: `Empleado #${empleado.id_empleado} actualizado. ${diffs.join("; ")}`.slice(0, 255)
        }, t);
      }
      return { status: 200, empleado };
    });
    if (resultado.status !== 200) return res.status(resultado.status).send({ message: resultado.message });
    res.send(publico(resultado.empleado));
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") {
      return res.status(400).send({ message: "Ya existe un empleado registrado con ese email." });
    }
    res.status(500).send({ message: error.message || "Error al actualizar el Empleado." });
  }
};

// PUT /api/empleados/:id/password — asigna una contraseña temporal (olvido, alta de una ficha sin
// acceso). El DISTRITAL a cualquiera; el ADMIN solo a cajeros y bodegueros de su sucursal. Cierra
// las sesiones abiertas de ese empleado. Sin correo no podría iniciar sesión, así que se rechaza.
exports.restablecerPassword = async (req, res) => {
  try {
    const { password } = req.body || {};
    const errorPassword = validarPassword(password);
    if (errorPassword) return res.status(400).send({ message: errorPassword });
    const empleado = await Empleado.findByPk(req.params.id);
    const noExiste = { message: `No se encontró el empleado con id=${req.params.id}.` };
    if (!empleado) return res.status(404).send(noExiste);
    if (puestoDe(req.empleado) !== "DISTRITAL") {
      if (Number(empleado.id_sucursal) !== Number(req.empleado.id_sucursal)) return res.status(404).send(noExiste);
      const regla = aplicarReglasDeGestion(req.empleado, empleado, {});
      if (regla) return res.status(regla.status).send({ message: regla.message });
    }
    if (!empleado.email) {
      return res.status(400).send({ message: "Este empleado no tiene correo: agrégalo desde Editar para que pueda iniciar sesión." });
    }

    await db.sequelize.transaction(async (t) => {
      await empleado.update({ password: hashPassword(password), token_version: (empleado.token_version || 0) + 1 }, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'EMPLEADO_PASSWORD_RESTABLECIDA', tabla_afectada: 'Empleado',
        registro_afectado_id: empleado.id_empleado, detalles: `Contraseña del empleado #${empleado.id_empleado} restablecida por un administrador.`
      }, t);
    });
    res.send({ message: `Contraseña de ${empleado.nombre} restablecida.` });
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al restablecer la contraseña." });
  }
};
