(function () {
  "use strict";

  // Shift-Tap notifications base
  // Basis:
  // - instellingen lezen/schrijven
  // - browser support check
  // - permission vragen
  // - service worker registreren
  // - Firebase Messaging initialiseren
  // - FCM token ophalen

  let messaging = null;

  function initFirebaseMessaging() {
    try {
      if (typeof firebase === "undefined") {
        console.warn("Firebase niet geladen.");
        return;
      }

      messaging = firebase.messaging();
      console.log("Firebase Messaging klaar.");
    } catch (err) {
      console.error("Messaging init fout:", err);
    }
  }

  const NOTIF_DEFAULTS = {
    enabled: false,
    startCheckTime: "08:00",
    forgotCheckoutTime: "18:00",
    noLogsTime: "20:00"
  };



  function isNotificationSupported() {
    return ("Notification" in window) && ("serviceWorker" in navigator);
  }
function getNotifSettings() {
  try {
    const storeKey = window.SHIFTTAP_STORE_KEY;
    if (!storeKey) return { ...NOTIF_DEFAULTS };

    const raw = localStorage.getItem(storeKey);
    if (!raw) return { ...NOTIF_DEFAULTS };

    const parsed = JSON.parse(raw);
    const s = parsed?.settings || {};

    return {
      enabled: typeof s.notificationsEnabled === "boolean" ? s.notificationsEnabled : NOTIF_DEFAULTS.enabled,
      startCheckTime: s.notificationsStartCheckTime || NOTIF_DEFAULTS.startCheckTime,
      forgotCheckoutTime: s.notificationsForgotCheckoutTime || NOTIF_DEFAULTS.forgotCheckoutTime,
      noLogsTime: s.notificationsNoLogsTime || NOTIF_DEFAULTS.noLogsTime
    };
  } catch (err) {
    console.error("Notif settings lezen mislukt:", err);
    return { ...NOTIF_DEFAULTS };
  }
}

function setNotifSettings(next) {
  try {
    const storeKey = window.SHIFTTAP_STORE_KEY;
    if (!storeKey) {
      console.warn("STORE_KEY niet beschikbaar.");
      return;
    }

    const raw = localStorage.getItem(storeKey);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.settings = parsed.settings || {};

    parsed.settings.notificationsEnabled = !!next.enabled;
    parsed.settings.notificationsStartCheckTime = next.startCheckTime || NOTIF_DEFAULTS.startCheckTime;
    parsed.settings.notificationsForgotCheckoutTime = next.forgotCheckoutTime || NOTIF_DEFAULTS.forgotCheckoutTime;
    parsed.settings.notificationsNoLogsTime = next.noLogsTime || NOTIF_DEFAULTS.noLogsTime;

    localStorage.setItem(storeKey, JSON.stringify(parsed));
    console.log("Notif settings opgeslagen.");
  } catch (err) {
    console.error("Notif settings opslaan mislukt:", err);
  }
}
  async function requestNotificationPermission() {
    if (!isNotificationSupported()) {
      console.warn("Notifications worden niet ondersteund op dit toestel/browser.");
      return false;
    }

    if (Notification.permission === "granted") {
      return true;
    }

    if (Notification.permission === "denied") {
      console.warn("Notification permission is geweigerd.");
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === "granted";
  }

  async function registerMessagingServiceWorker() {
    try {
      const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
      console.log("Messaging service worker geregistreerd:", registration);
      return registration;
    } catch (err) {
      console.error("Service worker registratie mislukt:", err);
      return null;
    }
  }

  async function getMessagingToken(swRegistration) {
    try {
      if (!messaging) {
        console.warn("Messaging niet geïnitialiseerd.");
        return null;
      }

      const token = await messaging.getToken({
        serviceWorkerRegistration: swRegistration,
        vapidKey: "BClV4yvt5RgDpP35WV9gpI6QdFH7iEyfb1koZZOWccwKJhWZCOB_Uc4GreqBrGWgoZFhkq653x6h8RXSliXCutA"
      });

      if (token) {
        console.log("Shift-Tap FCM token:", token);
        return token;
      } else {
        console.warn("Geen FCM token ontvangen.");
        return null;
      }
    } catch (err) {
      console.error("Token ophalen mislukt:", err);
      return null;
    }
  }
async function saveMessagingToken(token) {
  try {
    if (!token) {
      console.warn("Geen token om op te slaan.");
      return false;
    }

    if (typeof fbAuth === "undefined" || typeof fbDb === "undefined") {
      console.warn("Firebase auth/db niet beschikbaar.");
      return false;
    }

    const user = fbAuth.currentUser;
    if (!user) {
      console.warn("Geen ingelogde gebruiker, token niet opgeslagen.");
      return false;
    }

    await fbDb.collection("users").doc(user.uid).set({
      notificationSettings: {
        enabled: true,
        startCheckTime: "08:00",
        forgotCheckoutTime: "18:00",
        noLogsTime: "20:00"
      },
      messaging: {
        token: token,
        updatedAt: new Date().toISOString()
      }
    }, { merge: true });

    console.log("FCM token opgeslagen in Firestore.");
    return true;
  } catch (err) {
    console.error("Token opslaan mislukt:", err);
    return false;
  }
}
 async function initNotifications() {
  if (typeof window.ensureFirebase === "function") {
    await window.ensureFirebase();
  }

  await new Promise(r => setTimeout(r, 500));
  
  initFirebaseMessaging();

  const settings = getNotifSettings();
    console.log("Shift-Tap notifications init", settings);

    if (!settings.enabled) {
      console.log("Notifications staan uit.");
      return;
    }

    const ok = await requestNotificationPermission();
    if (!ok) {
      console.warn("Notifications niet actief: geen toestemming.");
      return;
    }

    const swRegistration = await registerMessagingServiceWorker();
    if (!swRegistration) {
      console.warn("Messaging service worker niet geregistreerd.");
      return;
    }

    await navigator.serviceWorker.ready;

    const token = await getMessagingToken(swRegistration);
    if (!token) {
      console.warn("Geen messaging token beschikbaar.");
      return;
    }
    

await saveMessagingToken(token);    

    console.log("Notifications basis staat klaar.");
  }

  window.ShiftTapNotifications = {
    defaults: NOTIF_DEFAULTS,
    getSettings: getNotifSettings,
    setSettings: setNotifSettings,
    isSupported: isNotificationSupported,
    requestPermission: requestNotificationPermission,
    init: initNotifications
  };
})();