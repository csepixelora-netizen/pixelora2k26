window.__PIXELORA_CONFIG__ = {
  // Backend URL (Render, etc.). When set, the frontend always calls this API, including on localhost.
  // Use "" only if the API is served from the same origin (e.g. local uvicorn with static files).
  apiBaseUrl: "https://your-render-service.onrender.com",
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
