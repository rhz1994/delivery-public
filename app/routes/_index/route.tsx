import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

// This app has no storefront-facing or marketing frontend. The root URL only
// forwards Shopify's install/launch requests:
//   - `/?shop=...`  -> the embedded app (/app)
//   - anything else -> the login route, which kicks off OAuth install
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  throw redirect("/auth/login");
};
