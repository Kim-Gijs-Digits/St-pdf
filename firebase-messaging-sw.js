importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCkK45tqlORcpyIkVVsD5sJA6CRx4guad0",
  authDomain: "shifttap-cloud.firebaseapp.com",
  projectId: "shifttap-cloud",
  storageBucket: "shifttap-cloud.firebasestorage.app",
  messagingSenderId: "818538130643",
  appId: "1:818538130643:web:2614157b0d6a767deb3826"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log("Shift-Tap background notification:", payload);

  const notificationTitle = payload.notification?.title || "Shift-Tap";
  const notificationOptions = {
    body: payload.notification?.body || "",
    icon: "/ST-logo.png"
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});