# Qdrant Vector Search Migration Plan

## Overview
Currently, Brieftly performs vector similarity search purely on the client-side. The `kbService.ts` fetches up to 500 documents from Firestore and calculates the cosine similarity for each one against the query embedding. As the knowledge base grows, this will become slow, memory-intensive, and unscalable. 

To improve performance and scalability, we will migrate the vector similarity search to **Qdrant**, a specialized vector database.

## Phase 1: Backend Setup & API Development (`server.ts`)
Since Qdrant requires an API key, we must not expose it on the frontend. We will move the vector search logic to the Node.js backend.

1. **Dependencies & Config**
   - Install Qdrant client: `npm install @qdrant/js-client-rest`
   - Add Qdrant credentials to `.env`:
     ```env
     QDRANT_URL=https://your-cluster-url.qdrant.tech
     QDRANT_API_KEY=your_api_key
     ```
2. **Qdrant Client Initialization**
   - Initialize the Qdrant client in `server.ts`.
   - On server start, ensure the `brieftly_solutions` collection exists. Note: Gemini embeddings usually have **768 dimensions** (using `text-embedding-004`), so the Qdrant collection must be configured for size `768` and distance `Cosine`.
3. **New API Endpoints**
   - **`POST /api/kb/qdrant/search`**: 
     - Accepts: `embedding` (array of numbers), `os` (string, for filtering).
     - Action: Queries Qdrant using the embedding and a payload filter on `os`.
     - Returns: A list of matching document IDs and their confidence scores.
   - **`POST /api/kb/qdrant/upsert`**:
     - Accepts: `id` (Firestore Document ID), `embedding`, `os`, `problemSummary`.
     - Action: Upserts the vector into Qdrant with the corresponding payload.

## Phase 2: Frontend Refactoring (`src/services/kbService.ts`)
We will modify the frontend to utilize the new backend endpoints instead of downloading the entire KB.

1. **Refactor `findKBMatch`**
   - Remove the manual `cosineSimilarity` function.
   - Remove the `getDocs` loop that fetches 500 documents.
   - **New Flow**:
     1. Generate the embedding for the user's intent.
     2. Call `POST /api/kb/qdrant/search` with the embedding and `os`.
     3. If a match is found with a high score (e.g., >0.85), use the returned Firestore `id` to fetch the exact document from Firestore.
     4. Retain the fallback keyword match logic in case the Qdrant service is down or fails.
2. **Refactor `submitFeedback`**
   - When a new KB solution is created, immediately after adding it to Firestore (`addDoc`), call the new `POST /api/kb/qdrant/upsert` endpoint to index it in Qdrant.

## Phase 3: Data Migration Script
To ensure existing KB solutions are available in Qdrant, we will create a one-off migration script (e.g., `scripts/migrateToQdrant.ts`).

1. **Migration Logic**
   - Connect to Firestore using the Firebase Admin SDK.
   - Fetch all documents from the `solutions` collection that have an existing `embedding`.
   - Batch upload these embeddings to Qdrant with their `os` payload and Firestore document ID as the Qdrant Point ID.

## Next Steps
1. Create a Qdrant Cloud cluster (if you haven't already).
2. Gather the `QDRANT_URL` and `QDRANT_API_KEY`.
3. Approve this plan to begin implementation.
