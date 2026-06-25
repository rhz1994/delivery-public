import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  generateApiKey,
  getApiCredentialInfo,
  revokeApiKey,
} from "../api-credentials.server";
import { importDeliveryWindowsCsv } from "../delivery-import.server";

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const credential = await getApiCredentialInfo(session.shop);
  return {
    appUrl: process.env.SHOPIFY_APP_URL || "",
    credential: credential
      ? {
          label: credential.label,
          createdAt: credential.createdAt.toISOString(),
          lastUsedAt: credential.lastUsedAt
            ? credential.lastUsedAt.toISOString()
            : null,
        }
      : null,
  };
};

type ActionResult =
  | { intent: "generate-key"; ok: true; key: string }
  | { intent: "revoke-key"; ok: true }
  | { intent: "import-csv"; ok: true; deleted: number; created: number }
  | { intent: string; ok: false; error: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "generate-key") {
    const label = (formData.get("label") as string | null)?.trim() || null;
    const key = await generateApiKey(shop, label);
    return { intent, ok: true, key } satisfies ActionResult;
  }

  if (intent === "revoke-key") {
    await revokeApiKey(shop);
    return { intent, ok: true } satisfies ActionResult;
  }

  if (intent === "import-csv") {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { intent, ok: false, error: "Välj en CSV-fil att ladda upp." } satisfies ActionResult;
    }
    if (file.size > MAX_CSV_BYTES) {
      return { intent, ok: false, error: "Filen är för stor (max 10 MB)." } satisfies ActionResult;
    }
    const csv = await file.text();
    const result = await importDeliveryWindowsCsv(shop, csv);
    if (!result.ok) {
      return {
        intent,
        ok: false,
        error: result.errors.join(" • "),
      } satisfies ActionResult;
    }
    return {
      intent,
      ok: true,
      deleted: result.deleted,
      created: result.created,
    } satisfies ActionResult;
  }

  return { intent, ok: false, error: "Okänd åtgärd." } satisfies ActionResult;
};

export default function DeliveryData() {
  const { appUrl, credential } = useLoaderData<typeof loader>();
  const keyFetcher = useFetcher<ActionResult>();
  const csvFetcher = useFetcher<ActionResult>();

  const keyResult = keyFetcher.data;
  const newKey =
    keyResult?.ok && keyResult.intent === "generate-key" ? keyResult.key : null;

  const csvResult = csvFetcher.data;
  const endpoint = appUrl ? `${appUrl}/api/delivery-windows` : "/api/delivery-windows";

  return (
    <s-page heading="Leveransdata">
      <s-section heading="API-nyckel">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Använd en API-nyckel för att låta ditt system mata in leveransfönster
            automatiskt via <s-text type="strong">POST {endpoint}</s-text>.
            Nyckeln visas bara en gång — spara den säkert.
          </s-paragraph>

          {credential ? (
            <s-paragraph>
              Aktiv nyckel{credential.label ? ` (${credential.label})` : ""},
              skapad {new Date(credential.createdAt).toLocaleString("sv-SE")}.
              {credential.lastUsedAt
                ? ` Senast använd ${new Date(credential.lastUsedAt).toLocaleString("sv-SE")}.`
                : " Ännu inte använd."}
            </s-paragraph>
          ) : (
            <s-paragraph>Ingen nyckel genererad ännu.</s-paragraph>
          )}

          {newKey ? (
            <s-banner tone="success">
              <s-stack direction="block" gap="small">
                <s-paragraph>
                  Ny nyckel skapad. Kopiera den nu — den visas inte igen.
                </s-paragraph>
                <s-text type="strong">{newKey}</s-text>
              </s-stack>
            </s-banner>
          ) : null}

          {keyResult && !keyResult.ok ? (
            <s-banner tone="critical">
              <s-paragraph>{keyResult.error}</s-paragraph>
            </s-banner>
          ) : null}

          <keyFetcher.Form method="post">
            <input type="hidden" name="intent" value="generate-key" />
            <s-stack direction="inline" gap="base">
              <s-text-field name="label" label="Etikett (valfritt)" />
              <s-button type="submit" loading={keyFetcher.state !== "idle"}>
                {credential ? "Generera ny (ersätter gammal)" : "Generera nyckel"}
              </s-button>
            </s-stack>
          </keyFetcher.Form>

          {credential ? (
            <keyFetcher.Form method="post">
              <input type="hidden" name="intent" value="revoke-key" />
              <s-button type="submit" tone="critical" variant="secondary">
                Återkalla nyckel
              </s-button>
            </keyFetcher.Form>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Ladda upp CSV">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Ladda upp en CSV med kolumnerna:{" "}
            <s-text type="strong">
              delivery_date, pack_date, home_delivery, delivery_location_id,
              stop_date, zipcode, delivery_location_name
            </s-text>
            . Importen ersätter alla kommande leveransfönster (från och med idag).
          </s-paragraph>

          {csvResult?.ok && csvResult.intent === "import-csv" ? (
            <s-banner tone="success">
              <s-paragraph>
                Import klar: {csvResult.created} rader skapade,{" "}
                {csvResult.deleted} gamla borttagna.
              </s-paragraph>
            </s-banner>
          ) : null}

          {csvResult && !csvResult.ok ? (
            <s-banner tone="critical">
              <s-paragraph>{csvResult.error}</s-paragraph>
            </s-banner>
          ) : null}

          <csvFetcher.Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="import-csv" />
            <s-stack direction="block" gap="base">
              <input type="file" name="file" accept=".csv,text/csv" />
              <s-button type="submit" loading={csvFetcher.state !== "idle"}>
                {csvFetcher.state !== "idle" ? "Importerar…" : "Ladda upp och importera"}
              </s-button>
            </s-stack>
          </csvFetcher.Form>
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
