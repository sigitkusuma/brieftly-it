import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";
import { pipeline } from "@xenova/transformers";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import crypto from "crypto";
import fs from "fs";

import firebaseConfig from "./firebase-applet-config.json";

// Initialize Firebase using the standard web SDK
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function migrate() {
  console.log("Loading Transformers model (Xenova/multilingual-e5-small)...");
  
  const embeddingModel = await pipeline("feature-extraction", "Xenova/multilingual-e5-small");

  console.log("Fetching solutions from Firestore...");
  const snapshot = await getDocs(collection(db, "solutions"));
  
  if (snapshot.empty) {
    console.log("No solutions found. Migration complete.");
    return;
  }

  // Ensure collection exists in Qdrant
  try {
    const collections = await qdrantClient.getCollections();
    const exists = collections.collections.some(c => c.name === "brieftly_solutions");
    if (!exists) {
      console.log("Creating Qdrant collection: brieftly_solutions");
      await qdrantClient.createCollection("brieftly_solutions", {
        vectors: { size: 384, distance: "Cosine" }
      });
    }
  } catch (e: any) {
    console.warn(`Could not check/create Qdrant collection (Check Qdrant env vars): ${e.message}`);
  }

  let count = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const textToEmbed = data.intent || data.problemSummary;

    if (!textToEmbed) {
      console.log(`Skipping doc ${doc.id} - no text to embed.`);
      continue;
    }

    try {
      console.log(`Processing ${doc.id}...`);
      // Regenerate embedding (384 dimensions)
      const output = await embeddingModel(textToEmbed, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);

      // Prepare UUID for Qdrant
      const hash = crypto.createHash('md5').update(doc.id).digest('hex');
      const uuid = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;

      // Upsert to Qdrant
      await qdrantClient.upsert("brieftly_solutions", {
        wait: true,
        points: [
          {
            id: uuid,
            vector: embedding,
            payload: {
              firestoreId: doc.id,
              os: data.os,
              problemSummary: data.problemSummary
            }
          }
        ]
      });
      count++;
    } catch (e: any) {
      console.error(`Error migrating doc ${doc.id}: ${e.message}`);
    }
  }

  console.log(`Migration completed successfully! Processed ${count} documents.`);
  process.exit(0);
}

migrate();
