window.__PIXELORA_CONFIG__ = {
  // Render backend URL in production.
  // Localhost automatically uses same-origin API from app.js/admin.js.
  apiBaseUrl: "https://your-render-service.onrender.com",
  // AttendSuite: Google Drive folder opened (new tab) when a coordinator enters a valid event name and continues.
  attendanceSuiteDriveFolderUrl: "",
  // Optional map: catalog key (UPPERCASE) -> folder URL, overrides attendanceSuiteDriveFolderUrl for that event.
  attendanceSuiteDriveByEvent: {},
  firebase: {
    apiKey: "REPLACE_WITH_API_KEY",
    authDomain: "REPLACE_WITH_AUTH_DOMAIN",
    projectId: "REPLACE_WITH_PROJECT_ID",
    storageBucket: "REPLACE_WITH_STORAGE_BUCKET",
    messagingSenderId: "REPLACE_WITH_MESSAGING_SENDER_ID",
    appId: "REPLACE_WITH_APP_ID",
    measurementId: "REPLACE_WITH_MEASUREMENT_ID"
  }
};
