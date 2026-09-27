# Payment setup

## Cashier Pesapal checkout

The storefront and cashier checkout use the Express server in `server.js` for Pesapal. The server must be reachable by Pesapal over HTTPS for the callback and IPN, so local testing requires an HTTPS tunnel such as ngrok or Cloudflare Tunnel.

### Production values

Use the live Pesapal v3 endpoint and the exact public HTTPS origin where this server is deployed:

```text
PESAPAL_BASE_URL=https://pay.pesapal.com/v3
SERVER_URL=https://your-real-domain.example
FRONTEND_URL=https://your-real-domain.example
PORT=5000
```

For a single-host deployment, `FRONTEND_URL` is optional because it defaults to `SERVER_URL`. The Node.js host must serve both the Express API and the static frontend; GitHub Pages cannot run the API or receive Pesapal callbacks.

Replace `your-real-domain.example` with the real domain. Do not use `vendora.example.com` unless that domain is actually registered and routed to this deployment. Keep `PESAPAL_CONSUMER_KEY`, `PESAPAL_CONSUMER_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY` in the hosting provider's server-side secret settings, never in frontend files.

In the live Pesapal merchant portal, register this IPN URL exactly once:

```text
https://your-real-domain.example/api/payments/pesapal-ipn
```

Use the returned live `ipn_id` as `PESAPAL_IPN_ID`. The checkout callback URL is generated automatically as:

```text
https://your-real-domain.example/api/payments/pesapal-callback
```

Do not reuse a sandbox IPN ID or sandbox consumer credentials with the live endpoint. After deployment, confirm that the callback and IPN URLs are reachable over HTTPS and that the server logs show successful Pesapal token authentication before accepting real payments.

Install dependencies and start the backend:

```powershell
npm install
npm start
```

Set these values in the project `.env` file. Keep all keys server-side and do not commit `.env`:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
PESAPAL_BASE_URL=https://cybqa.pesapal.com/pesapalv3
PESAPAL_CONSUMER_KEY=...
PESAPAL_CONSUMER_SECRET=...
PESAPAL_IPN_ID=...
SERVER_URL=https://your-public-https-domain.example
FRONTEND_URL=http://localhost:3000
PORT=5000
```

Register the IPN URL once with Pesapal, using `https://your-public-https-domain.example/api/payments/pesapal-ipn`, then save the returned `ipn_id` as `PESAPAL_IPN_ID`.

Run the orders migration in the Supabase SQL Editor before testing:

```text
supabase-orders-payments-migration.sql
```

For local frontend development with the backend on port 5000, use the existing Live Server or static server on port 3000. Set `FRONTEND_URL=http://localhost:3000`. The frontend already routes payment API calls to `http://localhost:5000` when opened locally. In a single-host deployment, omit `FRONTEND_URL` or set it to the public HTTPS URL serving `index.html` and `cashier.html`.

## MTN Money and Airtel Money

The customer checkout calls the Supabase Edge Function named `create-payment`.
Run these commands from the project root after installing the Supabase CLI and logging in:

```powershell
supabase link --project-ref hxuzkwittfotrdyuvglv
supabase functions deploy create-payment
```

Set the provider secrets in Supabase before testing. Use the values supplied by MTN MoMo or Airtel Money; do not put them in frontend JavaScript or commit them to this repository.

```powershell
supabase secrets set MTN_BASE_URL=... MTN_SUBSCRIPTION_KEY=... MTN_API_USER=... MTN_API_KEY=... MTN_TARGET_ENVIRONMENT=sandbox
supabase secrets set AIRTEL_BASE_URL=... AIRTEL_CLIENT_ID=... AIRTEL_CLIENT_SECRET=...
```

Run both `supabase-orders-payments-migration.sql` and `supabase-customer-auth-migration.sql` in the Supabase SQL Editor, then reload the storefront. The first migration creates the order/payment tables and the second applies the customer checkout RLS policies. The customer checkout must be opened from the storefront (`index.html`); cashier payments still use the separate Pesapal flow.

## Admin authorization

Run `supabase-admin-authorization-migration.sql` after the migrations above. Admin access is granted only through Supabase Auth `app_metadata`, for example:

```json
{ "role": "admin" }
```

Set this value from a trusted server-side process or the Supabase Dashboard. Do not place admin roles in `user_metadata`, because users can update that metadata themselves. The migration keeps product reads public for the storefront but restricts product, order, and product-image mutations to admins.