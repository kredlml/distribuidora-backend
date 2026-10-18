import { useState } from "react";

/** Manejo común de formularios: error, estado de envío y onSubmit. `action(formData, form)` puede lanzar. */
export default function useSubmit(action) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  const onSubmit = async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    setError(""); setEnviando(true);
    try {
      await action(new FormData(form), form);
    } catch (e) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  };
  return { error, enviando, onSubmit, setError };
}
