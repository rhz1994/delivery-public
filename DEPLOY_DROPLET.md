# Deploy till DigitalOcean Droplet

Steg-för-steg för att köra Gröna Gårdar-appen i produktion på en Droplet (VPS).
Metod: SFTP-uppladdning av kod, PostgreSQL på servern, nginx + Let's Encrypt för HTTPS,
pm2 för att hålla Node-processen vid liv.

Bocka av allt eftersom. Steg 7–9 kräver en domän som pekar på Droplet:en.

---

## 0. Förutsättningar / fakta att samla in

- [ ] Droplet-IP: `__________` (DigitalOcean-panelen, eller `curl -4 ifconfig.me` på servern)
- [ ] SSH-användare + host (uppgifterna du fått)
- [ ] Har jag sudo? (`id | grep sudo`)
- [ ] OS/distro (`cat /etc/os-release | head -2`) — guiden antar Ubuntu/Debian (apt)
- [ ] Domän/subdomän vi får peka hit: `__________` (t.ex. delivery.gronagardar.se)
      → fråga den som äger DNS om en A-post: `<subdomän> → <Droplet-IP>`

---

## 1. Installera systempaket (en gång, kräver sudo)

```bash
# Node 20 (appen kräver >=20.19 <22 || >=22.12, se package.json)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# nginx (reverse proxy + TLS-terminering)
sudo apt-get install -y nginx

# pm2 (process-manager som startar om appen vid krasch/reboot)
sudo npm install -g pm2

node --version && psql --version && nginx -v
```

---

## 2. Skapa databas + db-användare

```bash
sudo -u postgres psql <<'SQL'
CREATE USER grona WITH PASSWORD 'BYT_TILL_STARKT_LÖSENORD';
CREATE DATABASE delivery OWNER grona;
GRANT ALL PRIVILEGES ON DATABASE delivery TO grona;
SQL
```

DATABASE_URL blir då:
`postgresql://grona:BYT_TILL_STARKT_LÖSENORD@localhost:5432/delivery`

(Postgres lyssnar bara på localhost — appen och databasen kör på samma server, så
ingen extern DB-port behöver öppnas. Bra för säkerheten.)

---

## 3. Ladda upp koden via SFTP

Ladda upp HELA projektmappen UTOM `node_modules` och `.git` till t.ex.
`/var/www/grona-app` på servern.

OBS: ladda INTE upp lokala `node_modules` — de byggs på servern (annars fel arkitektur).
Ta INTE heller med din lokala `.env` (den pekar på localhost/dev). Vi skapar en
produktions-`.env` direkt på servern i steg 5.

Mappstruktur på servern: `/var/www/grona-app/` ska innehålla `package.json`,
`app/`, `prisma/`, `extensions/` osv.

---

## 4. Installera beroenden + bygg (på servern)

```bash
cd /var/www/grona-app
npm ci                # installerar exakt enligt package-lock.json
npx prisma generate   # genererar Prisma-klienten
npm run build         # bygger React Router-servern -> build/
```

---

## 5. Produktions-miljövariabler

Skapa `/var/www/grona-app/.env` på servern (se .env.example för full lista):

```
NODE_ENV=production
SHOPIFY_API_KEY=1d9bb7f18eaa29792435405a90cb30ef
SHOPIFY_API_SECRET=<från Shopify Partners -> appen -> API credentials>
SHOPIFY_APP_URL=https://<din-domän>          # ingen avslutande slash
SCOPES=write_validations,write_delivery_customizations
DATABASE_URL=postgresql://grona:<lösenord>@localhost:5432/delivery
EXTERNAL_DELIVERY_WINDOWS_API_KEY=<lång slumpsträng för import-endpointen>
```

⚠️ SHOPIFY_APP_URL kan inte sättas förrän domänen finns (steg 7). Tills dess kan
appen byggas och databasen migreras, men inte testas mot Shopify.

---

## 6. Migrera databasen + importera leveransdata

```bash
cd /var/www/grona-app
npx prisma migrate deploy     # kör migrationerna mot prod-databasen
node prisma/import-csv.mjs     # importerar delivery_data.csv (om filen finns på servern)
```

---

## 7. (KRÄVER DOMÄN) Peka domänen + starta appen

1. Se till att A-posten `<domän> -> <Droplet-IP>` finns och pekar rätt
   (testa: `dig +short <domän>` ska ge Droplet-IP:n).

2. Starta appen under pm2:
```bash
cd /var/www/grona-app
pm2 start "npm run start" --name grona-app
pm2 save
pm2 startup        # följ instruktionen den skriver ut (gör att appen startar vid reboot)
```
Appen lyssnar nu internt (oftast port 3000). Testa: `curl http://localhost:3000`

---

## 8. (KRÄVER DOMÄN) nginx reverse proxy

Skapa `/etc/nginx/sites-available/grona-app`:

```nginx
server {
    listen 80;
    server_name <din-domän>;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/grona-app /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. (KRÄVER DOMÄN) HTTPS med Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <din-domän>
```

certbot fixar certifikat + skriver om nginx-configen till https automatiskt, och
sätter upp auto-förnyelse. Testa: öppna `https://<din-domän>` i webbläsaren.

---

## 10. Koppla Shopify till produktions-URL:en

1. I `shopify.app.toml` (eller via Partners-dashboard), sätt:
   - `application_url = "https://<din-domän>"`
   - `redirect_urls = [ "https://<din-domän>/auth/callback", "https://<din-domän>/api/auth" ]`
   - app_proxy `url = "https://<din-domän>/api/delivery"`
2. Kör `shopify app deploy` från din lokala maskin för att registrera URL:erna +
   deploya extensions/functions.
3. Installera/öppna appen i butiken via Partners -> appen -> Test/installera.

---

## 11. Aktivera delivery customization

I appen (admin): öppna "Aktivera leveransanpassning" och tryck en gång.
Verifiera under Settings -> Shipping -> Delivery customizations att exakt EN finns,
enabled. (Se [[delivery-checkout-architecture]] i minnet.)

---

## 12. Sluttest i butiken

- [ ] Hemleverans + ändrat adress-pnr -> blockeras
- [ ] Upphämtning + annan adress -> släpps igenom
- [ ] Direkt till /checkout utan val -> inga Gröna Gårdar-alternativ visas
- [ ] Utgånget val -> rensas/blockeras
- [ ] dev_mode AV på temats app-block (annars syns Nollställ-knappen för kunder)

---

## Uppdateringar framöver (efter en kodändring)

```bash
# 1. Ladda upp ändrade filer via SFTP till /var/www/grona-app
# 2. På servern:
cd /var/www/grona-app
npm ci            # om dependencies ändrats
npm run build
npx prisma migrate deploy   # om schemat ändrats
pm2 restart grona-app
# 3. Lokalt, om extensions/functions ändrats: shopify app deploy
```
