const { onRequest } = require("firebase-functions/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();

const db = admin.firestore();

const TEXTS = {
  startCheck: {
    nl: "Vergeten in te tikken vandaag?",
    en: "Did you forget to clock in today?",
    fr: "Avez-vous oublié de pointer aujourd'hui ?",
    de: "Hast du heute vergessen einzuchecken?",
    pl: "Zapomniałeś dzisiaj się zalogować?",
    es: "¿Olvidaste fichar hoy?",
    hu: "Elfelejtettél ma bejelentkezni?",
    it: "Hai dimenticato di timbrare oggi?"
  },
  forgotCheckout: {
    nl: "Vergeten uit te tikken?",
    en: "Did you forget to clock out?",
    fr: "Avez-vous oublié de pointer en sortant ?",
    de: "Hast du vergessen auszuchecken?",
    pl: "Zapomniałeś się wylogować?",
    es: "¿Olvidaste fichar la salida?",
    hu: "Elfelejtettél kijelentkezni?",
    it: "Hai dimenticato di timbrare l'uscita?"
  },
  noLogs: {
    nl: "Geen logs vandaag. Vergeten te tikken?",
    en: "No logs today. Did you forget to clock in?",
    fr: "Aucun log aujourd'hui. Avez-vous oublié de pointer ?",
    de: "Keine Einträge heute. Hast du vergessen einzuchecken?",
    pl: "Brak wpisów dzisiaj. Zapomniałeś się zalogować?",
    es: "No hay registros hoy. ¿Olvidaste fichar?",
    hu: "Ma nincs napló. Elfelejtettél bejelentkezni?",
    it: "Nessun registro oggi. Hai dimenticato di timbrare?"
  },
  title: {
    nl: "Shift-Tap herinnering",
    en: "Shift-Tap reminder",
    fr: "Rappel Shift-Tap",
    de: "Shift-Tap Erinnerung",
    pl: "Przypomnienie Shift-Tap",
    es: "Recordatorio Shift-Tap",
    hu: "Shift-Tap emlékeztető",
    it: "Promemoria Shift-Tap"
  }
};

function pickLang(userData) {
  const lang = (userData?.settings?.language || userData?.language || "en").toLowerCase();
  return TEXTS.title[lang] ? lang : "en";
}

async function sendPushToUser(userId, kind) {
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) return;

  const userData = userSnap.data() || {};
  const token = userData?.messaging?.token;
  const notifEnabled = userData?.notificationSettings?.enabled;

  if (!token || notifEnabled !== true) return;

  const lang = pickLang(userData);
  const title = TEXTS.title[lang];
  const body = TEXTS[kind][lang];

  await admin.messaging().send({
    token,
    notification: {
      title,
      body
    },
    webpush: {
      notification: {
        title,
        body,
        icon: "/ST-logo.png"
      }
    }
  });

  console.log(`Push gestuurd naar user ${userId}: ${kind} (${lang})`);
}

exports.helloWorld = onRequest((request, response) => {
  response.send("Shift-Tap Functions werken!");
});

exports.shiftTapMorningCheck = onSchedule(
  { schedule: "30 7 * * *", timeZone: "Europe/Brussels" },
  async () => {
    console.log("Shift-Tap 07:30 check gestart");

    const usersSnap = await db.collection("users").get();
    for (const doc of usersSnap.docs) {
      await sendPushToUser(doc.id, "startCheck");
    }
  }
);

exports.shiftTapAfternoonCheck = onSchedule(
  { schedule: "30 16 * * *", timeZone: "Europe/Brussels" },
  async () => {
    console.log("Shift-Tap 16:30 check gestart");

    const usersSnap = await db.collection("users").get();
    for (const doc of usersSnap.docs) {
      await sendPushToUser(doc.id, "forgotCheckout");
    }
  }
);

exports.shiftTapEveningCheck = onSchedule(
  { schedule: "0 19 * * *", timeZone: "Europe/Brussels" },
  async () => {
    console.log("Shift-Tap 19:00 check gestart");

    const usersSnap = await db.collection("users").get();
    for (const doc of usersSnap.docs) {
      await sendPushToUser(doc.id, "noLogs");
    }
  }
);


exports.shiftTapSendTestPush = onRequest(async (request, response) => {
  try {
    const userId = request.query.userId;

    if (!userId) {
      response.status(400).send("Missing userId");
      return;
    }

    const userSnap = await db.collection("users").doc(userId).get();

    if (!userSnap.exists) {
      response.status(404).send("User not found");
      return;
    }

    const userData = userSnap.data() || {};
    const token = userData?.messaging?.token;

    if (!token) {
      response.status(400).send("No messaging token found for this user");
      return;
    }

    const lang = pickLang(userData);
    const title = TEXTS.title[lang];
    const bodyMap = {
      nl: "Dit is een testmelding van Shift-Tap.",
      en: "This is a Shift-Tap test notification.",
      fr: "Ceci est une notification de test Shift-Tap.",
      de: "Dies ist eine Shift-Tap-Testbenachrichtigung.",
      pl: "To jest testowe powiadomienie Shift-Tap.",
      es: "Esta es una notificación de prueba de Shift-Tap.",
      hu: "Ez egy Shift-Tap tesztértesítés.",
      it: "Questa è una notifica di test di Shift-Tap."
    };

    await admin.messaging().send({
      token,
      notification: {
        title,
        body: bodyMap[lang] || bodyMap.en
      },
      webpush: {
        notification: {
          title,
          body: bodyMap[lang] || bodyMap.en,
          icon: "/ST-logo.png"
        }
      }
    });

    response.send(`Test push sent to ${userId}`);
  } catch (err) {
    console.error("Test push failed:", err);
    response.status(500).send(err.message || "Test push failed");
  }
});