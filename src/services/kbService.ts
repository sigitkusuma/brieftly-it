import { collection, query, where, getDocs, limit, doc, updateDoc, increment, serverTimestamp, addDoc, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { AISolution, generateEmbedding } from './aiService';

// Mathematical helper for Vector Search
const cosineSimilarity = (A: number[], B: number[]) => {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }
  return normA === 0 || normB === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

export const findKBMatch = async (intent: string, os: string) => {
  const path = 'solutions';
  try {
    const q = query(
      collection(db, path),
      where('os', '==', os),
      limit(500)
    );
    const snapshot = await getDocs(q);
    const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
    
    if (results.length > 0) {
      const osTags = Array.from(new Set(results.map(r => r.os)));
      console.log(`[KB Search] Found ${results.length} solutions for ${os.toUpperCase()}. Unique OS tags in results: ${osTags.join(', ')}`);
    }
    
    console.log(`[KB Search] Checking ${results.length} solutions for ${os.toUpperCase()} matching intent: "${intent}"`);
    
    // Generate Vector Embedding for the search intent
    const queryEmbedding = await generateEmbedding(intent);
    
    let bestMatch = null;
    let highestScore = 0;

    if (queryEmbedding) {
      // 1. Vector Search (Semantic)
      console.log(`[KB Search] Running Semantic Vector Search...`);
      for (const s of results) {
        if (s.embedding) {
          const score = cosineSimilarity(queryEmbedding, s.embedding);
          if (score > highestScore) {
            highestScore = score;
            bestMatch = s;
          }
        }
      }
      
      // Threshold for high-confidence Semantic Match
      if (highestScore > 0.85) {
        console.log(`[KB Search] High-confidence semantic match found! Score: ${highestScore.toFixed(3)} - ${bestMatch.problemSummary}`);
        return bestMatch;
      } else {
        console.log(`[KB Search] Best semantic score was too low: ${highestScore.toFixed(3)}`);
      }
    }

    // 2. Fallback to Keyword Match if Vector Search fails or no vectors exist
    const intentWords = intent.toLowerCase().split(' ').filter(w => w.length > 3);
    const match = results.find((s: any) => {
      const summaryLower = s.problemSummary.toLowerCase();
      if (summaryLower.includes(intent.toLowerCase()) || intent.toLowerCase().includes(summaryLower)) return true;
      if (intentWords.length > 0) {
        const matchCount = intentWords.filter(word => summaryLower.includes(word)).length;
        if (matchCount / intentWords.length >= 0.6) return true;
      }
      return false;
    });

    if (match) {
      console.log(`[KB Search] Found match: ${match.problemSummary}`);
      // Fetch recent feedbacks for this solution to help AI refinement
      try {
        const fbSnap = await getDocs(query(
          collection(db, `solutions/${match.id}/feedbacks`),
          orderBy('createdAt', 'desc'),
          limit(3)
        ));
        (match as any).recentFeedbacks = fbSnap.docs.map(d => d.data().comments).filter(Boolean);
      } catch (e) {
        console.warn("[KB Search] Could not fetch feedbacks for solution", e);
      }
    } else {
      console.log(`[KB Search] No match found.`);
    }

    return match;
  } catch (error) {
    console.warn("[KB Search] Firebase read failed or is unconfigured. Proceeding without KB.", error);
    return undefined; // Gracefully fail without breaking the flow
  }
};

export const validateSolution = async (solutionId: string | null, solutionData: AISolution | null, user?: any) => {
  const path = 'solutions';
  try {
    if (solutionId) {
      const solutionRef = doc(db, path, solutionId);
      await updateDoc(solutionRef, {
        validatedCount: increment(1),
        updatedAt: serverTimestamp()
      });
    } else if (solutionData) {
      // Create new KB entry if it worked! (The Flywheel)
      const data: any = {
        ...solutionData,
        os: solutionData.os.toLowerCase(), // Force consistency
        validatedCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (user) {
        data.authorId = user.uid;
        data.authorName = user.displayName;
        data.authorPhoto = user.photoURL;
      }
      await addDoc(collection(db, path), data);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
};

export const submitFeedback = async (
  solutionId: string | null,
  solutionData: AISolution | null,
  feedbackType: 'worked' | 'confusing' | 'outdated' | 'failed',
  comments?: string,
  user?: any
): Promise<string | undefined> => {
  try {
    let currentId = solutionId;

    // If solution doesn't exist yet in the KB, but they gave feedback, we might want to store the solution first.
    // Specially if it "worked".
    if (!currentId && solutionData) {
      // Create embedding before saving
      const textToEmbed = (solutionData as any).intent || solutionData.problemSummary;
      const embedding = await generateEmbedding(textToEmbed);

      const data: any = {
        ...solutionData,
        os: solutionData.os.toLowerCase(), // Force consistency
        embedding: embedding || null, // Store vector natively!
        validatedCount: feedbackType === 'worked' ? 1 : 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (user) {
        data.authorId = user.uid;
        data.authorName = user.displayName;
        data.authorPhoto = user.photoURL;
      }
      // GUARD: Do not save "Not OS Related" or generic error messages to the Knowledge Base
      if (solutionData.problemSummary.includes("Not OS Related")) {
        console.warn("[Firestore] Skipping KB promotion for non-OS related issue.");
      } else {
        const newSol = await addDoc(collection(db, 'solutions'), data);
        currentId = newSol.id;
        console.log(`[Firestore] New AI Solution promoted to KB with ID: ${currentId}`);
      }
    } else if (currentId && feedbackType === 'worked') {
      // Increment if it worked
      await updateDoc(doc(db, 'solutions', currentId), {
        validatedCount: increment(1),
        updatedAt: serverTimestamp()
      });
    }

    if (currentId) {
      // Add detailed feedback to subcollection
      const fbData: any = {
        solutionId: currentId,
        feedbackType,
        createdAt: serverTimestamp()
      };
      if (user) {
        fbData.userId = user.uid;
      }
      if (comments) fbData.comments = comments;
      await addDoc(collection(db, `solutions/${currentId}/feedbacks`), fbData);
      console.log(`[Firestore] Feedback logged successfully to: solutions/${currentId}/feedbacks`);
    }
    
    return currentId || undefined;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `solutions/feedbacks`);
  }
};

export const getAllSolutions = async () => {
  const path = 'solutions';
  try {
    const q = query(
      collection(db, path),
      orderBy('updatedAt', 'desc'),
      limit(50)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
};

export const getInteractionsReport = async () => {
  const path = 'interactions';
  try {
    const q = query(
      collection(db, path),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
};
