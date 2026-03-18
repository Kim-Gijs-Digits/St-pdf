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

const TIME_ZONE = "Europe/Brussels";

function pickLang(userData) {
  const lang = (userData?.settings?.language || userData?.language || "en").toLowerCase();
  return TEXTS.title[lang] ? lang : "en";
}

function getTodayStringInBrussels() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date());
}

function canReceiveNotifications(userData) {
  const token = userData?.messaging?.token;
  const notifEnabled = userData?.notificationSettings?.enabled;
  return Boolean(token && notifEnabled === true);
}

async function getTodayWorkLog(userId, todayKey) {
  const logRef = db.collection("users").doc(userId).collection("workLogs").doc(todayKey);
  const logSnap = await logRef.get();

  if (!logSnap.exists) {
    return {
      exists: false,
      startTime: null,
      stopTime: null,
      hasLogs: false
    };
  }

  const data = logSnap.data() || {};

  return {
    exists: true,
    startTime: data.startTime || null,
    stopTime: data.stopTime || null,
    hasLogs: Boolean(data.startTime || data.stopTime)
  };
}

function shouldSendNotification(kind, dayStatus) {
  switch (kind) {
    case "startCheck":
      return !dayStatus.startTime;

    case "forgotCheckout":
      return Boolean(dayStatus.startTime) && !dayStatus.stopTime;

    case "noLogs":
      return !dayStatus.exists || !dayStatus.hasLogs;

    default:
      return false;
  }
}

async function sendPushToUser(userId, kind, userDataArg = null) {
  let userData = userDataArg;

  if (!userData) {
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return false;
    userData = userSnap.data() || {};
  }

  const token = userData?.messaging?.token;
  const notifEnabled = userData?.notificationSettings?.enabled;

  if (!token || notifEnabled !== true) return false;

  const lang = pickLang(userData);
  const title = TEXTS.title[lang];
  const body = TEXTS[kind]?.[lang];

  if (!body) return false;

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
  return true;
}

async function runScheduledCheck(kind) {
  const todayKey = getTodayStringInBrussels();

  console.log(`Shift-Tap scheduled check gestart: ${kind} voor ${todayKey}`);

  const usersSnap = await db.collection("users").get();

  const results = await Promise.all(
    usersSnap.docs.map(async (doc) => {
      const userId = doc.id;
      const userData = doc.data() || {};

      if (!canReceiveNotifications(userData)) {
        return { checked: 1, eligible: 0, sent: 0 };
      }

      try {
        const dayStatus = await getTodayWorkLog(userId, todayKey);

        if (!shouldSendNotification(kind, dayStatus)) {
          return { checked: 1, eligible: 0, sent: 0 };
        }

        const sent = await sendPushToUser(userId, kind, userData);

        return {
          checked: 1,
          eligible: 1,
          sent: sent ? 1 : 0
        };
      } catch (error) {
        console.error(`Fout bij verwerken user ${userId} voor ${kind}:`, error);
        return { checked: 1, eligible: 0, sent: 0 };
      }
    })
  );

  const checked = results.reduce((sum, r) => sum + r.checked, 0);
  const eligible = results.reduce((sum, r) => sum + r.eligible, 0);
  const sent = results.reduce((sum, r) => sum + r.sent, 0);

  console.log(
    `Shift-Tap scheduled check klaar: ${kind} | checked=${checked} eligible=${eligible} sent=${sent}`
  );
}

exports.helloWorld = onRequest((request, response) => {
  response.send("Shift-Tap Functions werken!");
});

exports.shiftTapMorningCheck = onSchedule(
  { schedule: "30 7 * * *", timeZone: "Europe/Brussels" },
  async () => {
    console.log("Shift-Tap 07:30 check gestart");
    await runScheduledCheck("startCheck");
  }
);

exports.shiftTapAfternoonCheck = onSchedule(
  { schedule: "30 16 * * *", timeZone: "Europe/Brussels" },
  async () => {
    console.log("Shift-Tap 16:30 check gestart");
    await runScheduledCheck("forgotCheckout");
  }
);

exports.shiftTapEveningCheck = onSchedule(
  { schedule: "0 19 * * *", timeZone: "Europe/Brussels" },
  async () => {
    console.log("Shift-Tap 19:00 check gestart");
    await runScheduledCheck("noLogs");
  }
);
exports.shiftTapSendTestPush = onRequest((request, response) => {
  response.status(403).send("Disabled in production");
});
