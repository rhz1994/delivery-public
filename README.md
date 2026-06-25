# Gröna Gårdar – leveransval

Shopify-app och Theme App Extension som låter kunden välja postnummer,
leveranssätt, leveransdatum och leveransställe i butikens cart drawer – och som
för över valt leveransställe (`delivery_location_id`) till Thea med ordern.

Appen använder **inte** Gordon API. Leveransalternativen exporteras från Theas
nuvarande hemsida till `../delivery_data.csv`, importeras till appens egen
Postgres-databas och läses sedan av butiken via Shopify App Proxy.

För extern uppdatering av leveransdata finns en skyddad endpoint:
[Delivery Windows API](DELIVERY_WINDOWS_API.md).

## Vad appen ska göra

Enligt underlaget från Thea (Jakob Reuterswärd) ska appen:

1. **Filtrera** leveransdatan på det postnummer kunden anger.
2. **Visa** relevanta alternativ i ett UI där kunden kan välja ett av dem.
3. **Föra över** `delivery_location_id` till Thea när ordern är lagd.

Eftersom vissa postnummer har många alternativ låter UI:t kunden välja
leveransdag först (kalender) och därefter de leveransställen som finns den dagen.
Rader med `zipcode = NULL` (de flesta utlämningsställen) gäller **alla** kunder
oavsett postnummer.

## CSV-format

Importen förväntar sig följande kolumner:

```csv
delivery_date,pack_date,home_delivery,delivery_location_id,stop_date,zipcode,delivery_location_name
```

| Kolumn | Betydelse |
| --- | --- |
| `delivery_date` | Leveransdatum till kund, `YYYY-MM-DD` |
| `pack_date` | Datum då ordern packas, `YYYY-MM-DD` |
| `home_delivery` | `1` = hemleverans, `0` = utlämningsställe |
| `delivery_location_id` | ID som följer med ordern till Thea |
| `stop_date` | Sista beställningsdag, `YYYY-MM-DD` |
| `zipcode` | Svenskt postnummer (5 siffror), eller tomt/`NULL` = gäller alla postnummer |
| `delivery_location_name` | Namn som visas för kunden |

Nuvarande CSV innehåller ca **160 000 rader**, 9 000+ postnummer, 15
leveransställen och leveransdatum från 2026-06-20 till 2026-08-03. Datan sträcker
sig ca 6 veckor framåt; intervallet kan justeras vid en framtida export.

## Kundflöde

1. Kunden lägger en produkt i varukorgen.
2. Leveransdrawern öppnas (om inställningen *Öppna efter Lägg i varukorg* är på)
   – men bara om kunden inte redan har ett komplett, sparat val.
3. Kunden anger postnummer.
4. Appen hämtar tillgängliga leveransalternativ från databasen via App Proxy.
5. Alternativen delas i två flikar – **Hemleverans** och **Utlämningsställe**.
   Kunden väljer flik, leveransdag (endast dagar med alternativ är klickbara) och
   leveransställe.
6. Valet sparas som Shopify cart attributes och visas som en sammanfattning högst
   upp i varukorgen (med en *Byt*-knapp).

Alternativ vars `stop_date` redan passerat (svensk tid) filtreras bort i
backend och visas aldrig.

## Cart attributes och Thea-integration

När kunden bekräftar sparas följande attribut på varukorgen:

| Attribut | Synlig i checkout | Innehåll |
| --- | --- | --- |
| `Postnummer` | Ja | Kundens postnummer |
| `Leveranssätt` | Ja | `Hemleverans` eller `Utlämningsställe` |
| `Leveransställe` | Ja | `delivery_location_name` |
| `Leveransdatum` | Ja | Valt `delivery_date` |
| `_delivery_location_id` | **Nej** (dolt) | `delivery_location_id` |
| `delivery_location_id` | Ja | Samma id, synlig variant |

Attribut med `_`-prefix är dolda för kunden i checkout men läsbara i Shopify
Admin/API. **Det är via `_delivery_location_id` (och dess synliga kopia) som Thea
plockar upp valt leveransställe med ordern.**

## Teknisk arkitektur

```text
Shopify-tema
  └─ Theme App Extension: app-blocket "Leveransdrawer"
       └─ grona-delivery.js  (drawer, kalender, val, cart attributes)
            └─ GET /apps/gordon-delivery?zipcode=NNNNN
                 └─ Shopify App Proxy  →  /api/delivery
                      └─ React Router-backend (api.delivery.tsx)
                           └─ delivery.server.ts
                                └─ Prisma  →  Postgres (DeliveryWindow)
```

**Backend** ([app/delivery.server.ts](app/delivery.server.ts),
[app/routes/api.delivery.tsx](app/routes/api.delivery.tsx)):

- Validerar postnummer (`^\d{5}$`).
- Hämtar rader där `zipcode = kundens` **eller** `zipcode IS NULL`, och bara där
  `stop_date >= idag` (Europe/Stockholm).
- Delar upp svaret i `homeDelivery` (`home_delivery = true`) och `pickup`
  (`home_delivery = false`).
- Svarar med JSON och svenska felmeddelanden.

**Frontend** ([extensions/gordon-widget/](extensions/gordon-widget/)):

- Drawer med stegnavigering och fokushantering (tillgänglighet).
- Postnummer-inmatning, kalender, val av metod/dag/leveransställe.
- Sparar valet i Shopify-varukorgen och kan återställa ett tidigare val.

**Databas** ([prisma/schema.prisma](prisma/schema.prisma)): tabellen
`DeliveryWindow` speglar CSV-kolumnerna. `zipcode` är nullbar (NULL = alla
postnummer). Unikt index på `[zipcode, deliveryDate, deliveryLocationId]` och
index på `zipcode` för uppslag.

## App Proxy

Konfigureras i [shopify.app.toml](shopify.app.toml):

```toml
[app_proxy]
url = "https://<app-domain>/api/delivery"
subpath = "gordon-delivery"
prefix = "apps"
```

Det ger butiks-URL:en `/apps/gordon-delivery`, som temat anropar. Vid
`shopify app dev` uppdateras URL:erna automatiskt till den aktuella dev-tunneln;
den incheckade `https://example.com` är en neutral platshållare så proxyn inte
av misstag pekar på en gammal tjänst.

## Carrier Service i checkout

Checkout-frakten skapas via en Shopify CarrierService som pekar på:

```text
POST /api/carrier-rates
```

Endpointen använder samma `DeliveryWindow`-data som widgeten, men Shopify skickar
bara checkoutens aktuella adress/postnummer. Den kan därför:

- returnera **Gröna Gårdar hemleverans** när postnumret har kommande hemleverans,
- returnera inga rates när postnumret saknas, är ogiltigt eller saknar hemleverans,
- sätta pris från `GORDON_SHIPPING_PRICE_ORE` och valuta från
  `GORDON_SHIPPING_CURRENCY`.

Den kan däremot inte läsa widgetens cart attributes, till exempel valt
`Leveransdatum` eller det tidigare valda `Postnummer`. Om kunden byter till ett
annat postnummer som också har hemleverans kan CarrierService därför fortfarande
returnera en Gordon-rate för det nya postnumret. Riktig blockering av "annat
checkout-postnummer än widget-postnummer" kräver Shopify Functions eller Plus.

### Registrera CarrierService

Callback URL ska vara appens publika URL plus `/api/carrier-rates`, till exempel:

```text
https://<app-domain>/api/carrier-rates
```

I GraphiQL/Admin API:

```graphql
mutation CarrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
  carrierServiceCreate(input: $input) {
    carrierService {
      id
      name
      callbackUrl
      active
    }
    userErrors {
      field
      message
    }
  }
}
```

Variabler:

```json
{
  "input": {
    "name": "Gröna Gårdar",
    "callbackUrl": "https://<app-domain>/api/carrier-rates",
    "serviceDiscovery": true,
    "active": true
  }
}
```

Shopify visar CarrierService-rates tillsammans med butikens vanliga fraktpriser.
För att bara visa Gordon i checkout behöver shipping profilen/zonens manuella
rates tas bort eller avgränsas så att de inte konkurrerar med CarrierService.

## Lokal utveckling

```shell
cp .env.example .env        # fyll i SHOPIFY_API_SECRET och DATABASE_URL
npm install
npm run db:migrate          # prisma migrate dev
npm run db:import           # importerar ../delivery_data.csv
npm run dev                 # shopify app dev
```

`npm run db:import` ([prisma/import-csv.mjs](prisma/import-csv.mjs)) **tömmer**
`DeliveryWindow` och importerar om alla rader från `../delivery_data.csv` i
batchar. `zipcode`-värdet `NULL`/tomt lagras som databas-NULL.

Lokalt injicerar Shopify CLI `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` och
`SHOPIFY_APP_URL`. I produktion måste alla variabler i
[.env.example](.env.example) sättas som miljövariabler. CarrierService kräver
`SCOPES=write_shipping` när appen installeras/uppdateras.

Välj development store i Shopify CLI, öppna temaförhandsvisningen och lägg till
app-blocket **Leveransdrawer** i temat.

## Verifiering

```shell
npm run typecheck
npm run lint
npm run build
```

## Deploy

Se [DEPLOY.md](DEPLOY.md). Kortfattat: välj hosting, sätt `SHOPIFY_APP_URL` och
`DATABASE_URL`, kör migrationer, importera `delivery_data.csv` i
produktionsdatabasen och peka `[app_proxy].url` mot `https://<app-domain>/api/delivery`.

## Nästa steg

- Adminvy med senaste import, antal rader och datumintervall.
- Validera kundens checkout-postnummer mot sparat `Postnummer` om Shopify-planen
  stödjer det.
