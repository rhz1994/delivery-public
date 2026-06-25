import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <s-page heading="Gröna Gårdar leverans">
      <s-section heading="Leveransdrawer aktiv">
        <s-paragraph>
          Leveransvalet visas i butiken via temats app-block
          &ldquo;Leveransdrawer&rdquo;. Leveransalternativ h&auml;mtas fr&aring;n
          appens egen databas utifr&aring;n kundens postnummer.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
