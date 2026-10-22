import { useState } from "react";
import Modal from "../../components/Modal";
import * as clientesService from "../../services/clientesService";
import { fecha } from "../../utils/format";

/** Genera el código para que un cliente de mostrador active su cuenta en la tienda en línea. */
export default function CodigoWebDialog({ cliente: c, onClose }) {
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const generar = async () => {
    setError(""); setEnviando(true);
    try { setRes(await clientesService.generarCodigoWeb(c.id_cliente)); }
    catch (e) { setError(e.message); }
    finally { setEnviando(false); }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <h1>Cuenta en la tienda en línea</h1>
        <p>{c.nombre} {c.apellido}{c.email ? `, ${c.email}` : ""}</p>
        {!c.email ? (
          <p className="err">Este cliente no tiene correo. Agrégalo desde Editar: con él iniciará sesión en la tienda.</p>
        ) : res ? (
          <>
            <p className="muted sm">Entrégale este código en persona. Sirve una sola vez y vence el {fecha(res.expira)}.</p>
            <p className="codigo-web" aria-label="Código de activación">{res.codigo}</p>
            <p className="sm">En la tienda: <b>Iniciar sesión → «Activa tu cuenta con tu código»</b>, con su correo <b>{res.email}</b>, este código y la contraseña que elija. Verá también sus compras de mostrador.</p>
            <p className="muted sm">No se vuelve a mostrar. Si lo pierde, genera otro (el anterior deja de valer).</p>
          </>
        ) : (
          <p className="muted sm">Genera un código de un solo uso (válido 72 horas). El cliente lo usa en la tienda para crear su contraseña y conserva su historial de compras.</p>
        )}
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>{res ? "Listo" : "Cancelar"}</button>
          {c.email && !res && <button type="button" className="btn pri" disabled={enviando} onClick={generar}>{enviando ? "Generando…" : "Generar código"}</button>}
        </div>
      </form>
    </Modal>
  );
}
