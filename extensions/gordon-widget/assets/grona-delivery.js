(() => {
  const SELECTOR = "[data-grona-delivery]";
  const SWEDISH_MONTHS = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december",
  ];

  // Cart-attribut. _-prefix = dolt för kund i kassan, men läsbart i admin/API
  // (där Thea hämtar delivery_location_id med ordern).
  const ATTR = {
    zipcode: "Postnummer",
    method: "Leveranssätt",
    locationName: "Leveransställe",
    date: "Leveransdatum",
    locationId: "_delivery_location_id",
    stopDate: "_stop_date", // sista beställningsdag (YYYY-MM-DD), dolt för kund
  };

  const METHOD = { home: "Hemleverans", pickup: "Utlämningsställe" };

  // Ett val räknas som komplett bara om alla fyra delarna finns. Samma villkor
  // styr både checkout-spärren och om drawern tvingas fram.
  function isCompleteSelection(cart) {
    const attributes = cart?.attributes || {};
    return Boolean(
      normalizeZipcode(attributes[ATTR.zipcode]) &&
      attributes[ATTR.method] &&
      attributes[ATTR.date] &&
      attributes[ATTR.locationId],
    );
  }

  function normalizeZipcode(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 5);
  }

  // "Idag" i svensk tid som YYYY-MM-DD — samma gräns som servern använder för
  // att gömma alternativ vars beställningsstopp passerat.
  function stockholmTodayKey() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Stockholm",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  // Ett sparat val är utgånget när sista beställningsdagen (stopDate) passerat.
  // Strängjämförelse på YYYY-MM-DD är lexikografiskt = kronologiskt korrekt.
  function selectionIsExpired(attributes) {
    const stopDate = String(attributes?.[ATTR.stopDate] || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stopDate)) return false;
    return stopDate < stockholmTodayKey();
  }

  function formatZipcode(value) {
    const zipcode = normalizeZipcode(value);
    return zipcode.length > 3 ? `${zipcode.slice(0, 3)} ${zipcode.slice(3)}` : zipcode;
  }

  function parseDate(value) {
    if (!value) return null;
    // ISO-datum "YYYY-MM-DD" tolkas som lokal middag för att undvika tidszons-skift.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(value) {
    const date = value instanceof Date ? value : parseDate(value);
    if (!date) return "";
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  function weekNumber(date) {
    const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil(((target - yearStart) / 86_400_000 + 1) / 7);
  }

  function longDate(date) {
    return new Intl.DateTimeFormat("sv-SE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  async function parseProxyResponse(response, fallbackMessage) {
    const text = await response.text();
    try {
      return JSON.parse(text.trim());
    } catch {
      console.error("Unexpected app proxy response:", text);
      throw new Error(fallbackMessage);
    }
  }

  function initialize(root) {
    if (root.dataset.initialized === "true") return;
    root.dataset.initialized = "true";

    const $ = (selector) => root.querySelector(selector);
    const $$ = (selector) => Array.from(root.querySelectorAll(selector));
    const drawer = $("[data-gg-drawer]");
    const backdrop = $("[data-gg-backdrop]");
    const zipcodeInput = $("[data-gg-zipcode]");
    const zipcodeSubmit = $("[data-gg-zipcode-submit]");
    const confirmButton = $("[data-gg-confirm]");
    const status = $("[data-gg-status]");
    const dateStatus = $("[data-gg-date-status]");
    const locationStatus = $("[data-gg-location-status]");
    const dateFlow = $("[data-gg-date-flow]");
    const calendar = $("[data-gg-calendar]");
    const dateCard = $("[data-gg-date-card]");
    const locationFlow = $("[data-gg-location-flow]");
    const calendarDays = $("[data-gg-calendar-days]");
    const calendarTitle = $("[data-gg-calendar-title]");
    const locationList = $("[data-gg-location-list]");

    const state = {
      step: 1,
      zipcode: "",
      method: METHOD.home,
      // Alla alternativ för aktuellt postnummer, uppdelat per flik.
      options: { [METHOD.home]: [], [METHOD.pickup]: [] },
      selectedDate: "",
      selectedOption: null, // den valda raden (med deliveryLocationId)
      calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      lastFocused: null,
      submitting: false,
    };

    // Alternativen för aktuell flik.
    function currentOptions() {
      return state.options[state.method] || [];
    }

    function setStatus(element, message = "", type = "") {
      if (!element) return;
      element.textContent = message;
      element.dataset.state = type;
    }

    function showStep(step) {
      state.step = step;
      $$("[data-gg-step]").forEach((element) => {
        element.hidden = Number(element.dataset.ggStep) !== step;
      });
      $$("[data-gg-progress]").forEach((element) => {
        const number = Number(element.dataset.ggProgress);
        element.classList.toggle("is-active", number <= Math.min(step, 4));
      });
      drawer.scrollTo({ top: 0, behavior: "smooth" });
      const heading = $(`[data-gg-step="${step}"] h3`);
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
    }

    function openDrawer(forceStart = false) {
      state.lastFocused = document.activeElement;
      drawer.hidden = false;
      backdrop.hidden = false;
      document.documentElement.classList.add("gg-delivery-open");
      if (forceStart) showStep(1);
      window.setTimeout(() => drawer.classList.add("is-open"), 10);
    }

    function closeDrawer() {
      drawer.classList.remove("is-open");
      document.documentElement.classList.remove("gg-delivery-open");
      window.setTimeout(() => {
        drawer.hidden = true;
        backdrop.hidden = true;
      }, 250);
      state.lastFocused?.focus?.();
    }

    // Close the theme's own cart drawer so ours fully takes over (instead of
    // showing both). Clicking the theme close button runs its own cleanup;
    // fall back to removing the open classes directly if it isn't found.
    function closeThemeCart() {
      const closeBtn = document.querySelector("[data-wld-cart-close]");
      if (closeBtn) {
        closeBtn.click();
        return;
      }
      document.querySelectorAll(".cart-panel.open, .cart-backdrop.open").forEach(
        (element) => {
          element.classList.remove("open");
          element.setAttribute("aria-hidden", "true");
        },
      );
      document.documentElement.classList.remove("wld-cart-open");
    }

    async function getCart() {
      const response = await fetch(root.dataset.cartUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Kunde inte läsa varukorgen.");
      return response.json();
    }

    function cartDateLabel(value) {
      const date = parseDate(value);
      if (!date) return "";
      const weekday = new Intl.DateTimeFormat("sv-SE", {
        weekday: "long",
      }).format(date);
      return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${date.getDate()}/${date.getMonth() + 1}`;
    }

    function renderCartDeliverySummary(cart) {
      const panel = document.querySelector(".cart-panel");
      const current = panel?.querySelector("[data-gg-cart-summary]");
      const attributes = cart?.attributes || {};
      const zipcode = normalizeZipcode(attributes[ATTR.zipcode]);
      const method = attributes[ATTR.method];
      const locationName = attributes[ATTR.locationName];
      const deliveryDate = attributes[ATTR.date];

      if (!panel || !zipcode || !method) {
        current?.remove();
        return;
      }

      const summary = document.createElement("div");
      summary.className = "gg-cart-delivery";
      summary.dataset.ggCartSummary = "";

      const row = document.createElement("div");
      row.className = "gg-cart-delivery__row";

      const text = document.createElement("div");
      text.className = "gg-cart-delivery__text";

      const eyebrow = document.createElement("span");
      eyebrow.className = "gg-cart-delivery__eyebrow";
      eyebrow.textContent = "Din leverans";

      const title = document.createElement("p");
      title.className = "gg-cart-delivery__title";
      const methodName = document.createElement("strong");
      methodName.textContent = locationName || method;
      title.append(methodName, ` · ${zipcode}`);

      text.append(eyebrow, title);

      const dateText = cartDateLabel(deliveryDate);
      if (dateText) {
        const details = document.createElement("p");
        details.className = "gg-cart-delivery__details";
        details.textContent = dateText;
        text.append(details);
      }

      const changeButton = document.createElement("button");
      changeButton.className = "gg-cart-delivery__change";
      changeButton.type = "button";
      changeButton.textContent = "Byt";
      changeButton.addEventListener("click", () => {
        restoreFromCart(cart);
        closeThemeCart();
        openDrawer(true);
      });

      row.append(text, changeButton);
      summary.append(row);

      if (current) {
        current.replaceWith(summary);
      } else {
        // Place it at the very top of the cart panel, above the shipping bar
        // and the "Varukorg" header.
        panel.insertAdjacentElement("afterbegin", summary);
      }
    }

    let cartSummaryTimer;
    function refreshCartDeliverySummary() {
      window.clearTimeout(cartSummaryTimer);
      cartSummaryTimer = window.setTimeout(() => {
        getCart()
          .then((cart) => {
            renderCartDeliverySummary(cart);
            guardCheckout(cart);
          })
          .catch(() => {});
      }, 120);
    }

    // Hindrar att kunden tar sig till kassan utan komplett leveransval.
    //
    // Begränsning: ren JavaScript kan ALDRIG stoppa direkt-navigering till
    // /checkout (adressfält, bokmärke) eller köp via Shop Pay-iframe — de
    // sidorna körs utanför temat. Det kräver en checkout-validering server-side
    // (Shopify Plus) eller en checkout UI-extension som varnar. Här täcker vi
    // alla vägar som GÅR att fånga i butiken:
    //   - "Till kassan"-knappar och -länkar (i drawer, på /cart, var som helst)
    //   - dynamiska/express-checkout-knappar (döljs helt — de går ofta inte att
    //     klick-fånga eftersom de ligger i iframe)
    //   - formulär som postar mot /checkout
    //   - alla klick som leder till en /checkout-URL (global capture)

    // Vanliga "Till kassan"-knappar/länkar.
    const CHECKOUT_SELECTOR = [
      '[name="checkout"]',
      'button[value="checkout"]',
      'a[href*="/checkout"]',
      'a[href$="/checkout"]',
      'a[href*="/cart"][href*="checkout"]',
    ].join(", ");

    // Dynamiska/express-checkout (Shop Pay, PayPal, Google Pay m.m.). Dessa
    // döljer vi helt när val saknas i stället för att klick-fånga dem.
    const EXPRESS_SELECTOR = [
      "[data-shopify='dynamic-checkout-cart']",
      ".shopify-payment-button",
      ".additional-checkout-buttons",
      "shopify-accelerated-checkout",
      "shopify-accelerated-checkout-cart",
      "[data-shopify='payment-button']",
    ].join(", ");

    let selectionComplete = false;

    // Öppnar leveransväljaren i stället för att gå vidare till kassan.
    function divertToPicker() {
      getCart()
        .then((cart) => {
          restoreFromCart(cart);
          closeThemeCart();
          openDrawer(true);
        })
        .catch(() => openDrawer(true));
    }

    function blockCheckoutClick(event) {
      if (selectionComplete) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      divertToPicker();
    }

    function cartOpenTrigger(element) {
      if (!element) return false;
      const link = element.closest?.("a[href]");
      if (link) {
        const href = link.getAttribute("href") || "";
        if (/(^|\/)cart(\/?$|\?)/.test(href) && !/checkout/.test(href)) return link;
      }
      return element.closest?.(
        [
          "[data-wld-cart-open]",
          "[data-cart-open]",
          "[data-cart-toggle]",
          "[data-cart-drawer-open]",
          "[data-cart-drawer-toggle]",
          "[aria-controls='cart-drawer']",
          "[aria-controls='CartDrawer']",
          "[aria-controls='cart-panel']",
        ].join(", "),
      );
    }

    let allowNextCartOpen = false;

    function blockCartOpenClick(event) {
      if (selectionComplete || root.dataset.autoOpen !== "true") return;
      const trigger = cartOpenTrigger(event.target);
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      getCart()
        .then((cart) => {
          guardCheckout(cart);
          if (isCompleteSelection(cart) || !cart || cart.item_count === 0) {
            allowNextCartOpen = true;
            trigger.click?.();
            return;
          }
          restoreFromCart(cart);
          closeThemeCart();
          openDrawer(true);
        })
        .catch(() => openDrawer(true));
    }

    function applyCheckoutState(blocked) {
      document.querySelectorAll(CHECKOUT_SELECTOR).forEach((element) => {
        if (element.dataset.ggCheckoutGuard !== "true") {
          element.dataset.ggCheckoutGuard = "true";
          // Capture-fasen så vi hinner före temats egen klick-hantering.
          // OBS: knappen disablas INTE — då skulle inget klick nå oss och vi
          // kunde inte öppna väljaren. Vi fångar och stoppar klicket i stället.
          element.addEventListener("click", blockCheckoutClick, true);
        }
        element.classList.toggle("gg-checkout-blocked", blocked);
        element.setAttribute("aria-disabled", String(blocked));
      });

      // Express-knappar går inte alltid att klick-fånga (iframe) — göm dem helt
      // medan val saknas, och visa igen när valet är komplett.
      document.querySelectorAll(EXPRESS_SELECTOR).forEach((element) => {
        element.classList.toggle("gg-express-hidden", blocked);
      });
    }

    function guardCheckout(cart) {
      selectionComplete = isCompleteSelection(cart);
      applyCheckoutState(!selectionComplete);
    }

    // När temats varukorg öppnas utan komplett val: stäng den och tvinga fram
    // postnummerväljaren, så kunden inte kan bläddra förbi.
    let enforceTimer;
    function enforceSelectionOnCartOpen() {
      if (root.dataset.autoOpen !== "true") return;
      // Drawern är redan öppen — gör inget.
      if (!drawer.hidden) return;
      window.clearTimeout(enforceTimer);
      enforceTimer = window.setTimeout(() => {
        getCart()
          .then((cart) => {
            guardCheckout(cart);
            if (isCompleteSelection(cart)) return;
            // Tom varukorg ska inte tvinga fram något.
            if (!cart || cart.item_count === 0) return;
            restoreFromCart(cart);
            closeThemeCart();
            openDrawer(true);
          })
          .catch(() => {});
      }, 150);
    }

    async function saveSelection() {
      const option = state.selectedOption;
      const attributes = {
        [ATTR.zipcode]: state.zipcode,
        [ATTR.method]: state.method,
        [ATTR.locationName]: option?.deliveryLocationName || "",
        [ATTR.date]: state.selectedDate,
        [ATTR.locationId]: option ? String(option.deliveryLocationId) : "",
        [ATTR.stopDate]: option?.stopDate || "",
      };
      const response = await fetch(root.dataset.cartUpdateUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ attributes }),
      });
      if (!response.ok) throw new Error("Leveransvalet kunde inte sparas.");
      const cart = await response.json();
      renderCartDeliverySummary(cart);
      // Valet är nu komplett — lås upp kassan.
      guardCheckout(cart);

      const selectedDate = parseDate(state.selectedDate);
      $("[data-gg-success-summary]").textContent =
        `${option?.deliveryLocationName || state.method}. ${longDate(selectedDate)}.`;
    }

    // Tömmer leveransattributen på varukorgen (gör kunden till "ny kund" igen).
    // Returnerar den uppdaterade varukorgen, eller null vid fel.
    async function clearCartSelection() {
      const cleared = {
        [ATTR.zipcode]: "",
        [ATTR.method]: "",
        [ATTR.locationName]: "",
        [ATTR.date]: "",
        [ATTR.locationId]: "",
        [ATTR.stopDate]: "",
      };
      try {
        const response = await fetch(root.dataset.cartUpdateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ attributes: cleared }),
        });
        const cart = response.ok ? await response.json() : null;
        if (cart) {
          renderCartDeliverySummary(cart);
          guardCheckout(cart);
        }
        return cart;
      } catch {
        return null;
      }
    }

    // Lokal state tillbaka till start (postnummersteget).
    function resetLocalState() {
      state.zipcode = "";
      state.method = METHOD.home;
      state.selectedDate = "";
      state.selectedOption = null;
      state.options = { [METHOD.home]: [], [METHOD.pickup]: [] };
      zipcodeInput.value = "";
      zipcodeSubmit.disabled = true;
      setStatus(status);
      showStep(1);
    }

    // Dev/test: nollställer leveransvalet så det blir som en ny kund.
    async function resetSelection() {
      await clearCartSelection();
      resetLocalState();
    }
    // Nåbar från konsolen också: ggResetDelivery()
    window.ggResetDelivery = resetSelection;

    function restoreFromCart(cart) {
      const attributes = cart?.attributes || {};
      const zipcode = normalizeZipcode(attributes[ATTR.zipcode]);
      if (zipcode) {
        state.zipcode = zipcode;
        zipcodeInput.value = formatZipcode(zipcode);
        // A pre-filled zip should leave the submit button usable right away.
        zipcodeSubmit.disabled = zipcode.length !== 5;
      }
      state.method = attributes[ATTR.method] || METHOD.home;
      state.selectedDate = attributes[ATTR.date] || "";
      return isCompleteSelection(cart);
    }

    async function loadAvailability() {
      // data-endpoint sätts av blocket till app-proxy-subpathen (apps/delivery).
      const endpoint = String(root.dataset.endpoint || "");
      const url = new URL(endpoint, window.location.origin);
      url.searchParams.set("zipcode", state.zipcode);
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await parseProxyResponse(
        response,
        "Det gick inte att hämta leveransalternativ. Försök igen.",
      );
      if (!response.ok) throw new Error(data.error || "Leveransalternativ kunde inte hämtas.");

      const home = Array.isArray(data.homeDelivery) ? data.homeDelivery : [];
      const pickup = Array.isArray(data.pickup) ? data.pickup : [];
      if (!home.length && !pickup.length) {
        throw new Error("Vi har inga leveransalternativ för det postnumret just nu.");
      }
      state.options = { [METHOD.home]: home, [METHOD.pickup]: pickup };
      return data;
    }

    // Aktiverar/visar bara flikar som har alternativ, och väljer en med data.
    function renderTabs() {
      $("[data-gg-postcode-summary]").textContent =
        `Leveransalternativ för ${formatZipcode(state.zipcode)}`;

      const homeTab = $("[data-gg-delivery-tab]");
      const pickupTab = $("[data-gg-pickup-tab]");
      const hasHome = state.options[METHOD.home].length > 0;
      const hasPickup = state.options[METHOD.pickup].length > 0;

      homeTab.hidden = !hasHome;
      if (pickupTab) pickupTab.hidden = !hasPickup;

      // Förvald flik: hemleverans om den finns, annars utlämningsställe.
      state.method = hasHome ? METHOD.home : METHOD.pickup;
      setActiveTab(state.method);
    }

    function setActiveTab(method) {
      state.method = method;
      const homeTab = $("[data-gg-delivery-tab]");
      const pickupTab = $("[data-gg-pickup-tab]");
      homeTab.classList.toggle("is-active", method === METHOD.home);
      homeTab.setAttribute("aria-selected", String(method === METHOD.home));
      if (pickupTab) {
        pickupTab.classList.toggle("is-active", method === METHOD.pickup);
        pickupTab.setAttribute("aria-selected", String(method === METHOD.pickup));
      }
      if (method === METHOD.pickup) {
        revealPickupFlow();
      } else {
        revealHomeFlow();
      }
    }

    // De datum som har minst ett alternativ i aktuell flik.
    function availableDateSet() {
      return new Set(currentOptions().map((option) => option.deliveryDate));
    }

    function renderCalendar() {
      const year = state.calendarMonth.getFullYear();
      const month = state.calendarMonth.getMonth();
      calendarTitle.textContent = `${SWEDISH_MONTHS[month]} ${year}`;
      calendarDays.replaceChildren();
      const available = availableDateSet();
      const first = new Date(year, month, 1);
      const leading = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      for (let index = 0; index < leading; index += 1) {
        const spacer = document.createElement("span");
        spacer.className = "gg-delivery__day-spacer";
        calendarDays.append(spacer);
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day, 12);
        const key = dateKey(date);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = String(day);
        button.dataset.date = key;
        button.disabled = !available.has(key);
        button.classList.toggle("is-selected", state.selectedDate === key);
        button.setAttribute("aria-label", longDate(date));
        button.addEventListener("click", () => selectDate(key));
        calendarDays.append(button);
      }
    }

    const editDateButton = $("[data-gg-edit-date]");

    function openCalendar() {
      // Mitt uppe i ett datumval: kalendern är öppen, kortet och "Ändra" göms.
      calendar.hidden = false;
      dateCard.hidden = true;
      editDateButton.hidden = true;
      locationFlow.hidden = true;
      setStatus(locationStatus);
      renderCalendar();
    }

    function selectDate(key) {
      const date = parseDate(key);
      state.selectedDate = key;
      state.selectedOption = null;
      confirmButton.disabled = true;
      $("[data-gg-selected-date]").textContent = longDate(date);
      $("[data-gg-selected-week]").textContent = `Vecka ${weekNumber(date)}`;
      calendar.hidden = true;
      dateCard.hidden = false;
      // Först nu, när en dag är vald, går det att ändra igen.
      editDateButton.hidden = false;
      locationFlow.hidden = false;
      setStatus(dateStatus);
      renderLocations();
      window.setTimeout(() => {
        locationFlow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 50);
    }

    function revealHomeFlow() {
      const dates = Array.from(availableDateSet()).sort();
      dateFlow.hidden = false;
      state.selectedDate = "";
      state.selectedOption = null;
      confirmButton.disabled = true;
      dateCard.hidden = true;
      editDateButton.hidden = true;
      locationFlow.hidden = true;
      $("[data-gg-date-flow] .gg-delivery__flow-heading h3").textContent = "Välj dag";
      $("[data-gg-date-flow] .gg-delivery__flow-heading p").textContent =
        "Endast tillgängliga leveransdagar går att välja.";
      $("[data-gg-location-flow] .gg-delivery__flow-heading h3").textContent =
        "Välj leveransställe";
      $("[data-gg-location-flow] .gg-delivery__flow-heading p").textContent =
        "Tid bekräftas via SMS före leverans.";
      $("[data-gg-location-flow] .gg-delivery__flow-heading").hidden = false;

      if (!dates.length) {
        calendar.hidden = true;
        setStatus(dateStatus, "Inga leveransdagar för det här alternativet.", "error");
        return;
      }

      const date = parseDate(dates[0]);
      state.calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      setStatus(dateStatus);
      openCalendar();
      window.setTimeout(() => {
        dateFlow.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }

    function groupedPickupOptions() {
      const groups = new Map();
      currentOptions()
        .slice()
        .sort((a, b) =>
          a.deliveryLocationName.localeCompare(b.deliveryLocationName, "sv") ||
          a.deliveryDate.localeCompare(b.deliveryDate),
        )
        .forEach((option) => {
          const key = String(option.deliveryLocationId);
          if (!groups.has(key)) {
            groups.set(key, {
              deliveryLocationId: option.deliveryLocationId,
              deliveryLocationName: option.deliveryLocationName,
              options: [],
            });
          }
          groups.get(key).options.push(option);
        });
      return Array.from(groups.values());
    }

    function selectPickupOption(option, input) {
      state.selectedDate = option.deliveryDate;
      state.selectedOption = option;
      if (input) input.checked = true;
      // Markera bara det aktiva stället med grön bock.
      $$("[data-gg-location-list] .gg-delivery__pickup-place").forEach((el) => {
        el.classList.toggle("is-selected", el.contains(input));
      });
      confirmButton.disabled = false;
      setStatus(locationStatus, "Utlämningsstället är valt.", "success");
    }

    // Antal utlämningsställen som visas direkt; resten göms bakom "Fler alternativ".
    const PICKUP_VISIBLE = 3;

    // Bygger en utlämningsställe-rad (accordion). Vald rad fälls ut och visar
    // sina datum som radioknappar inuti, precis som på gamla siten.
    function buildPickupPlace(group, onExpand) {
      const place = document.createElement("div");
      place.className = "gg-delivery__pickup-place";

      const header = document.createElement("button");
      header.type = "button";
      header.className = "gg-delivery__pickup-head";
      header.setAttribute("aria-expanded", "false");

      const mark = document.createElement("span");
      mark.className = "gg-delivery__pickup-mark";

      const name = document.createElement("strong");
      name.className = "gg-delivery__pickup-name";
      name.textContent = group.deliveryLocationName;

      header.append(mark, name);

      const dates = document.createElement("div");
      dates.className = "gg-delivery__pickup-options";
      dates.hidden = true;

      group.options.forEach((option) => {
        const row = document.createElement("label");
        row.className = "gg-delivery__pickup-date";

        const input = document.createElement("input");
        input.type = "radio";
        input.name = "gg-delivery-location";
        input.value = `${group.deliveryLocationId}|${option.deliveryDate}`;

        const radio = document.createElement("span");
        radio.className = "gg-delivery__radio";

        const text = document.createElement("span");
        text.className = "gg-delivery__pickup-date-text";
        const day = document.createElement("span");
        day.textContent = cartDateLabel(option.deliveryDate);
        const stop = document.createElement("small");
        stop.textContent = `Beställ senast ${cartDateLabel(option.stopDate)}`;
        text.append(day, stop);

        row.append(input, radio, text);
        input.addEventListener("change", () => {
          selectPickupOption(option, input);
        });
        dates.append(row);
      });

      function expand() {
        // Fäll ihop alla andra ställen först.
        $$("[data-gg-location-list] .gg-delivery__pickup-place").forEach((el) => {
          el.classList.remove("is-open");
          el.querySelector(".gg-delivery__pickup-head")
            ?.setAttribute("aria-expanded", "false");
          const d = el.querySelector(".gg-delivery__pickup-options");
          if (d) d.hidden = true;
        });
        place.classList.add("is-open");
        header.setAttribute("aria-expanded", "true");
        dates.hidden = false;
        // Bara ett datum? Förvälj det direkt.
        if (group.options.length === 1) {
          const only = dates.querySelector("input");
          if (only && !only.checked) {
            only.checked = true;
            selectPickupOption(group.options[0], only);
          }
        }
        onExpand?.();
      }

      header.addEventListener("click", () => {
        if (place.classList.contains("is-open")) return;
        expand();
      });

      place.append(header, dates);
      return { place, expand };
    }

    function renderPickupLocations() {
      locationList.replaceChildren();
      const groups = groupedPickupOptions();

      if (!groups.length) {
        setStatus(locationStatus, "Inga utlämningsställen finns just nu.", "error");
        return;
      }

      const visible = groups.slice(0, PICKUP_VISIBLE);
      const rest = groups.slice(PICKUP_VISIBLE);

      visible.forEach((group, index) => {
        const { place, expand } = buildPickupPlace(group);
        locationList.append(place);
        if (index === 0) expand();
      });

      if (rest.length) {
        const moreWrap = document.createElement("div");
        moreWrap.className = "gg-delivery__pickup-more";
        moreWrap.hidden = true;

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "gg-delivery__pickup-more-toggle";
        toggle.setAttribute("aria-expanded", "false");

        const plus = document.createElement("span");
        plus.className = "gg-delivery__pickup-more-icon";
        plus.textContent = "+";
        const moreLabel = document.createElement("span");
        moreLabel.textContent = `Fler alternativ (${rest.length})`;
        const chevron = document.createElement("span");
        chevron.className = "gg-delivery__pickup-more-chevron";
        chevron.textContent = "⌄";
        toggle.append(plus, moreLabel, chevron);

        rest.forEach((group) => {
          const { place } = buildPickupPlace(group);
          moreWrap.append(place);
        });

        toggle.addEventListener("click", () => {
          const open = moreWrap.hidden;
          moreWrap.hidden = !open;
          toggle.setAttribute("aria-expanded", String(open));
          toggle.classList.toggle("is-open", open);
        });

        locationList.append(toggle, moreWrap);
      }
    }

    function revealPickupFlow() {
      dateFlow.hidden = false;
      calendar.hidden = true;
      dateCard.hidden = true;
      editDateButton.hidden = true;
      locationFlow.hidden = false;
      state.selectedDate = "";
      state.selectedOption = null;
      confirmButton.disabled = true;
      setStatus(dateStatus);
      setStatus(locationStatus);
      $("[data-gg-date-flow] .gg-delivery__flow-heading h3").textContent =
        "Välj utlämningsställe";
      $("[data-gg-date-flow] .gg-delivery__flow-heading p").textContent =
        "Välj ett utlämningsställe och en tillgänglig hämtdag.";
      $("[data-gg-location-flow] .gg-delivery__flow-heading h3").textContent =
        "Utlämningsställe";
      $("[data-gg-location-flow] .gg-delivery__flow-heading p").textContent =
        "Välj plats och kontrollera hämtdag.";
      $("[data-gg-location-flow] .gg-delivery__flow-heading").hidden = true;
      renderPickupLocations();
      window.setTimeout(() => {
        dateFlow.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }

    // Leveransställen tillgängliga på det valda datumet (i aktuell flik).
    function renderLocations() {
      const selectedDate = parseDate(state.selectedDate);
      $("[data-gg-selected-date]").textContent = longDate(selectedDate);
      $("[data-gg-selected-week]").textContent = `Vecka ${weekNumber(selectedDate)}`;
      locationList.replaceChildren();
      const options = currentOptions().filter(
        (option) => option.deliveryDate === state.selectedDate,
      );

      options.forEach((option, index) => {
        const label = document.createElement("label");
        label.className = "gg-delivery__location";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "gg-delivery-location";
        input.value = String(option.deliveryLocationId);
        const icon = document.createElement("span");
        icon.className = "gg-delivery__location-icon";
        icon.textContent = "▣";
        const copy = document.createElement("span");
        copy.className = "gg-delivery__location-copy";
        const title = document.createElement("strong");
        title.textContent = option.deliveryLocationName;
        const detail = document.createElement("small");
        const stop = parseDate(option.stopDate);
        detail.textContent = stop ? `Beställ senast ${cartDateLabel(option.stopDate)}` : "";
        const radio = document.createElement("span");
        radio.className = "gg-delivery__radio";
        copy.append(title, detail);
        label.append(input, icon, copy, radio);
        input.addEventListener("change", () => {
          state.selectedOption = option;
          confirmButton.disabled = false;
          setStatus(locationStatus, "Leveransstället är valt.", "success");
        });
        // Förvälj om det bara finns ett alternativ.
        if (options.length === 1 && index === 0) {
          input.checked = true;
          state.selectedOption = option;
          confirmButton.disabled = false;
        }
        locationList.append(label);
      });

      if (!options.length) {
        setStatus(locationStatus, "Inga leveransställen finns för den valda dagen.", "error");
      }
    }

    function trapFocus(event) {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || drawer.hidden) return;
      const focusable = Array.from(
        drawer.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.closest("[hidden]"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    $("[data-gg-close]").addEventListener("click", closeDrawer);
    $("[data-gg-finish]").addEventListener("click", closeDrawer);
    // Dev-knapp: bara aktiv när blocket körs i utvecklingsläge (data-dev="true").
    $("[data-gg-reset]")?.addEventListener("click", resetSelection);
    backdrop.addEventListener("click", closeDrawer);
    drawer.addEventListener("keydown", trapFocus);
    $$("[data-gg-back]").forEach((button) => {
      button.addEventListener("click", () => showStep(Number(button.dataset.ggBack)));
    });

    zipcodeInput.addEventListener("input", () => {
      zipcodeInput.value = formatZipcode(zipcodeInput.value);
      zipcodeSubmit.disabled = normalizeZipcode(zipcodeInput.value).length !== 5;
      setStatus(status);
    });
    zipcodeSubmit.disabled = true;

    $("[data-gg-zipcode-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      state.zipcode = normalizeZipcode(zipcodeInput.value);
      if (state.zipcode.length !== 5 || state.submitting) return;
      state.submitting = true;
      zipcodeSubmit.disabled = true;
      setStatus(status, "Kontrollerar leveransalternativ...");
      try {
        await loadAvailability();
        renderTabs();
        showStep(2);
      } catch (error) {
        setStatus(status, error.message || "Något gick fel.", "error");
      } finally {
        state.submitting = false;
        zipcodeSubmit.disabled = false;
      }
    });

    $("[data-gg-delivery-tab]").addEventListener("click", () => setActiveTab(METHOD.home));
    $("[data-gg-pickup-tab]")?.addEventListener("click", () => setActiveTab(METHOD.pickup));

    $("[data-gg-prev-month]").addEventListener("click", () => {
      state.calendarMonth = new Date(
        state.calendarMonth.getFullYear(),
        state.calendarMonth.getMonth() - 1,
        1,
      );
      renderCalendar();
    });
    $("[data-gg-next-month]").addEventListener("click", () => {
      state.calendarMonth = new Date(
        state.calendarMonth.getFullYear(),
        state.calendarMonth.getMonth() + 1,
        1,
      );
      renderCalendar();
    });

    $("[data-gg-edit-date]").addEventListener("click", openCalendar);

    confirmButton.addEventListener("click", async () => {
      if (!state.selectedOption || state.submitting) return;
      state.submitting = true;
      confirmButton.disabled = true;
      setStatus(locationStatus, "Sparar ditt leveransval...");
      try {
        await saveSelection();
        showStep(5);
      } catch (error) {
        setStatus(locationStatus, error.message || "Leveransvalet kunde inte sparas.", "error");
        confirmButton.disabled = false;
      } finally {
        state.submitting = false;
      }
    });

    // Globala säkerhetsnät: fånga ALLA vägar till /checkout som går via klick
    // eller formulär på sajten, även element vi inte hann tagga i
    // applyCheckoutState (dynamiskt renderade knappar, /cart-sidan, osv).
    // Capture-fasen + stopImmediatePropagation så vi hinner före temats kod.
    function leadsToCheckout(element) {
      if (!element) return false;
      const link = element.closest?.("a[href]");
      if (link) {
        const href = link.getAttribute("href") || "";
        if (/(^|\/)checkout(\/|$|\?)/.test(href)) return true;
      }
      const trigger = element.closest?.(
        '[name="checkout"], button[value="checkout"], ' + EXPRESS_SELECTOR,
      );
      return Boolean(trigger);
    }

    document.addEventListener(
      "click",
      (event) => {
        if (allowNextCartOpen) {
          allowNextCartOpen = false;
          return;
        }
        if (selectionComplete) return;
        if (leadsToCheckout(event.target)) blockCheckoutClick(event);
        else if (cartOpenTrigger(event.target)) blockCartOpenClick(event);
      },
      true,
    );

    document.addEventListener(
      "submit",
      (event) => {
        if (selectionComplete) return;
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const action = form.getAttribute("action") || "";
        // Cart-formulär postar mot /checkout (eller /cart med checkout-knapp).
        const submitter = event.submitter;
        const submitsCheckout =
          /(^|\/)checkout(\/|$|\?)/.test(action) ||
          submitter?.matches?.('[name="checkout"], button[value="checkout"]');
        if (submitsCheckout) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === "function") {
            event.stopImmediatePropagation();
          }
          divertToPicker();
        }
      },
      true,
    );

    let addToCartTimer;
    function handleCartAddition() {
      if (root.dataset.autoOpen !== "true") return;
      window.clearTimeout(addToCartTimer);
      addToCartTimer = window.setTimeout(async () => {
        try {
          const cart = await getCart();
          renderCartDeliverySummary(cart);
          const complete = restoreFromCart(cart);
          if (!complete) openDrawer(true);
        } catch {
          openDrawer(true);
        }
      }, 500);
    }

    document.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const action = form.getAttribute("action") || "";
      if (action.includes(root.dataset.cartAddPath) || action.includes("/cart/add")) {
        handleCartAddition();
      }
    }, true);

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (response.ok && url.includes("/cart/add")) handleCartAddition();
      if (
        response.ok &&
        ["/cart/change", "/cart/update", "/cart/clear"].some((path) =>
          url.includes(path),
        )
      ) {
        refreshCartDeliverySummary();
      }
      return response;
    };

    document.addEventListener("cart:updated", () => {
      refreshCartDeliverySummary();
      handleCartAddition();
    });
    document.addEventListener("cart:refresh", () => {
      refreshCartDeliverySummary();
      handleCartAddition();
    });
    document.addEventListener("product:added", handleCartAddition);

    // Är temats varukorgspanel synlig just nu?
    function themeCartIsOpen() {
      return Boolean(
        document.querySelector(
          ".cart-panel.open, .cart-backdrop.open, .wld-cart-open",
        ) || document.documentElement.classList.contains("wld-cart-open"),
      );
    }

    let themeCartWasOpen = themeCartIsOpen();
    const cartPanelObserver = new MutationObserver((mutations) => {
      const cartDrawerChanged = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some(
          (node) =>
            node instanceof Element &&
            (node.matches(".cart-panel, [data-wld-cart-refresh]") ||
              node.querySelector(".cart-panel, [data-wld-cart-refresh]")),
        ),
      );
      if (cartDrawerChanged) refreshCartDeliverySummary();

      // Upptäck övergången stängd -> öppen (panelen renderas, eller får .open).
      const open = themeCartIsOpen();
      if (open && !themeCartWasOpen) enforceSelectionOnCartOpen();
      themeCartWasOpen = open;
    });
    cartPanelObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    // Ett sparat val vars beställningsstopp passerat ska inte gå till kassan.
    // Rensa det, tala om varför, och tvinga fram ett nytt val.
    async function discardIfExpired(cart) {
      if (!selectionIsExpired(cart?.attributes)) return cart;
      const cleared = await clearCartSelection();
      resetLocalState();
      setStatus(
        status,
        "Beställningstiden för din valda leverans har passerat. Välj en ny leveranstid.",
        "error",
      );
      if (cart?.item_count > 0) openDrawer(true);
      return cleared || cart;
    }

    getCart()
      .then(async (cart) => {
        const fresh = await discardIfExpired(cart);
        restoreFromCart(fresh);
        renderCartDeliverySummary(fresh);
        guardCheckout(fresh);
        // Om sidan laddas om med varukorgen redan öppen och valet ofullständigt.
        if (themeCartIsOpen()) enforceSelectionOnCartOpen();
      })
      .catch(() => {});
  }

  document.querySelectorAll(SELECTOR).forEach(initialize);
  document.addEventListener("shopify:section:load", (event) => {
    event.target.querySelectorAll?.(SELECTOR).forEach(initialize);
  });
})();
