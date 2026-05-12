import { collection, query, where, getDocs, limit, doc, updateDoc, increment, serverTimestamp, addDoc, orderBy, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { AISolution, generateEmbedding } from './aiService';

export const findKBMatch = async (intent: string, os: string) => {
  try {
    // Generate Vector Embedding for the search intent
    const queryEmbedding = await generateEmbedding(intent);
    
    let bestMatch = null;

    if (queryEmbedding) {
      // 1. Vector Search (Semantic) via Qdrant
      try {
        const res = await fetch("/api/kb/qdrant/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ embedding: queryEmbedding, os })
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            const topResult = data.results[0];
            // Threshold for high-confidence Semantic Match
            if (topResult.score > 0.85 && topResult.payload?.firestoreId) {
              const docRef = doc(db, 'solutions', topResult.payload.firestoreId);
              const docSnap = await getDoc(docRef);
              if (docSnap.exists()) {
                bestMatch = { id: docSnap.id, ...docSnap.data() as any };
              }
            }
          }
        }
      } catch (err) {
        console.warn("[KB Search] Qdrant search request failed.", err);
      }
    }

    let match = bestMatch;

    // 2. Fallback to Keyword Match if Vector Search fails
    if (!match) {
      const q = query(
        collection(db, 'solutions'),
        where('os', '==', os),
        limit(100)
      );
      const snapshot = await getDocs(q);
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      const intentWords = intent.toLowerCase().split(' ').filter(w => w.length > 3);
      match = results.find((s: any) => {
        const summaryLower = s.problemSummary.toLowerCase();
        if (summaryLower.includes(intent.toLowerCase()) || intent.toLowerCase().includes(summaryLower)) return true;
        if (intentWords.length > 0) {
          const matchCount = intentWords.filter(word => summaryLower.includes(word)).length;
          if (matchCount / intentWords.length >= 0.6) return true;
        }
        return false;
      });
    }

    if (match) {
      // Fetch recent feedbacks for this solution to help AI refinement
      try {
        const fbSnap = await getDocs(query(
          collection(db, `solutions/${match.id}/feedbacks`),
          orderBy('createdAt', 'desc'),
          limit(3)
        ));
        (match as any).recentFeedbacks = fbSnap.docs.map(d => d.data().comments).filter(Boolean);
      } catch (e) {
        // Silent fail for production refinement
      }
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
        // Skip
      } else {
        const newSol = await addDoc(collection(db, 'solutions'), data);
        currentId = newSol.id;
        
        // Sync to Qdrant
        if (embedding) {
          fetch("/api/kb/qdrant/upsert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: currentId,
              embedding,
              os: data.os,
              problemSummary: data.problemSummary
            })
          }).catch(err => console.error("[Qdrant] Failed to upsert", err));
        }
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
