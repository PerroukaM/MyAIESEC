// Firebase web config. Copy these values from:
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration.
// They are not secrets: access is enforced by firestore.rules, not by hiding this file.
export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// Only accounts on this email domain can sign in and see data.
// Must match the domain in firestore.rules.
export const ALLOWED_DOMAIN = "aiesec.gr";
