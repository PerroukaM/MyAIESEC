// Firebase web config. Copy these values from:
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration.
// They are not secrets: access is enforced by firestore.rules, not by hiding this file.
export const firebaseConfig = {
  apiKey: "AIzaSyD2wqBgTAQnTaAPNEHRabNVgUjceNPCHfo",
  authDomain: "aiesec-planner.firebaseapp.com",
  projectId: "aiesec-planner",
  storageBucket: "aiesec-planner.firebasestorage.app",
  messagingSenderId: "174813947886",
  appId: "1:174813947886:web:bd343da0c1da1d0b3ed0ff"
};

// Only accounts on this email domain can sign in and see data.
// Must match the domain in firestore.rules.
export const ALLOWED_DOMAIN = "aiesec.gr";
