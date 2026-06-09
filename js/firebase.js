import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  doc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCG9bPBl_UHmJ_SpyRja0j5cIgwTol8X6Y",
  authDomain: "last-ride-logistics.firebaseapp.com",
  projectId: "last-ride-logistics",
  storageBucket: "last-ride-logistics.firebasestorage.app",
  messagingSenderId: "962137351665",
  appId: "1:962137351665:web:e8dc4e8992849321d5d050",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SUBMISSIONS = collection(db, "submissions");
const OVERRIDES_DOC = doc(db, "meta", "overrides");

export {
  db,
  SUBMISSIONS,
  OVERRIDES_DOC,
  addDoc,
  setDoc,
  doc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
};
