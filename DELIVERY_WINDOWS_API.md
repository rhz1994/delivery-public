# Delivery Windows API

Det här API:t låter en extern part skapa och uppdatera leveransfönster i
appens egen databas. Extern part ska **inte** ansluta direkt till databasen.

## Endpoint

```text
POST https://<app-domain>/api/delivery-windows
```

I produktion ersätts `<app-domain>` med appens riktiga domän, till exempel:

```text
https://gordon.gronagardar.se/api/delivery-windows
```

Endpointen är inte en Shopify App Proxy-route. Den anropas direkt på appens
serverdomän.

## Autentisering

Alla anrop måste skicka en Bearer-token:

```http
Authorization: Bearer <secret>
Content-Type: application/json
```

Token sätts som miljövariabel på servern:

```env
EXTERNAL_DELIVERY_WINDOWS_API_KEY=replace-with-long-random-secret
```

Skicka aldrig nyckeln i query string eller i request body.

## Request Body

```json
{
  "mode": "upsert",
  "items": [
    {
      "zipcode": "30241",
      "deliveryDate": "2026-07-02",
      "packDate": "2026-07-01",
      "stopDate": "2026-06-30",
      "homeDelivery": true,
      "deliveryLocationId": 123,
      "deliveryLocationName": "Halmstad"
    }
  ]
}
```

### Fält

| Fält | Typ | Obligatoriskt | Beskrivning |
| --- | --- | --- | --- |
| `mode` | string | Nej | `"upsert"` om det saknas. Kan vara `"upsert"` eller `"replace_upcoming"`. |
| `replaceFromDate` | string | Nej | Endast för `"replace_upcoming"`. `YYYY-MM-DD`. Om det saknas används dagens datum i svensk tid. |
| `items` | array | Ja | Lista med leveransfönster. Max 5000 rader per request. |
| `items[].zipcode` | string/null | Nej | Fem siffror för hemleverans, t.ex. `"30241"`. `null`, tomt eller `"NULL"` betyder att raden gäller alla postnummer. |
| `items[].deliveryDate` | string | Ja | Leveransdatum till kund, `YYYY-MM-DD`. |
| `items[].packDate` | string | Ja | Datum då ordern packas, `YYYY-MM-DD`. Måste vara samma dag eller före `deliveryDate`. |
| `items[].stopDate` | string | Ja | Sista beställningsdag, `YYYY-MM-DD`. Måste vara samma dag eller före `deliveryDate`. |
| `items[].homeDelivery` | boolean | Ja | `true` för hemleverans, `false` för utlämningsställe. |
| `items[].deliveryLocationId` | number | Ja | Stabilt positivt heltals-ID för leveransplatsen. |
| `items[].deliveryLocationName` | string | Ja | Namn som visas för kunden. Max 255 tecken. |

Varje rad identifieras av kombinationen:

```text
zipcode + deliveryDate + deliveryLocationId
```

Det betyder att samma leveransplats kan finnas på flera datum, och samma datum
kan finnas för flera postnummer.

## Modes

### `upsert`

Rekommenderas för löpande uppdateringar.

Om en rad redan finns uppdateras den. Om den inte finns skapas den.

En befintlig rad matchas på:

```text
zipcode + deliveryDate + deliveryLocationId
```

Följande fält uppdateras på befintliga rader:

```text
packDate
stopDate
homeDelivery
deliveryLocationName
```

### `replace_upcoming`

Används när extern part skickar hela sanningen för kommande schema.

Appen tar då bort alla befintliga rader där:

```text
deliveryDate >= replaceFromDate
```

och skapar sedan alla rader från `items`.

Om `replaceFromDate` saknas används dagens datum i Europe/Stockholm.

Exempel:

```json
{
  "mode": "replace_upcoming",
  "replaceFromDate": "2026-07-01",
  "items": [
    {
      "zipcode": null,
      "deliveryDate": "2026-07-03",
      "packDate": "2026-07-02",
      "stopDate": "2026-07-01",
      "homeDelivery": false,
      "deliveryLocationId": 45,
      "deliveryLocationName": "Utlämning Göteborg"
    }
  ]
}
```

## Exempel Med `curl`

```bash
curl -X POST https://gordon.gronagardar.se/api/delivery-windows \
  -H "Authorization: Bearer DIN_HEMLIGA_NYCKEL" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "upsert",
    "items": [
      {
        "zipcode": "30241",
        "deliveryDate": "2026-07-02",
        "packDate": "2026-07-01",
        "stopDate": "2026-06-30",
        "homeDelivery": true,
        "deliveryLocationId": 123,
        "deliveryLocationName": "Halmstad"
      }
    ]
  }'
```

## Svar

### Lyckat `upsert`

```json
{
  "ok": true,
  "mode": "upsert",
  "received": 1,
  "created": 1,
  "updated": 0
}
```

### Lyckat `replace_upcoming`

```json
{
  "ok": true,
  "mode": "replace_upcoming",
  "received": 1200,
  "replaceFromDate": "2026-07-01",
  "deleted": 1180,
  "created": 1200
}
```

### Valideringsfel

```json
{
  "error": "Validation failed.",
  "details": [
    "items[0].zipcode must contain exactly five digits."
  ]
}
```

## HTTP Statuskoder

| Status | Betydelse |
| --- | --- |
| `200` | Importen lyckades. |
| `400` | Fel JSON eller fel dataformat. |
| `401` | Saknad eller fel Bearer-token. |
| `405` | Fel HTTP-metod. Använd `POST`. |
| `500` | Serverfel eller saknad serverkonfiguration. |

## Regler Att Ge Extern Part

- Skicka max 5000 rader per request.
- Skicka datum som rena datum i `YYYY-MM-DD`.
- Skicka `homeDelivery` som riktig JSON-boolean, alltså `true` eller `false`.
- Skicka `zipcode: null` för utlämningsställen som gäller alla postnummer.
- Skicka inte dubletter med samma `zipcode`, `deliveryDate` och
  `deliveryLocationId` i samma request.
- Använd `upsert` för mindre/löpande ändringar.
- Använd `replace_upcoming` bara när hela kommande schemat skickas.
