import Modal from "../../components/Modal";
import useSubmit from "../../hooks/useSubmit";

/** Confirmación genérica. `accion` puede lanzar: el error se muestra en el diálogo. */
export default function ConfirmarDialog({ titulo, texto, boton, peligro, accion, onClose }) {
  const { error, enviando, onSubmit } = useSubmit(() => accion());
  return (
    <Modal onClose={onClose}>
      <form onSubmit={onSubmit}>
        <h1>{titulo}</h1>
        <p className="muted">{texto}</p>
        <div className="err" role="alert">{error}</div>
        <div className="acts">
          <button type="button" className="btn" onClick={onClose}>Volver</button>
          <button className={`btn ${peligro ? "bad" : "pri"}`} disabled={enviando}>{enviando ? "Un momento…" : boton}</button>
        </div>
      </form>
    </Modal>
  );
}
