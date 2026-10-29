import Select from "../../components/Select";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as inventarioService from "../../services/inventarioService";
import { prod, vacioANull } from "../../utils/format";
import { puede } from "../../utils/permisos";

export default function StockTab({ prods, sucs, reload }) {
  const { sesion, rol } = useAuth();
  const aviso = useToast();
  // Cada sucursal ingresa stock solo en la suya; el distrital elige la sucursal.
  const todas = puede(rol, "todasLasSucursales");
  const propia = sesion && sesion.id_sucursal;
  const opciones = sucs.filter((x) => x.activo !== false && (todas || x.id_sucursal === propia));
  const { error, enviando, onSubmit } = useSubmit(async (fd, form) => {
    const r = await inventarioService.ingresar({
      id_producto: Number(fd.get("id_producto")), id_sucursal: Number(todas ? fd.get("id_sucursal") : propia),
      cantidad: Number(fd.get("cantidad")), lote: vacioANull(fd.get("lote")), estado: fd.get("estado"),
    });
    aviso(`Stock registrado: ${r.cantidad} u. de la prenda #${r.id_producto}.`);
    form.reset();
    reload();
  });

  if (!todas && !propia) return <div className="card err">Tu cuenta no tiene sucursal asignada: pide al gerente distrital que te asigne una.</div>;

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>Ingresar stock</h2>
      <label className="sm muted">Prenda
        <Select className="field" name="id_producto" required placeholder="Elige la prenda"
          options={prods.filter((p) => p.activo).map((p) => [p.id_producto, `#${p.id_producto} ${prod(p)}`])} />
      </label>
      {todas ? (
        <label className="sm muted">Sucursal
          <Select className="field" name="id_sucursal" required placeholder={opciones.length ? "Elige la sucursal" : "No hay sucursales activas (actívalas en Sucursales)"}
            options={opciones.map((x) => [x.id_sucursal, x.nombre])} />
        </label>
      ) : (
        <p className="sm">Sucursal: <b>{(opciones[0] || {}).nombre || sesion.sucursal || `#${propia}`}</b></p>
      )}
      <div className="grid2">
        <label className="sm muted">Cantidad<input className="field" name="cantidad" type="number" step="1" min="1" required /></label>
        <label className="sm muted">Lote (opcional)<input className="field" name="lote" /></label>
      </div>
      <label className="sm muted">Estado
        <select className="field" name="estado">
          <option value="DISPONIBLE">Disponible</option>
          <option value="DANADA">Dañada</option>
          <option value="DEFECTUOSA">Defectuosa</option>
        </select>
      </label>
      <div className="err" role="alert">{error}</div>
      <div><button className="btn pri" disabled={enviando}>Ingresar al inventario</button></div>
    </form>
  );
}
