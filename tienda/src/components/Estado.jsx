/** Mensajes de carga / error / vacío con el estilo de tarjeta. */
export const Cargando = ({ children = "Cargando…" }) => <div className="card empty muted" aria-busy="true">{children}</div>;

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="card empty">
      <p className="err">{message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export const Vacio = ({ children }) => <div className="card empty muted">{children}</div>;

/** Pastilla de estado: `info` = { texto, tono } (ver utils/constants). */
export const Pastilla = ({ info }) => <span className={"st " + ((info && info.tono) || "")}>{(info && info.texto) || "—"}</span>;
