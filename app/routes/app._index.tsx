import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getDeliverySummary } from "../delivery.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const summary = await getDeliverySummary(session.shop);
  return { shop: session.shop, summary };
};

function formatDate(iso: string | null) {
  return iso ?? "—";
}

export default function Index() {
  const { summary } = useLoaderData<typeof loader>();
  const hasData = summary.total > 0;

  return (
    <s-page heading="Leverans">
      <s-section heading="Översikt">
        {hasData ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              <s-text type="strong">{summary.total}</s-text> leveransfönster
              totalt, varav <s-text type="strong">{summary.upcoming}</s-text>{" "}
              fortfarande beställningsbara.
            </s-paragraph>
            <s-paragraph>
              Datumintervall: {formatDate(summary.firstDeliveryDate)} –{" "}
              {formatDate(summary.lastDeliveryDate)}
            </s-paragraph>
            <s-paragraph>
              Senast uppdaterad:{" "}
              {summary.lastImportAt
                ? new Date(summary.lastImportAt).toLocaleString("sv-SE")
                : "—"}
            </s-paragraph>
          </s-stack>
        ) : (
          <s-banner tone="info">
            <s-paragraph>
              Inga leveransfönster ännu. Generera en API-nyckel eller ladda upp en
              CSV under &ldquo;Leveransdata&rdquo; för att komma igång.
            </s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section heading="Visa leveransvalet i butiken">
        <s-paragraph>
          Leveransvalet visas i kassan/varukorgen via temats app-block
          &ldquo;Leveransdrawer&rdquo;. Lägg till blocket i temaredigeraren där du
          vill att kunden ska välja leverans. Alternativen hämtas automatiskt från
          den här appens data utifrån kundens postnummer.
        </s-paragraph>
      </s-section>

      <s-section heading="Hantera data">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Mata in leveransfönster via API-nyckel eller CSV-uppladdning.
          </s-paragraph>
          <s-link href="/app/delivery-data">Gå till Leveransdata</s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
