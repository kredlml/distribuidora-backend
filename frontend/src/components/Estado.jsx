/** Mensajes de carga / error / vacío con el estilo de tarjeta. */
export const Cargando = ({ children }) => <div className="card empty muted">{children}</div>;

export function ErrorCard({ message, onRetry }) {
  return (
    <div className="card empty">
      <p className="err">{message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}
