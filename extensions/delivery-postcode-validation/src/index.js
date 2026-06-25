function normalizePostcode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function formatPostcode(value) {
  return value.length === 5 ? `${value.slice(0, 3)} ${value.slice(3)}` : value;
}

// Pickup-leveranser hämtas på ett utlämningsställe och är inte bundna till
// kundens adress. Då ska postnummer-jämförelsen mot adressfältet hoppas över.
const PICKUP_METHOD = "Utlämningsställe";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function run(input) {
  const selectedPostcode = normalizePostcode(input.cart?.selectedPostcode?.value);
  const isPickup = input.cart?.deliveryMethod?.value === PICKUP_METHOD;
  const isCompletion = input.buyerJourney?.step === "CHECKOUT_COMPLETION";
  const errors = [];

  if (!selectedPostcode) {
    if (isCompletion) {
      errors.push({
        message: "Välj postnummer och leverans innan du slutför köpet.",
        target: "$.cart",
      });
    }

    return errors.length ? { operations: [{ validationAdd: { errors } }] } : { operations: [] };
  }

  // Sista beställningsdagen för det sparade valet får inte ha passerat.
  // Jämförs mot butikens lokala datum; YYYY-MM-DD strängjämförs kronologiskt.
  // Blockerar bara vid slutförande så kunden hinner välja om i butiken.
  const stopDate = String(input.cart?.stopDate?.value || "");
  const today = input.shop?.localTime?.date || "";
  if (isCompletion && DATE_PATTERN.test(stopDate) && stopDate < today) {
    return {
      operations: [
        {
          validationAdd: {
            errors: [
              {
                message:
                  "Beställningstiden för din valda leverans har passerat. Gå tillbaka och välj en ny leveranstid.",
                target: "$.cart",
              },
            ],
          },
        },
      ],
    };
  }

  // Vid utlämningsställe: kravet att ett val gjorts finns kvar (ovan), men
  // adressens postnummer får skilja sig från det valda — ingen pnr-koll.
  if (isPickup) {
    return { operations: [] };
  }

  for (const [index, deliveryGroup] of (input.cart?.deliveryGroups || []).entries()) {
    const checkoutPostcode = normalizePostcode(deliveryGroup?.deliveryAddress?.zip);

    if (!checkoutPostcode || checkoutPostcode === selectedPostcode) {
      continue;
    }

    errors.push({
      message: `Ange samma postnummer som du valde i leveranssteget: ${formatPostcode(selectedPostcode)}.`,
      target: `$.cart.deliveryGroups[${index}].deliveryAddress.zip`,
    });
  }

  return errors.length ? { operations: [{ validationAdd: { errors } }] } : { operations: [] };
}

export default run;
