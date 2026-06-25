import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR: customers/data_request
// Den här appen lagrar ingen kunddata (inga personuppgifter — bara butikens
// leveransfönster och API-nyckel). Det finns därför ingenting att lämna ut.
// Vi bekräftar att webhooken tagits emot.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} — no customer data stored`);
  return new Response();
};
