# Deploy

Deployment is intentionally parked while the app is being tested locally with
CSV-backed delivery data.

For local work, run:

```shell
npm run db:migrate
npm run db:import
npm run dev
```

`shopify app dev` should update `application_url`, auth redirect URLs and app
proxy URL to the current dev tunnel. The committed `shopify.app.toml` uses
`https://example.com` as a neutral placeholder so `/apps/gordon-delivery` does
not accidentally point at an old Railway service.

Before deploying again:

1. Pick the hosting target.
2. Set `SHOPIFY_APP_URL` and `DATABASE_URL` in that environment.
3. Run migrations.
4. Import `delivery_data.csv` into the production database.
5. Update and deploy the Shopify app config so `[app_proxy].url` points to
   `https://<app-domain>/api/delivery`.
6. Register or update the CarrierService callback to
   `https://<app-domain>/api/carrier-rates`.
7. In Shopify Admin, remove or restrict manual shipping rates that should not
   appear beside the Gröna Gårdar CarrierService rate.
