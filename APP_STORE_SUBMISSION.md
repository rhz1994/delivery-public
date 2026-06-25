# App Store-inlämning — checklista & listing-innehåll

Status för **Local Delivery Windows** (delivery-public) inför publik review.

Allt kodarbete (paket 1–6) är klart. Det som återstår är drift (domän + deploy)
och innehåll i Partners-dashboarden. Det här dokumentet samlar båda.

---

## Del 1 — Blockerare: domän + deploy (paket 7)

Inget av detta går att slutföra utan en stabil HTTPS-domän. Servern (DigitalOcean
Droplet) finns redan; det som saknas är domän → DNS → TLS.

1. **Skaffa domän.** En subdomän på en domän ni redan äger räcker, t.ex.
   `delivery.ert-företag.se`. (En helt ny domän går också, ~100–150 kr/år.)
2. **Peka DNS** (A-record) mot dropletens IP: `207.154.252.173`.
3. **TLS-certifikat** på domänen (Let's Encrypt via Caddy/nginx, eller motsv.).
4. **Sätt produktions-env** på servern: `SHOPIFY_API_SECRET`, `DATABASE_URL`,
   `SHOPIFY_APP_URL=https://din-domän`, `SCOPES`, `APP_CONTACT_EMAIL`.
5. **Uppdatera URL:er** i `shopify.app.toml` (byt ut `https://example.com`):
   - `application_url`
   - `[auth] redirect_urls`
   - `[app_proxy] url`
6. **Deploya app-konfig + extensions:** `shopify app deploy`.
   (Krävs nu — proxy-pathen `apps/delivery` och GDPR-webhooks är ändrade i toml
   men ännu inte aktiverade hos Shopify.)
7. Verifiera att de automatiska checkarna blir gröna (TLS, redirect, webhooks).

---

## Del 2 — Partners-dashboard (kräver INTE domän)

Kan göras parallellt, när som helst:

- [ ] **App-ikon** — ladda upp (ingen "Shopify"/"example" i bilden).
- [ ] **API contact email** — sätt en egen adress (utan ordet "shopify").
- [ ] **Emergency contact** — klart enligt senaste skärmdump.
- [ ] **Privacy policy-URL** — `https://din-domän/privacy` (sidan finns redan
      som route, se `app/routes/privacy.tsx`).
- [ ] **Listing-innehåll** — se Del 3.
- [ ] **Bekräfta "Doesn't need access to protected customer data"** — stämmer:
      scopes är bara `write_validations,write_delivery_customizations`, ingen
      kunddata läses eller lagras.

---

## Del 3 — Listing-innehåll (engelska)

Klistra in i Partners → listing. Justera fritt.

**App name**
> Local Delivery Windows

**Tagline / short description** (≤ 62 tecken)
> Postal-code delivery windows in your cart and checkout

**Detailed description**
> Local Delivery Windows lets you offer customers accurate delivery dates and
> pickup options based on their postal code — right in the cart.
>
> Customers enter their postal code and instantly see the delivery days and
> pickup locations available in their area, pulled from your own schedule. No
> more promising dates you can't keep.
>
> **Key features**
> - Postal-code based delivery and pickup options
> - A clean, themeable drawer you add through the theme editor
> - Configurable store name, heading and colors — matches your brand
> - Upload your schedule as CSV, or push it automatically via a per-store API key
> - Hides options whose order cut-off has already passed
>
> The app stores no customer personal data. It only keeps the delivery schedule
> you provide.

**Pricing**
> (Fyll i — t.ex. Free, eller en plan. Måste anges innan inlämning.)

**Category**
> Orders and shipping → Delivery and pickup (eller närmast motsvarande)

**Screenshots** (behövs för listing)
> 1. Drawer i butiken med postnummer-steget
> 2. Drawer med kalender/dagval
> 3. Admin: översikt
> 4. Admin: Leveransdata (API-nyckel + CSV)

---

## Del 4 — Innan inlämning

- [ ] Kör Shopifys **AI Toolkit self-review** (kommandot på review-sidan) när
      URL:erna är på plats — fångar vanliga fel före inlämning.
- [ ] Installera appen i en utvecklingsbutik och gå igenom hela flödet:
      installera → admin laddar direkt → generera nyckel → ladda upp CSV →
      widget i temat hämtar rätt data → avinstallera (data raderas).
- [ ] Bekräfta att en butik bara ser sin egen data (multi-tenant-isolering).
