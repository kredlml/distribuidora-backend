# Distribuidora · Tienda en línea

Tienda para clientes: catálogo, carrito, pago con tarjeta (Stripe), seguimiento de pedidos y
solicitudes de cambio o devolución. React + Vite + React Router. Consume `/api/tienda` del backend.

## Uso
```bash
cp .env.example .env   # ajusta VITE_API_URL y VITE_STRIPE_PUBLISHABLE_KEY
npm install
npm run dev            # http://localhost:8082
npm run build
```

- `VITE_API_URL`: URL del backend. El backend debe incluir el origen de la tienda en `CORS_ORIGIN`
  (por defecto ya permite `http://localhost:8081` y `http://localhost:8082`).
- `VITE_STRIPE_PUBLISHABLE_KEY`: clave publicable `pk_test_...` de la **misma cuenta** que la
  `STRIPE_SECRET_KEY` del backend. Si el backend usa la clave simulada, puede quedar vacía.

## Pagos con tarjeta
- Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
- Al pagar, la tienda confirma la tarjeta con Stripe.js y pide al backend sincronizar el cobro, así
  que funciona en local **sin** el webhook. Si además quieres recibir el webhook:
  `stripe listen --forward-to localhost:8080/api/webhook`.

## Estructura
- `src/pages/<Pantalla>/` — una carpeta por pantalla (componente, subcomponentes y CSS propio)
- `src/components/` — componentes compartidos (Layout, Imagen, Cantidad, SelectorSucursal...)
- `src/services/` — acceso a la API (`api.js` + un servicio por recurso)
- `src/context/` — sesión del cliente (Auth), carrito (Cart) y avisos (Toast)
- `src/hooks/`, `src/utils/`, `src/config/env.js`, `src/styles/`
