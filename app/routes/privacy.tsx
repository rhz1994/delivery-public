import type { LoaderFunctionArgs } from "react-router";

// Publik integritetspolicy. Ingen autentisering — måste vara nåbar för
// Shopifys granskare och för länken i app-listingen.
export async function loader({ request }: LoaderFunctionArgs) {
  const contactEmail = process.env.APP_CONTACT_EMAIL || "support@example.com";
  const appName = "Local Delivery Windows";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${appName} — Privacy Policy</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.6;
    max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.6rem; } h2 { font-size: 1.2rem; margin-top: 2rem; }
  a { color: #0d6efd; }
  footer { margin-top: 3rem; font-size: .85rem; color: #666; }
</style>
</head>
<body>
  <h1>${appName} — Privacy Policy</h1>
  <p><em>Last updated: ${new Date().getFullYear()}</em></p>

  <h2>Overview</h2>
  <p>
    ${appName} (the &ldquo;App&rdquo;) helps Shopify merchants show postal-code
    based delivery windows to their customers at checkout. This policy explains
    what data the App processes.
  </p>

  <h2>Data we do not collect</h2>
  <p>
    The App does <strong>not</strong> request, access, or store any protected
    customer data. It does not read customer names, email addresses, phone
    numbers, shipping addresses, or order information. The customer's postal
    code is sent to the App only at the moment of lookup to return available
    delivery options, and is not stored.
  </p>

  <h2>Data we store</h2>
  <ul>
    <li><strong>Delivery windows</strong> — dates, locations and postal-code
      ranges that the merchant (or the merchant's data provider) uploads. This
      is merchant business data, not personal data.</li>
    <li><strong>Shop identifier</strong> — the merchant's <code>.myshopify.com</code>
      domain, used to isolate each store's data.</li>
    <li><strong>API credentials</strong> — a hashed API key per store, used to
      authenticate delivery-window uploads.</li>
    <li><strong>Session data</strong> — standard Shopify OAuth session tokens
      required to run an embedded app.</li>
  </ul>

  <h2>Data deletion</h2>
  <p>
    When a merchant uninstalls the App, all of their data (delivery windows,
    API credentials and sessions) is deleted in response to Shopify's
    <code>shop/redact</code> compliance webhook. Because the App stores no
    customer data, the <code>customers/redact</code> and
    <code>customers/data_request</code> webhooks have no personal data to act on.
  </p>

  <h2>Contact</h2>
  <p>
    Questions about this policy? Email
    <a href="mailto:${contactEmail}">${contactEmail}</a>.
  </p>

  <footer>${appName}</footer>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
