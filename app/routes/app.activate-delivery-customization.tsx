import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const functionsResponse = await admin.graphql(`#graphql
    query {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
          app {
            handle
          }
        }
      }
    }
  `);
  const functionsJson = await functionsResponse.json();
  const functions = functionsJson?.data?.shopifyFunctions?.nodes || [];
  const fn = functions.find(
    (f: { apiType: string }) => f.apiType === "delivery_customization",
  );

  if (!fn) {
    return { ok: false, error: "Hittade inte delivery_customization-funktionen. Har du kört shopify app deploy?" };
  }

  const createResponse = await admin.graphql(`#graphql
    mutation deliveryCustomizationCreate($input: DeliveryCustomizationInput!) {
      deliveryCustomizationCreate(deliveryCustomization: $input) {
        deliveryCustomization {
          id
          title
          enabled
        }
        userErrors {
          message
        }
      }
    }
  `, {
    variables: {
      input: {
        functionId: fn.id,
        title: "Gröna Gårdar leveransanpassning",
        enabled: true,
      },
    },
  });

  const createJson = await createResponse.json();
  const errors = createJson?.data?.deliveryCustomizationCreate?.userErrors;
  if (errors?.length) {
    return { ok: false, error: errors.map((e: { message: string }) => e.message).join(", ") };
  }

  const created = createJson?.data?.deliveryCustomizationCreate?.deliveryCustomization;
  return { ok: true, id: created?.id };
};

type ActionResult = { ok: boolean; id?: string; error?: string };

export default function ActivateDeliveryCustomization() {
  const fetcher = useFetcher<ActionResult>();
  const loading = fetcher.state !== "idle";
  const result = fetcher.data;

  return (
    <s-page heading="Aktivera leveransanpassning">
      <s-section heading="Aktivera Gröna Gårdar leveransanpassning">
        <s-paragraph>
          Klicka nedan för att aktivera leveransanpassningen som byter namn på
          fraktalternativet till rätt datum och döljer det om postnumret inte
          matchar.
        </s-paragraph>
        <fetcher.Form method="post">
          <s-button type="submit" loading={loading}>
            {loading ? "Aktiverar…" : "Aktivera leveransanpassning"}
          </s-button>
        </fetcher.Form>
        {result?.ok ? (
          <s-banner tone="success">
            <s-paragraph>Leveransanpassning aktiverad!</s-paragraph>
          </s-banner>
        ) : null}
        {result && !result.ok ? (
          <s-banner tone="critical">
            <s-paragraph>Fel: {result.error}</s-paragraph>
          </s-banner>
        ) : null}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
