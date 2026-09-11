// Máquina de estados del flujo de logística inversa (devoluciones y cambios).
// Centraliza las transiciones válidas para que ningún controlador pueda
// saltarse pasos del proceso (p.ej. pasar de SOLICITADA a REINTEGRADA directamente).

const ESTADOS = {
  SOLICITADA: 'SOLICITADA',
  APROBADA: 'APROBADA',
  RECHAZADA: 'RECHAZADA',
  RECIBIDA: 'RECIBIDA',
  EN_REVISION: 'EN_REVISION',
  ACEPTADA: 'ACEPTADA',
  RECHAZADA_EN_REVISION: 'RECHAZADA_EN_REVISION',
  REINTEGRADA: 'REINTEGRADA',
  CAMBIADA: 'CAMBIADA'
};

// Mapa de transiciones permitidas: estado actual -> lista de estados a los que puede pasar.
const TRANSICIONES_VALIDAS = {
  [ESTADOS.SOLICITADA]: [ESTADOS.APROBADA, ESTADOS.RECHAZADA],
  [ESTADOS.APROBADA]: [ESTADOS.RECIBIDA],
  [ESTADOS.RECHAZADA]: [],
  [ESTADOS.RECIBIDA]: [ESTADOS.EN_REVISION],
  [ESTADOS.EN_REVISION]: [ESTADOS.ACEPTADA, ESTADOS.RECHAZADA_EN_REVISION],
  [ESTADOS.ACEPTADA]: [ESTADOS.REINTEGRADA, ESTADOS.CAMBIADA],
  [ESTADOS.RECHAZADA_EN_REVISION]: [],
  [ESTADOS.REINTEGRADA]: [],
  [ESTADOS.CAMBIADA]: []
};

// Estados terminales: una vez alcanzados, la devolución no admite más operaciones.
const ESTADOS_FINALES = [
  ESTADOS.RECHAZADA,
  ESTADOS.RECHAZADA_EN_REVISION,
  ESTADOS.REINTEGRADA,
  ESTADOS.CAMBIADA
];

function validarTransicion(estadoActual, estadoNuevo) {
  const permitidos = TRANSICIONES_VALIDAS[estadoActual] || [];
  return permitidos.includes(estadoNuevo);
}

function esEstadoFinal(estado) {
  return ESTADOS_FINALES.includes(estado);
}

module.exports = { ESTADOS, TRANSICIONES_VALIDAS, ESTADOS_FINALES, validarTransicion, esEstadoFinal };
