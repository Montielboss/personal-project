import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-analytics.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDSxIaJi2MFHQ_Ot_vlWKBUdSXsr0XIAQE',
  authDomain: 'modo-vida.firebaseapp.com',
  projectId: 'modo-vida',
  storageBucket: 'modo-vida.firebasestorage.app',
  messagingSenderId: '576817601006',
  appId: '1:576817601006:web:65f2133dc361346b4e56ff',
  measurementId: 'G-FD82FBGZGW'
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { doc, getDoc, setDoc, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged };

if (await isSupported()) getAnalytics(app);
