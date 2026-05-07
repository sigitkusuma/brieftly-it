import { collection, query, where, getDocs, limit, doc, updateDoc, increment, serverTimestamp, addDoc, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { AISolution } from './aiService';

export const findKBMatch = async (intent: string, os: string) => {
  const path = 'solutions';
  try {
    const q = query(
      collection(db, path),
      where('os', '==', os),
      limit(5)
    );
    const snapshot = await getDocs(q);
    const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Simple filter for demo: in a real app, use vector search
    // Here we'll just check if keywords in the intent match the summary
    return results.find((s: any) => 
      s.problemSummary.toLowerCase().includes(intent.toLowerCase()) ||
      intent.toLowerCase().includes(s.problemSummary.toLowerCase())
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
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
      const data: any = {
        ...solutionData,
        validatedCount: feedbackType === 'worked' ? 1 : 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      if (user) {
        data.authorId = user.uid;
        data.authorName = user.displayName;
        data.authorPhoto = user.photoURL;
      }
      const newSol = await addDoc(collection(db, 'solutions'), data);
      currentId = newSol.id;
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
    handleFirestoreError(error, OperationType.WRITE, 'solutions/feedbacks');
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
