const SWEDISH_DAYS = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];
const SWEDISH_MONTHS = [
  "januari", "februari", "mars", "april", "maj", "juni",
  "juli", "augusti", "september", "oktober", "november", "december",
];

function formatSwedishDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayName = SWEDISH_DAYS[date.getDay()];
  const monthName = SWEDISH_MONTHS[month - 1];
  return `${dayName} ${day} ${monthName}`;
}

function normalizeZip(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 5);
}

// Butiken har två manuella fraktalternativ. Vi matchar på deras titel (gemener,
// trimmad) och behandlar dem olika: hemleverans är postnummer-låst, upphämtning
// är fritt (kunden får leverera till valfri adress).
const HOME_DELIVERY_TITLE = "gröna gårdar hemleverans";
const PICKUP_TITLE = "gröna gårdar upphämtning";
const PICKUP_METHOD = "Utlämningsställe";

export function run(input) {
  const deliveryDate = input.cart?.deliveryDate?.value;
  const deliveryMethod = input.cart?.deliveryMethod?.value;
  const locationName = input.cart?.locationName?.value;
  const selectedPostcode = normalizeZip(input.cart?.selectedPostcode?.value);
  const customerChosePickup = deliveryMethod === PICKUP_METHOD;

  // Inget leveransval gjort i butiken (vanligt när kunden navigerat direkt till
  // /checkout). Då döljer vi BÅDA Gröna Gårdar-alternativen så kunden inte kan
  // välja frakt utan att först ha valt postnummer + leverans i drawern.
  const hasSelection = Boolean(selectedPostcode && deliveryMethod);

  const operations = [];

  for (const group of (input.cart?.deliveryGroups || [])) {
    const addressZip = normalizeZip(group.deliveryAddress?.zip);

    for (const option of (group.deliveryOptions || [])) {
      const title = (option.title || "").trim().toLowerCase();
      const isHomeDelivery = title === HOME_DELIVERY_TITLE;
      const isPickup = title === PICKUP_TITLE;

      // Rör bara våra två alternativ.
      if (!isHomeDelivery && !isPickup) {
        continue;
      }

      // Inget val gjort → dölj båda.
      if (!hasSelection) {
        operations.push({ hide: { deliveryOptionHandle: option.handle } });
        continue;
      }

      // Visa bara det alternativ som matchar kundens val i drawern. Det andra
      // döljs så kunden inte av misstag byter leveranssätt i kassan.
      if (isPickup !== customerChosePickup) {
        operations.push({ hide: { deliveryOptionHandle: option.handle } });
        continue;
      }

      // Hemleverans är bunden till kundens adress: dölj om checkout-adressens
      // postnummer skiljer sig från det valda. Upphämtning har ingen sådan koll.
      if (
        isHomeDelivery &&
        selectedPostcode &&
        addressZip &&
        selectedPostcode !== addressZip
      ) {
        operations.push({ hide: { deliveryOptionHandle: option.handle } });
        continue;
      }

      // Döp om till leveransställe + datum.
      if (!deliveryDate) {
        continue;
      }
      const formattedDate = formatSwedishDate(deliveryDate);
      let newTitle;
      if (isPickup) {
        newTitle = locationName
          ? `Upphämtning ${locationName} – ${formattedDate}`
          : `Upphämtning – ${formattedDate}`;
      } else {
        newTitle = locationName
          ? `${locationName} – ${formattedDate}`
          : `Hemleverans – ${formattedDate}`;
      }

      operations.push({
        rename: { deliveryOptionHandle: option.handle, title: newTitle },
      });
    }
  }

  return { operations };
}

export default run;
