import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function testWrite() {
  try {
    console.log("Attempting test write to 'diagnostics' collection...");
    const docRef = await addDoc(collection(db, 'diagnostics'), {
      test: true,
      timestamp: new Date(),
      message: "Testing Firestore connectivity"
    });
    console.log("Write successful! ID:", docRef.id);
  } catch (e) {
    console.error("Write failed:", e);
  }
}

testWrite();
