import type { LoaderFunctionArgs } from "react-router";
import { getDeliveryAvailability, DeliveryError } from "../delivery.server";
import { authenticate } from "../shopify.server";

// Leveransfönster ändras sällan (importeras i batch via /api/delivery-windows),
// så svaret får cachas en kort stund. Svaret varierar på ?zipcode= som ingår i
// URL:en, så det är säkert per postnummer. Felsvar cachas inte.
const CACHE_OK = "public, max-age=300, stale-while-revalidate=60";
const CACHE_NONE = "no-store";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": status === 200 ? CACHE_OK : CACHE_NONE,
        "X-Content-Type-Options": "nosniff",
      },
    });

  const url = new URL(request.url);
  const zipcode = (url.searchParams.get("zipcode") || "")
    .replace(/\s/g, "")
    .trim();

  try {
    const result = await getDeliveryAvailability(zipcode);
    return response(result);
  } catch (error) {
    console.error("Delivery availability request failed", error);
    const status = error instanceof DeliveryError ? error.status : 500;
    const message =
      error instanceof DeliveryError
        ? error.message
        : "Ett oväntat fel uppstod. Försök igen.";
    return response({ error: message }, status);
  }
}
