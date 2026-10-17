import Select from "../../components/Select";
import { useToast } from "../../context/ToastContext";
import useSubmit from "../../hooks/useSubmit";
import * as inventarioService from "../../services/inventarioService";
import { prod, vacioANull } from "../../utils/format";

export default function StockTab({ prods, sucs, reload }) {
  const aviso = useToast();
  const { error, enviando, onSubmit } = useSubmit(async (fd, form) => {
    const r = await inventarioService.ingresar({
      id_producto: Number(fd.get("id_producto")), id_sucursal: Number(fd.get("id_sucursal")),
      cantidad: Number(fd.get("cantidad")), lote: vacioANull(fd.get("lote")), estado: fd.get("estado"),
    });
    aviso(`Stock registrado: ${r.cantidad} u. de la prenda #${r.id_producto}.`);
    form.reset();
    reload();
  });

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2>Ingresar stock</h2>
      <label className="sm muted">Prenda
        <Select className="field" name="id_producto" required placeholder="Elige la prenda"
          options={prods.filter((p) => p.activo).map((p) => [p.id_producto, `#${p.id_producto} ${prod(p)}`])} />
      </label>
      {sucs.length ? (
        <label className="sm muted">Sucursal
          <Select className="field" name="id_sucursal" required placeholder="Elige la sucursal" options={sucs.map((x) => [x.id_sucursal, x.nombre])} />
        </label>
      ) : (
        <label className="sm muted">Número de sucursal<input className="field" name="id_sucursal" type="number" min="1" step="1" required /></label>
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
