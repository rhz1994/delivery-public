import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR: shop/redact
// Skickas 48h efter att en butik avinstallerat appen. Vi raderar all data vi
// lagrar för butiken: leveransfönster, API-nyckel och eventuell kvarvarande
// session.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} — redacting all shop data`);

  await db.$transaction([
    db.deliveryWindow.deleteMany({ where: { shop } }),
    db.apiCredential.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
