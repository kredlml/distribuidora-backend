import Modal from "../../components/Modal";
import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as clientesService from "../../services/clientesService";
import { soloCambios } from "../../utils/cambios";
import { puede } from "../../utils/permisos";

/**
 * Alta (sin `cliente`) o edición de un cliente de mostrador. `onDone(cliente)` recibe el cliente
 * creado/actualizado (Nueva venta lo selecciona directamente).
 */
export default function ClienteDialog({ cliente: c, sucursales = [], sucursalFija, onClose, onDone }) {
  const { rol } = useAuth();
  const aviso = useToast();
  const conCuenta = !!(c && c.tiene_cuenta_web);
  // El distrital indica en qué sucursal se registra (para que esa sucursal la vea); los demás
  // registran en la suya. Desde Nueva venta se usa la sucursal de la venta.
  const eligeSucursal = !c && puede(rol, "todasLasSucursales") && !sucursalFija;
  const { error, enviando, onSubmit } = useSubmit(async (fd) => {
    const body = {
      nombre: fd.get("nombre").trim(), apellido: fd.get("apellido").trim(),
      telefono: fd.get("telefono").trim() || null, direccion: fd.get("direccion").trim() || null,
    };
    if (!conCuenta) body.email = fd.get("email").trim().toLowerCase() || null;
    if (!c && puede(rol, "todasLasSucursales")) body.id_sucursal = sucursalFija || Number(fd.get("id_sucursal")) || undefined;
    if (c) {
      if (puede(rol, "activarCliente")) body.activo = fd.get("activo") === "on";
      const cambios = soloCambios(body, { ...c, activo: c.activo !== false });
      if (!Object.keys(cambios).length) { aviso("No hiciste cambios."); return onDone(c); }
      const r = await clientesService.actualizar(c.id_cliente, cambios);
      aviso(`Datos de ${r.nombre} actualizados.`);
      onDone(r);
    } else {
      const r = await clientesService.crear(body);
      aviso(`Cliente ${r.nombre} ${r.apellido} registrado.`);
      onDone(r);
    }
  });

  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{c ? `Editar cliente #${c.id_cliente}` : "Nuevo cliente"}</h1>
        {eligeSucursal && (
          <label className="sm muted">Sucursal donde se registra
            <Select className="field" name="id_sucursal" required placeholder="Elige la sucursal"
              options={sucursales.filter((s) => s.activo !== false).map((s) => [s.id_sucursal, s.nombre])} />
          </label>
        )}
        <div className="grid2">
          <label className="sm muted">Nombre<input className="field" name="nombre" maxLength={80} required defaultValue={c ? c.nombre : ""} /></label>
          <label className="sm muted">Apellido<input className="field" name="apellido" maxLength={80} required defaultValue={c ? c.apellido : ""} /></label>
        </div>
        <label className="sm muted">Correo (opcional)
          <input className="field" name="email" type="email" maxLength={120} disabled={conCuenta} defaultValue={c ? c.email || "" : ""} />
        </label>
        <p className="muted sm">{conCuenta
          ? "Tiene cuenta en la tienda en línea: su correo es su usuario y solo él puede cambiarlo."
          : "Con correo, después podrá activar su cuenta en la tienda en línea con un código de caja y ver sus compras."}</p>
        <div className="grid2">
          <label className="sm muted">Teléfono (opcional)<input className="field" name="telefono" type="tel" maxLength={20} defaultValue={c ? c.telefono || "" : ""} /></label>
          <label className="sm muted">Dirección (opcional)<input className="field" name="direccion" maxLength={200} defaultValue={c ? c.direccion || "" : ""} /></label>
        </div>
        {c && puede(rol, "activarCliente") && (
          <label className="chk"><input type="checkbox" name="activo" defaultChecked={c.activo !== false} />
            <span>Cliente activo<br /><span className="muted sm">Desactivado no puede comprar ni entrar a la tienda. Su historial se conserva.</span></span>
          </label>
        )}
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={enviando}>{c ? "Guardar cambios" : "Registrar cliente"}</button>
        </div>
      </form>
    </Modal>
  );
}
