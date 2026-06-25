import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR: customers/redact
// Appen lagrar ingen kunddata, så det finns inget att radera. Vi bekräftar
// att webhooken tagits emot.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} — no customer data to redact`);
  return new Response();
};
