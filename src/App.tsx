import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { Search, Monitor, Terminal, Camera, RefreshCw, CheckCircle2, ChevronRight, Info, AlertTriangle, Cpu, HelpCircle, ArrowLeft, LogIn, LayoutDashboard, Database, Activity, Clock, ThumbsDown, MessageSquare, ThumbsUp, X, Image as ImageIcon, AlignLeft, Trophy, Medal, Smartphone } from 'lucide-react';
import { parseUserIssue, generateSolution, ParsedIssue, AISolution } from './services/aiService';
import { findKBMatch, submitFeedback, getAllSolutions, getInteractionsReport } from './services/kbService';
import { getDetailedOS } from './lib/osDetector';
import { cn } from './lib/utils';
import { collection, addDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, auth, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

import { CommandRunner } from './components/CommandRunner';

const SEARCH_PLACEHOLDERS = [
  "Describe your issue (e.g. 'Wi-Fi keeps dropping on Windows 11')",
  "Include error codes (e.g. 'Error code 0x80070005 on startup')",
  "Ask a how-to question (e.g. 'How to open activity monitor on mac')",
  "Provide specific symptoms (e.g. 'Ubuntu screen flashes black on boot')"
];

const parseStepText = (text: string, userOS: string) => {
  return (
    <div className="text-gray-700 leading-relaxed text-[15px] md:text-base [&>p]:mb-2 last:[&>p]:mb-0 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:mb-2 [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:mb-2">
      <Markdown
        components={{
          pre({children}: any) {
            return <div className="my-3 space-y-2">{children}</div>;
          },
          code({node, className, children, ...props}: any) {
            const match = /language-(\w+)/.exec(className || '');
            
            if (match) {
              const language = match[1];
              return <CommandRunner command={String(children).replace(/\n$/, '')} language={language} os={userOS} />;
            }
            return (
              <code className={cn("px-1.5 py-0.5 mx-0.5 bg-gray-100/80 border border-gray-200 rounded-md font-mono text-[0.9em] text-blue-700 break-words max-w-full", className)} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {text}
      </Markdown>
    </div>
  );
};

export default function App() {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDeep, setIsDeep] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const loadingMessages = [
    "Identifying Issue...",
    "Scanning error codes...",
    "Cross-referencing database...",
    "Generating simple steps...",
    "Formulating solution..."
  ];

  useEffect(() => {
    let interval: any;
    if (isLoading && !isDeep) {
      interval = setInterval(() => {
        setLoadingIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 1500);
    } else {
      setLoadingIndex(0);
    }
    return () => clearInterval(interval);
  }, [isLoading, isDeep]);

  const [stage, setStage] = useState<'search' | 'resolving' | 'solution' | 'dashboard'>('search');
  const [parsed, setParsed] = useState<ParsedIssue | null>(null);
  const [solution, setSolution] = useState<AISolution | null>(null);
  const [kbId, setKbId] = useState<string | null>(null);
  const [hasValidated, setHasValidated] = useState(false);
  const [userOS, setUserOS] = useState<'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'unknown'>('unknown');
  const [osDetails, setOsDetails] = useState<string | null>(null);
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [dashboardFilter, setDashboardFilter] = useState<'all' | 'macos' | 'windows' | 'linux' | 'android' | 'ios'>('all');
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [logText, setLogText] = useState<string>('');
  const [isLogPromptOpen, setIsLogPromptOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const startCamera = async (mode: 'user' | 'environment' = 'environment') => {
    // If stream exists, stop it first
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode } 
      });
      setCameraStream(stream);
      setFacingMode(mode);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraOpen(true);
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Failed to access camera. Please check permissions.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setIsCameraOpen(false);
  };

  const toggleCamera = () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    startCamera(nextMode);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/webp', 0.8);
        setImageBase64(dataUrl);
        stopCamera();
      }
    }
  };

  const [copiedCommand, setCopiedCommand] = useState(false);

  // Admin & Auth State
  const [user, setUser] = useState<User | null>(null);
  const [allSolutions, setAllSolutions] = useState<any[]>([]);
  const [allInteractions, setAllInteractions] = useState<any[]>([]);
  const [dashboardTab, setDashboardTab] = useState<'fixes' | 'reports'>('fixes');
  const isAdmin = user?.email === 'sigitsda71@gmail.com';

  const topContributors = React.useMemo(() => {
    const counts: Record<string, { count: number, name: string, photo: string }> = {};
    for (const sol of allSolutions) {
      if (sol.authorId && sol.authorName) {
        if (!counts[sol.authorId]) {
          counts[sol.authorId] = { count: 0, name: sol.authorName, photo: sol.authorPhoto || '' };
        }
        counts[sol.authorId].count += 1;
      }
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [allSolutions]);

  useEffect(() => {
    const initOS = async () => {
      const { baseOS, detailString } = await getDetailedOS();
      setUserOS(baseOS);
      setOsDetails(detailString);
    };
    initOS();

    const interval = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % SEARCH_PLACEHOLDERS.length);
    }, 4000);

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    const data = await getAllSolutions();
    setAllSolutions(data || []);
    
    if (isAdmin) {
      const reports = await getInteractionsReport();
      setAllInteractions(reports || []);
    }
    
    setStage('dashboard');
    setIsLoading(false);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert("Please upload an image file.");
        return;
    }

    setImageFile(file);

    const reader = new FileReader();
    reader.onload = (event) => {
      setImageBase64(event.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input so the same file can be selected again
  };

  const removeImage = () => {
    setImageFile(null);
    setImageBase64(null);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!query.trim() && !imageBase64) || isLoading) return;

    if (query.trim().toLowerCase() === '/admin') {
      try {
        await signInWithGoogle();
        setQuery('');
      } catch (err) {
        console.error(err);
      }
      return;
    }

    setIsLoading(true);
    setStage('resolving');
    setHasValidated(false);

    try {
      // 1. Parse Issue with platform hint
      const parsedInfo = await parseUserIssue(query, osDetails || userOS, imageBase64 || undefined, logText || undefined);
      setParsed(parsedInfo);

      if (!parsedInfo.isOSRelated) {
         setSolution({
             problemSummary: "Issue or Image Not OS Related",
             os: parsedInfo.os !== "unknown" ? parsedInfo.os : "windows",
             steps: [
                 "The provided query or image does not appear to be related to an operating system, computer, or device issue.",
                 "Please ensure you are asking about macOS, Windows, or Linux system configurations, errors, or troubleshooting.",
                 "If you attached an image or logs, please make sure it clearly shows the error message or software screen."
             ]
         });
         setStage('solution');
         
        // Log as failed/unrelated
         try {
           await addDoc(collection(db, 'interactions'), {
             query: parsedInfo.context || query,
             detectedOS: parsedInfo.os || userOS,
             osDetails: osDetails || null,
             intent: parsedInfo.intent || 'Not OS Related',
             status: 'failed',
             isDeep,
             hasImage: !!imageBase64,
             aiResponse: 'Not OS Related',
             createdAt: serverTimestamp(),
             userId: auth.currentUser?.uid || null
           });
         } catch (e) {
           console.error("Async log failed", e);
         }
         return;
      }

      // 2. Try KB Match
      let existingSolution: any = null;
      if (parsedInfo.os !== 'unknown') {
        existingSolution = await findKBMatch(parsedInfo.intent, parsedInfo.os);
      }

      // 3. Generate AI Solution (using KB match as base if found)
      const aiSolution = await generateSolution(parsedInfo, isDeep, existingSolution, logText || undefined);
      setSolution(aiSolution);
      setKbId(existingSolution ? existingSolution.id : null);
      
      setStage('solution');
      
      // 4. Log successful interaction
      try {
        await addDoc(collection(db, 'interactions'), {
          query: parsedInfo.context || query,
          detectedOS: aiSolution.os || parsedInfo.os || userOS,
          osDetails: osDetails || null,
          intent: parsedInfo.intent,
          status: 'solved',
          isDeep,
          hasImage: !!imageBase64,
          solutionId: existingSolution ? existingSolution.id : null,
          aiResponse: aiSolution.problemSummary || 'Generated Solution',
          createdAt: serverTimestamp(),
          userId: auth.currentUser?.uid || null
        });
      } catch (e) {
        console.error("Async log failed", e);
      }
    } catch (error) {
      console.error("Troubleshooting failed", error);
      // Fallback
      setStage('search');
    } finally {
      setIsLoading(false);
    }
  };

  const [feedbackView, setFeedbackView] = useState<'none' | 'options' | 'form'>('none');
  const [feedbackType, setFeedbackType] = useState<'worked' | 'confusing' | 'outdated' | 'failed' | null>(null);
  const [feedbackComments, setFeedbackComments] = useState('');

  const handleFeedback = async (type: 'worked' | 'confusing' | 'outdated' | 'failed', skipComments: boolean = false) => {
    setFeedbackType(type);
    if (type === 'worked' || skipComments) {
      if (hasValidated) return;
      setIsLoading(true);
      try {
        const newId = await submitFeedback(kbId, kbId ? null : solution, type, feedbackComments, user);
        if (newId && !kbId) {
          setKbId(newId);
        }
        setHasValidated(true);
        setFeedbackView('none');
      } catch (error) {
        console.error("Feedback submission failed", error);
      } finally {
        setIsLoading(false);
      }
    } else {
      setFeedbackView('form');
    }
  };

  const submitDetailedFeedback = () => {
    if (feedbackType) {
      handleFeedback(feedbackType, true);
    }
  };

  const reset = () => {
    setStage('search');
    setQuery('');
    setImageFile(null);
    setImageBase64(null);
    setLogText('');
    setIsLogPromptOpen(false);
    setParsed(null);
    setSolution(null);
    setKbId(null);
    setHasValidated(false);
    setIsDeep(false);
    setFeedbackView('none');
    setFeedbackType(null);
    setFeedbackComments('');
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-[#1A1A1A] font-sans selection:bg-blue-100 selection:text-blue-900">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-50/50 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[30%] h-[30%] bg-indigo-50/50 rounded-full blur-[100px]" />
      </div>

      <main className="relative z-10 max-w-5xl mx-auto px-6 py-20 lg:py-32">
        <AnimatePresence mode="wait">
          {stage === 'search' && (
            <motion.div
              key="search"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.4 }}
              className="space-y-12"
            >
              <div className="text-center space-y-4">
                <motion.div 
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="inline-flex p-3 bg-white border border-gray-100 rounded-2xl shadow-sm mb-4"
                >
                  <Monitor className="w-8 h-8 text-blue-600" />
                </motion.div>
                <h1 className="text-4xl md:text-5xl font-medium tracking-tight text-gray-900">
                  Brieftly
                </h1>
                <p className="text-lg text-gray-500 max-w-md mx-auto leading-relaxed">
                  Fix a problem or learn how to use your system. 
                  macOS, Windows, or Linux.
                </p>
                
                {userOS !== 'unknown' && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    Detected: {osDetails || (userOS.charAt(0).toUpperCase() + userOS.slice(1))}
                  </motion.div>
                )}
              </div>

              <form onSubmit={handleSearch} className="relative group space-y-5 flex flex-col items-center">
                  <div className="w-full flex-col flex items-center gap-0">
                    <div className="relative w-full">
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={SEARCH_PLACEHOLDERS[placeholderIdx]}
                        className="w-full h-16 pl-6 pr-16 bg-white border border-gray-200 rounded-2xl md:rounded-b-none md:border-b-0 shadow-[0_4px_24px_rgba(0,0,0,0.04)] focus:outline-none focus:ring-0 transition-all text-lg placeholder:text-gray-400 z-10 relative group-hover:border-gray-300 placeholder-transition"
                        id="search-input"
                      />
                      <div className="absolute right-3 top-3 flex items-center gap-2 z-20">
                        <button
                          type="submit"
                          disabled={(!query.trim() && !imageBase64 && !logText) || isLoading}
                          className="w-10 h-10 flex items-center justify-center bg-gray-900 text-white rounded-xl hover:bg-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
                          id="search-button"
                        >
                          <ArrowLeft className="w-5 h-5 rotate-180" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 py-3 bg-gray-50/50 border border-t border-gray-200 md:rounded-b-2xl rounded-2xl md:rounded-t-none text-sm -mt-1 md:mt-0 z-0 relative">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 font-medium mr-2 hidden sm:block text-xs uppercase tracking-wider">Context</span>
                        <button
                            type="button"
                            onClick={() => setIsLogPromptOpen(!isLogPromptOpen)}
                            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer border", isLogPromptOpen || logText ? "bg-white border-blue-200 text-blue-700 font-medium shadow-sm" : "bg-transparent border-transparent text-gray-500 hover:bg-white hover:border-gray-200 hover:text-gray-700")}
                        >
                            <AlignLeft className="w-4 h-4" />
                            <span>{logText ? 'Logs Added' : 'Paste Logs'}</span>
                        </button>
                        <label 
                            htmlFor="image-upload" 
                            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer border", imageBase64 ? "bg-white border-blue-200 text-blue-700 font-medium shadow-sm" : "bg-transparent border-transparent text-gray-500 hover:bg-white hover:border-gray-200 hover:text-gray-700")}
                        >
                            <ImageIcon className="w-4 h-4" />
                            <span>{imageBase64 ? 'Image Attached' : 'Attach Image'}</span>
                            <input 
                              id="image-upload" 
                              type="file" 
                              accept="image/png, image/jpeg, image/webp" 
                              className="hidden" 
                              onChange={handleImageChange}
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => startCamera()}
                            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors cursor-pointer border", isCameraOpen ? "bg-white border-blue-200 text-blue-700 font-medium shadow-sm" : "bg-transparent border-transparent text-gray-500 hover:bg-white hover:border-gray-200 hover:text-gray-700")}
                        >
                            <Camera className="w-4 h-4" />
                            <span>Take Photo</span>
                        </button>
                      </div>
                      <div className="hidden md:block w-px h-5 bg-gray-200 mx-2"></div>
                      <button
                        type="button"
                        onClick={() => setIsDeep(!isDeep)}
                        className={cn(
                          "flex items-center gap-2 text-sm font-medium transition-colors px-3 py-1.5 rounded-lg border",
                          isDeep ? "bg-white border-purple-200 text-purple-700 shadow-sm" : "bg-transparent border-transparent text-gray-500 hover:bg-white hover:border-gray-200 hover:text-gray-700"
                        )}
                        id="deep-thinking-toggle"
                      >
                        <Activity className="w-4 h-4" />
                        <span>High Reasoning Mode</span>
                      </button>
                    </div>
                  </div>

                {isLogPromptOpen && (
                  <div className="w-full flex flex-col items-start mt-2 px-2 animate-in fade-in slide-in-from-top-2">
                    <div className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm relative text-left transition-all">
                       <div className="flex justify-between items-center mb-2">
                         <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                           Error Codes & Details
                         </label>
                         <button
                           type="button"
                           onClick={() => setIsLogPromptOpen(false)}
                           className="text-gray-400 hover:text-gray-600"
                         >
                           <X className="w-4 h-4" />
                         </button>
                       </div>
                       <p className="text-xs text-gray-500 mb-2">If you see an exact error code (like 0x8007) or specific message, paste it here. No need to dig for system logs!</p>
                       <textarea
                         value={logText}
                         onChange={(e) => setLogText(e.target.value)}
                         placeholder="e.g. It says 'Access Denied' or 'Error code 43'..."
                         className="w-full h-24 p-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:outline-none resize-y"
                       />
                       
                       <div className="mt-4 pt-5 border-t border-gray-100">
                         <div className={cn("bg-gradient-to-br from-indigo-50/50 to-blue-50/40 border border-indigo-100/60 rounded-xl p-4 shadow-sm", (userOS === 'android' || userOS === 'ios') && "hidden")}>
                           <div className="flex items-center gap-2 mb-3">
                              <div className="bg-indigo-100 p-1.5 rounded-md">
                                <Terminal className="w-4 h-4 text-indigo-700" />
                              </div>
                              <span className="text-sm font-semibold text-indigo-900">Can't find the error? Auto-fetch it</span>
                           </div>
                           
                           <div className="space-y-4">
                             <p className="text-[13px] text-indigo-900/70 leading-relaxed">
                               Web browsers cannot run system commands directly for your security. 
                               Follow these steps to automatically grab recent errors:
                             </p>

                             <div className="space-y-3">
                               <div className="flex gap-3 items-start">
                                 <div className="flex-none flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs mt-0.5">1</div>
                                 <div className="text-[13px] text-indigo-950/80 pt-0.5">
                                    {userOS === 'windows' && <span>Press <kbd className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[11px] font-semibold shadow-sm text-gray-700">Win + R</kbd>, type <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-100 text-indigo-700 font-mono text-[11px]">powershell</code>, and press <kbd className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[11px] font-semibold shadow-sm text-gray-700">Enter</kbd>.</span>}
                                    {userOS === 'macos' && <span>Press <kbd className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[11px] font-semibold shadow-sm text-gray-700">Command (⌘) + Space</kbd>, type <code className="bg-white px-1.5 py-0.5 rounded border border-indigo-100 text-indigo-700 font-mono text-[11px]">Terminal</code>, and press <kbd className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[11px] font-semibold shadow-sm text-gray-700">Return</kbd>.</span>}
                                    {userOS === 'linux' && <span>Press <kbd className="px-1.5 py-0.5 bg-white border border-indigo-200 rounded text-[11px] font-semibold shadow-sm text-gray-700">Ctrl + Alt + T</kbd> to open your Terminal window.</span>}
                                    {userOS === 'unknown' && <span>Open your computer's command terminal app.</span>}
                                 </div>
                               </div>

                               <div className="flex gap-3 items-start">
                                 <div className="flex-none flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs mt-0.5">2</div>
                                 <div className="text-[13px] text-indigo-950/80 pt-0.5 min-w-0 flex-1">
                                   <span className="block mb-2">Copy this command and run it to put recent errors in your clipboard:</span>
                                   
                                   <div className="bg-gray-900 rounded-lg flex items-center justify-between gap-3 font-mono text-[11px] text-gray-200 border border-gray-800 p-1.5 pl-3 shadow-inner">
                                      <div className="overflow-x-auto whitespace-nowrap flex-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent pb-0.5">
                                        <code className="block select-all">
                                          {userOS === 'windows' ? "Get-WinEvent -FilterHashtable @{LogName='System','Application'; Level=2} -MaxEvents 15 | Format-List | clip" : 
                                           userOS === 'macos' ? "log show --predicate 'eventMessage contains[c] \"error\" or eventMessage contains[c] \"fail\"' --info --last 15m | tail -n 50 | pbcopy" : 
                                           "journalctl -p 0..3 -xb --since \"15 min ago\" | tail -n 20"}
                                        </code>
                                      </div>
                                      <button 
                                        type="button"
                                        onClick={async () => {
                                          const cmd = userOS === 'windows' ? "Get-WinEvent -FilterHashtable @{LogName='System','Application'; Level=2} -MaxEvents 15 | Format-List | clip" : 
                                           userOS === 'macos' ? "log show --predicate 'eventMessage contains[c] \"error\" or eventMessage contains[c] \"fail\"' --info --last 15m | tail -n 50 | pbcopy" : 
                                           "journalctl -p 0..3 -xb --since \"15 min ago\" | tail -n 20";
                                          try {
                                            await navigator.clipboard.writeText(cmd);
                                            setCopiedCommand(true);
                                            setTimeout(() => setCopiedCommand(false), 2000);
                                          } catch (err) {
                                            console.error("Failed to copy", err);
                                            const textArea = document.createElement("textarea");
                                            textArea.value = cmd;
                                            document.body.appendChild(textArea);
                                            textArea.select();
                                            try {
                                              document.execCommand('copy');
                                              setCopiedCommand(true);
                                              setTimeout(() => setCopiedCommand(false), 2000);
                                            } catch (err2) {
                                              console.error("Fallback copy failed", err2);
                                            }
                                            document.body.removeChild(textArea);
                                          }
                                        }}
                                        className="flex-none text-white font-sans font-medium bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap border border-gray-700"
                                      >
                                        {copiedCommand ? 'Copied!' : 'Copy'}
                                      </button>
                                    </div>
                                 </div>
                               </div>

                               <div className="flex gap-3 items-start">
                                 <div className="flex-none flex items-center justify-center w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs mt-0.5">3</div>
                                 <div className="text-[13px] text-indigo-950/80 pt-1.5">
                                    Paste the results in the text box above!
                                 </div>
                               </div>
                             </div>
                           </div>
                         </div>
                       </div>

                       {logText && (
                         <div className="mt-3 flex justify-end">
                           <button type="button" onClick={() => setLogText('')} className="text-xs text-red-500 hover:text-red-600 font-medium">Clear</button>
                         </div>
                       )}
                    </div>
                  </div>
                )}
                
                {imageBase64 && (
                  <div className="w-full flex items-center justify-start mt-4 px-2">
                     <div className="relative inline-block border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                       <img src={imageBase64} alt="Uploaded issue" className="h-20 w-max object-cover opacity-90" />
                       <button
                         type="button"
                         onClick={removeImage}
                         className="absolute top-1 right-1 bg-black/50 hover:bg-black text-white p-1 rounded-full backdrop-blur transition-all"
                         title="Remove image"
                       >
                         <X className="w-3 h-3" />
                       </button>
                     </div>
                  </div>
                )}
                
                <div className="w-full text-center pt-2 text-[13.5px] text-gray-500 flex flex-col md:flex-row items-center justify-center gap-1.5 opacity-90 select-none">
                  <span className="flex items-center gap-1.5 font-medium text-gray-600"><Info className="w-4 h-4 text-blue-500" /> Quick Tip:</span>
                  <span>Include <strong className="text-gray-700">error codes</strong> or attach <strong className="text-gray-700">logs</strong> for the best answers.</span>
                </div>

                {isCameraOpen && (
                  <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-4">
                    <div className="relative w-full max-w-2xl bg-black rounded-3xl overflow-hidden shadow-2xl border border-white/10">
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        playsInline 
                        className="w-full h-auto aspect-video object-cover"
                      />
                      <canvas ref={canvasRef} className="hidden" />
                      
                      <div className="absolute bottom-0 inset-x-0 p-6 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between">
                        <button
                          type="button"
                          onClick={stopCamera}
                          className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-md"
                        >
                          <X className="w-6 h-6" />
                        </button>
                        
                        <button
                          type="button"
                          onClick={takePhoto}
                          className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform border-4 border-gray-300"
                        >
                          <div className="w-12 h-12 rounded-full border-2 border-black/10" />
                        </button>
                        
                        <button
                          type="button"
                          onClick={toggleCamera}
                          className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-md"
                        >
                          <RefreshCw className="w-6 h-6" />
                        </button>
                      </div>
                    </div>
                    <p className="text-white/60 text-sm mt-4 font-medium">Align the error message or screen within the frame</p>
                  </div>
                )}

              </form>

              <div className="flex flex-wrap justify-center gap-3 pt-4">
                {(() => {
                  const questions = {
                    macos: [
                      "How to open Activity Monitor?",
                      "How to flush DNS cache?",
                      "How to force quit an application?",
                      "How to show hidden files?",
                      "How to reset SMC and NVRAM?"
                    ],
                    windows: [
                      "How to open Task Manager?",
                      "How to clear temporary files?",
                      "How to fix Windows Update error?",
                      "How to boot into Safe Mode?",
                      "How to disable startup programs?"
                    ],
                    linux: [
                      "How to list running services?",
                      "How to check disk space?",
                      "How to update all packages?",
                      "How to kill a process by name?",
                      "How to change folder permissions?"
                    ],
                    unknown: [
                      "How to clear browser cache?",
                      "How to find my IP address?",
                      "How to test internet speed?",
                      "How to take a screenshot?",
                      "How to fix slow computer?"
                    ]
                  };
                  
                  const osKey = userOS === 'unknown' ? 'unknown' : userOS;
                  const currentQuestions = questions[osKey as keyof typeof questions] || questions.unknown;
                  
                  return currentQuestions.map((q) => (
                    <button
                      key={q}
                      onClick={() => setQuery(q)}
                      className="px-4 py-2 bg-white border border-gray-100 rounded-full text-sm text-gray-600 hover:border-gray-200 hover:bg-gray-50 transition-all animate-in fade-in slide-in-from-bottom-1"
                    >
                      {q}
                    </button>
                  ));
                })()}
              </div>
            </motion.div>
          )}

          {stage === 'resolving' && (
            <motion.div
              key="resolving"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-20 space-y-8"
            >
              <div className="relative">
                <div className="w-20 h-20 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Terminal className="w-8 h-8 text-blue-600/30" />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-xl font-medium text-gray-900 transition-all duration-300">
                  {isDeep ? "Deeply Analyzing Scenario..." : loadingMessages[loadingIndex]}
                </h2>
                <p className="text-gray-500 animate-pulse transition-all duration-300">
                  {isDeep ? "Using high-reasoning models for advanced troubleshooting" : "Detecting OS and checking Knowledge Base"}
                </p>
              </div>
            </motion.div>
          )}

          {stage === 'solution' && solution && parsed && (
            <motion.div
              key="solution"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between mb-8">
                <button 
                  onClick={reset}
                  className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black transition-colors"
                  id="back-button"
                >
                  <ArrowLeft className="w-4 h-4" />
                  New Troubleshooting
                </button>
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold uppercase tracking-wider">
                  <Cpu className="w-3 h-3" />
                  Target System: {parsed.os}
                </div>
              </div>

              <div className="p-8 bg-white border border-gray-100 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.04)] space-y-10">
                <div className="space-y-3">
                  <div className="flex items-start gap-4">
                     <div className="p-2 bg-gray-50 rounded-lg">
                        <Terminal className="w-6 h-6 text-gray-600" />
                     </div>
                     <div>
                        <h3 className="text-2xl font-semibold text-gray-900 leading-tight">
                          {solution.problemSummary}
                        </h3>
                        {kbId && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded mt-2 shadow-sm">
                            <Cpu className="w-3 h-3" />
                            AI Enhanced from Knowledge Base
                          </span>
                        )}
                     </div>
                  </div>
                </div>

                <div className="space-y-6">
                  {solution.explanation && (
                    <div className="p-5 md:p-6 bg-gradient-to-br from-indigo-50/80 to-blue-50/50 border border-indigo-100/60 rounded-2xl space-y-3 shadow-sm">
                      <div className="flex items-center gap-2 text-indigo-700">
                        <Activity className="w-5 h-5" />
                        <span className="text-xs font-bold uppercase tracking-wider">Deep Analysis & Explanation</span>
                      </div>
                      <div className="text-[15px] text-indigo-950/80 leading-relaxed [&_strong]:font-semibold [&_strong]:text-indigo-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:bg-indigo-100/50 [&_code]:rounded-md [&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-indigo-800 [&_p]:mb-3 last:[&_p]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3">
                        <Markdown>{solution.explanation}</Markdown>
                      </div>
                    </div>
                  )}

                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                    Resolution Steps
                  </h4>
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-4 before:-translate-x-px md:before:ml-6 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
                    {solution.steps.map((step, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="relative flex items-start gap-3 md:gap-4 group"
                      >
                        <div className="flex-shrink-0 w-8 h-8 md:w-12 md:h-12 flex items-center justify-center bg-white border-2 border-gray-100 text-gray-400 rounded-2xl font-bold text-base md:text-lg shadow-sm group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-600 transition-all z-10 relative">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0 pt-1 md:pt-2.5">
                          <div className="p-4 md:p-5 bg-white border border-gray-100 rounded-2xl shadow-sm group-hover:border-gray-200 group-hover:shadow-md transition-all">
                             <div className="text-gray-700 leading-relaxed text-[15px] md:text-base">
                               {parseStepText(step, userOS)}
                             </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="pt-8 border-t border-gray-50">
                  {hasValidated ? (
                    <div className="flex items-center justify-between gap-6 p-4 bg-green-50 rounded-2xl border border-green-100">
                      <div className="flex items-center gap-3 text-green-700 font-medium">
                        <CheckCircle2 className="w-5 h-5" />
                        Thank you! Your feedback makes {solution.os} support smarter.
                      </div>
                    </div>
                  ) : feedbackView === 'none' ? (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                      <p className="text-sm text-gray-500 italic flex-1">
                        Was this helpful? Your validation makes {solution.os} support smarter for everyone.
                      </p>
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <button
                          onClick={() => setFeedbackView('options')}
                          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium transition-all text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 flex-1 sm:flex-none"
                          disabled={isLoading}
                        >
                          <MessageSquare className="w-4 h-4" />
                          Give Feedback
                        </button>
                        <button
                          onClick={() => handleFeedback('worked')}
                          className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl font-medium transition-all shadow-sm bg-blue-600 text-white hover:bg-blue-700 active:scale-95 flex-1 sm:flex-none"
                          disabled={isLoading}
                          id="validate-button"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          It Worked
                        </button>
                      </div>
                    </div>
                  ) : feedbackView === 'options' ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                       <div className="flex items-center justify-between">
                         <h5 className="font-medium text-gray-900">What was wrong with this solution?</h5>
                         <button onClick={() => setFeedbackView('none')} className="text-gray-400 hover:text-gray-600">
                           <X className="w-5 h-5" />
                         </button>
                       </div>
              <div className="flex flex-col sm:flex-row gap-3">
                 <button onClick={() => handleFeedback('confusing')} className="flex-1 flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all text-sm text-gray-700 font-medium justify-center text-center">
                   <AlertTriangle className="w-4 h-4 text-orange-400" />
                   Confusing steps
                 </button>
                 <button onClick={() => handleFeedback('outdated')} className="flex-1 flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all text-sm text-gray-700 font-medium justify-center text-center">
                   <Clock className="w-4 h-4 text-yellow-500" />
                   Outdated info
                 </button>
                 <button onClick={() => handleFeedback('failed')} className="flex-1 flex items-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-all text-sm text-gray-700 font-medium justify-center text-center">
                   <ThumbsDown className="w-4 h-4 text-red-400" />
                   Didn't work
                 </button>
              </div>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                       <div className="flex items-center justify-between">
                         <h5 className="font-medium text-gray-900">Optional: Add more details</h5>
                         <button onClick={() => setFeedbackView('options')} className="text-gray-400 hover:text-gray-600">
                           <X className="w-5 h-5" />
                         </button>
                       </div>
                       <textarea
                         value={feedbackComments}
                         onChange={(e) => setFeedbackComments(e.target.value)}
                         placeholder="Which part didn't work as expected?"
                         className="w-full min-h-[100px] p-4 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all resize-y"
                       />
                       <div className="flex justify-end gap-3">
                         <button onClick={() => handleFeedback(feedbackType as any, true)} disabled={isLoading} className="px-5 py-2 rounded-lg font-medium text-gray-600 hover:bg-gray-100 transition-colors text-sm">
                           Skip
                         </button>
                         <button onClick={submitDetailedFeedback} disabled={isLoading || !feedbackComments.trim()} className="px-5 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm shadow-sm">
                           Submit Feedback
                         </button>
                       </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="p-5 bg-gray-50 border border-gray-100 rounded-2xl space-y-2 h-full">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Info className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-wider">Detection Details</span>
                    </div>
                    <p className="text-sm text-gray-600">
                      <span className="font-semibold">Intent:</span> {parsed.intent}
                    </p>
                    <p className="text-sm text-gray-600">
                      <span className="font-semibold">Context:</span> {parsed.context}
                    </p>
                  </div>
                </div>
                <div className="space-y-4 flex flex-col h-full">
                  <div className="p-5 bg-orange-50/30 border border-orange-100/50 rounded-2xl space-y-2 flex-grow">
                    <div className="flex items-center gap-2 text-orange-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-wider">AI Safety Note</span>
                    </div>
                    <p className="text-sm text-orange-800/80 leading-snug">
                      Always verify backup status before executing system commands or modifying configuration files.
                    </p>
                  </div>
                  {imageBase64 && (
                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-4 flex-none">
                       <ImageIcon className="w-5 h-5 text-gray-400 flex-none" />
                       <span className="text-sm text-gray-600 flex-1 truncate">Image Uploaded</span>
                       <img src={imageBase64} className="h-10 w-auto rounded border border-gray-200" alt="Provided context" />
                    </div>
                  )}
                  {logText && (
                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-2xl flex items-center gap-4 flex-none">
                       <AlignLeft className="w-5 h-5 text-gray-400 flex-none" />
                       <span className="text-sm text-gray-600 flex-1 truncate">Details Provided</span>
                       <div className="h-10 px-3 bg-gray-200 rounded border border-gray-300 flex items-center justify-center">
                         <span className="text-xs text-gray-500 font-mono">TEXT</span>
                       </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
          {stage === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <button 
                  onClick={() => setStage('search')}
                  className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-black"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Search
                </button>
                <h2 className="text-2xl font-semibold flex items-center gap-2 text-gray-900">
                  <Database className="w-6 h-6 text-blue-600" />
                  Community Solutions Library
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm space-y-2">
                  <div className="flex items-center gap-2 text-gray-500">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Problems Solved</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">{allSolutions.length}</p>
                </div>
                <div className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm space-y-2">
                  <div className="flex items-center gap-2 text-gray-500">
                    <Activity className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Frequently Used Fixes</span>
                  </div>
                  <p className="text-3xl font-bold text-blue-600">
                    {allSolutions.filter(s => s.validatedCount > 1).length}
                  </p>
                </div>
                <div className="p-6 bg-white border border-gray-100 rounded-3xl shadow-sm space-y-2">
                  <div className="flex items-center gap-2 text-gray-500">
                    <ThumbsUp className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Average Helpful Votes</span>
                  </div>
                  <p className="text-3xl font-bold text-gray-900">
                    {(allSolutions.reduce((acc, s) => acc + (s.validatedCount || 0), 0) / (allSolutions.length || 1)).toFixed(1)}
                  </p>
                </div>
              </div>

              {topContributors.length > 0 && (
                <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100/50 rounded-3xl overflow-hidden shadow-sm p-6">
                  <div className="flex flex-col md:flex-row md:items-center gap-6">
                    <div className="md:w-1/3 space-y-2 lg:pr-6 md:border-r border-amber-200/50">
                      <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mb-4">
                        <Trophy className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-bold text-amber-900">Top Contributors</h3>
                      <p className="text-sm text-amber-700/80">
                        Thank you to our community leaders for providing verified and helpful fixes for everyone!
                      </p>
                    </div>
                    
                    <div className="md:w-2/3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {topContributors.map((contributor, idx) => (
                        <div key={idx} className="flex items-center gap-3 bg-white/60 hover:bg-white/80 transition-colors border border-amber-100/30 p-3 rounded-2xl">
                          <div className="relative">
                            {contributor.photo ? (
                              <img src={contributor.photo} alt={contributor.name} className="w-10 h-10 rounded-full" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center font-bold">
                                {contributor.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            {idx === 0 && (
                              <div className="absolute -top-1 -right-1 bg-yellow-400 text-white rounded-full p-0.5 shadow-sm">
                                <Medal className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="text-amber-900 font-bold text-sm leading-tight truncate max-w-[100px]" title={contributor.name}>
                              {contributor.name}
                            </p>
                            <span className="text-xs font-medium text-amber-700/70 border border-amber-200 px-1.5 py-0.5 rounded-md mt-1 inline-block">
                              {contributor.count} fixes
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {isAdmin && (
                <div className="flex bg-gray-200/60 p-1 rounded-xl w-fit mb-4">
                  <button 
                    onClick={() => setDashboardTab('fixes')}
                    className={cn(
                      "px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-200", 
                      dashboardTab === 'fixes' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Community Fixes
                  </button>
                  <button 
                    onClick={() => setDashboardTab('reports')}
                    className={cn(
                      "px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-200", 
                      dashboardTab === 'reports' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    Admin Reports
                  </button>
                </div>
              )}

              {dashboardTab === 'fixes' ? (
              <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-50/50">
                  <h3 className="font-semibold text-gray-900 text-lg">Browse Community Fixes</h3>
                  
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <div className="relative w-full sm:w-64">
                       <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                       <input 
                         type="text" 
                         className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors shadow-sm"
                         placeholder="Search solutions..."
                         value={dashboardSearch}
                         onChange={(e) => setDashboardSearch(e.target.value)}
                       />
                    </div>
                    <div className="flex bg-gray-200/60 p-1 rounded-xl w-full sm:w-auto overflow-x-auto scrollbar-hide">
                       {(['all', 'macos', 'windows', 'linux'] as const).map(f => (
                         <button 
                           key={f}
                           onClick={() => setDashboardFilter(f)}
                           className={cn(
                             "px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200", 
                             dashboardFilter === f 
                               ? "bg-white text-gray-900 shadow-sm" 
                               : "text-gray-500 hover:text-gray-700"
                           )}
                         >
                           {f === 'all' ? 'All OS' : f === 'macos' ? 'Mac' : f === 'windows' ? 'Windows' : 'Linux'}
                         </button>
                       ))}
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {allSolutions
                    .filter(s => {
                      if (dashboardFilter !== 'all' && s.os !== dashboardFilter) return false;
                      if (dashboardSearch.trim()) {
                        const term = dashboardSearch.toLowerCase();
                        return (s.problemSummary || '').toLowerCase().includes(term) || 
                               (s.steps || []).join(' ').toLowerCase().includes(term);
                      }
                      return true;
                    })
                    .sort((a, b) => (b.validatedCount || 0) - (a.validatedCount || 0))
                    .map((s, idx) => (
                    <details key={idx} className="group p-6 hover:bg-gray-50 transition-colors">
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-4">
                        <div className="space-y-1 flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <span className={cn(
                              "px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-md w-fit flex items-center gap-1",
                              s.os === 'macos' ? "bg-slate-100 text-slate-600" :
                              s.os === 'windows' ? "bg-blue-100 text-blue-600" :
                              (s.os === 'android' || s.os === 'ios') ? "bg-green-100 text-green-700" :
                              "bg-orange-100 text-orange-600"
                            )}>
                              {s.os === 'macos' && <Monitor className="w-3 h-3" />}
                              {s.os === 'windows' && <LayoutDashboard className="w-3 h-3" />}
                              {s.os === 'linux' && <Terminal className="w-3 h-3" />}
                              {(s.os === 'android' || s.os === 'ios') && <Smartphone className="w-3 h-3" />}
                              {s.os === 'macos' ? 'Mac' : s.os === 'windows' ? 'Windows' : s.os === 'linux' ? 'Linux' : s.os === 'android' ? 'Android' : s.os === 'ios' ? 'iOS' : s.os}
                            </span>
                            <h4 className="font-semibold text-gray-900 text-base">{s.problemSummary}</h4>
                          </div>
                          <p className="text-sm text-gray-500 line-clamp-1">
                            {s.steps && s.steps.length > 0 ? s.steps[0] : 'Solution available inside.'}
                          </p>
                        </div>
                        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 sm:gap-4">
                          <div className="flex items-center gap-1.5 text-green-700 bg-green-100 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {s.validatedCount} fixed
                          </div>
                          <ChevronRight className="w-5 h-5 text-gray-400 group-open:rotate-90 transition-transform hidden sm:block" />
                        </div>
                      </summary>
                      <div className="mt-4 pt-5 border-t border-gray-100 pl-2 lg:pl-10">
                        <div className="bg-gray-50 rounded-2xl p-5 border border-gray-200/60 shadow-sm">
                          <h5 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            Steps to fix this issue
                          </h5>
                          <ol className="list-decimal pl-5 space-y-3 test-sm text-gray-700">
                            {s.steps && s.steps.map((step: string, i: number) => (
                              <li key={i} className="pl-1 leading-relaxed">
                                <Markdown
                                  components={{
                                    pre({children}: any) {
                                      return <div className="my-2">{children}</div>;
                                    },
                                    code({node, className, children, ...props}: any) {
                                      const match = /language-(\w+)/.exec(className || '');
                                      if (match) {
                                        return <div className="bg-gray-900 text-gray-100 p-3 rounded-xl font-mono text-[0.9em] overflow-x-auto border border-gray-800 shadow-inner">{children}</div>;
                                      }
                                      return (
                                        <code className="px-1.5 py-0.5 mx-0.5 bg-gray-200/60 border border-gray-300 rounded font-mono text-[0.9em] text-blue-800 break-words" {...props}>
                                          {children}
                                        </code>
                                      )
                                    }
                                  }}
                                >
                                  {step}
                                </Markdown>
                              </li>
                            ))}
                          </ol>
                        </div>
                        <div className="mt-4 text-xs text-gray-400 flex items-center gap-4">
                          <span>Updated {new Date(s.updatedAt?.seconds * 1000).toLocaleDateString()}</span>
                          {s.authorName && (
                            <span className="flex items-center gap-1.5">
                              Fixed by <strong className="text-gray-600">{s.authorName}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                    </details>
                  ))}
                  {allSolutions.length === 0 && (
                    <div className="p-12 flex flex-col items-center justify-center text-center">
                       <Database className="w-12 h-12 text-gray-200 mb-4" />
                       <p className="text-gray-500 font-medium text-lg">No Community Fixes Yet</p>
                       <p className="text-gray-400 text-sm mt-1 max-w-sm">Be the first to search for a problem and submit a working fix to the Knowledge Base.</p>
                    </div>
                  )}
                  {allSolutions.length > 0 && allSolutions.filter(s => {
                      if (dashboardFilter !== 'all' && s.os !== dashboardFilter) return false;
                      if (dashboardSearch.trim()) {
                        const term = dashboardSearch.toLowerCase();
                        return (s.problemSummary || '').toLowerCase().includes(term) || 
                               (s.steps || []).join(' ').toLowerCase().includes(term);
                      }
                      return true;
                    }).length === 0 && (
                    <div className="p-12 flex flex-col items-center justify-center text-center">
                       <Search className="w-12 h-12 text-gray-200 mb-4" />
                       <p className="text-gray-500 font-medium text-lg">No matching fixes found</p>
                       <p className="text-gray-400 text-sm mt-1 max-w-sm">Try adjusting your search filters to find what you're looking for.</p>
                       <button onClick={() => { setDashboardSearch(''); setDashboardFilter('all'); }} className="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm">Clear Filters</button>
                    </div>
                  )}
                </div>
              </div>
              ) : (
              <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-sm">
                <div className="p-6 border-b border-gray-50 flex flex-col gap-2 bg-gray-50/50">
                   <h3 className="font-semibold text-gray-900 text-lg">Admin View: Recent User Queries</h3>
                   <p className="text-sm text-gray-500">A detailed log of recent questions by users and their detected OS problems. Use this to identify recurring issues or share with manufacturers.</p>
                </div>
                <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
                    {allInteractions.length === 0 ? (
                       <div className="p-12 flex flex-col items-center justify-center text-center">
                         <Activity className="w-12 h-12 text-gray-200 mb-4" />
                         <p className="text-gray-500 font-medium text-lg">No interaction data yet</p>
                       </div>
                    ) : allInteractions.map((interaction, idx) => (
                       <div key={idx} className="p-5 hover:bg-gray-50 transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                   "px-2.5 py-0.5 text-[11px] font-bold uppercase rounded-md w-fit flex items-center gap-1",
                                   interaction.detectedOS === 'macos' ? "bg-slate-100 text-slate-600" :
                                   interaction.detectedOS === 'windows' ? "bg-blue-100 text-blue-600" :
                                   interaction.detectedOS === 'linux' ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-600"
                                 )}>
                                   {interaction.detectedOS === 'macos' ? 'Mac' : interaction.detectedOS === 'windows' ? 'Windows' : interaction.detectedOS === 'linux' ? 'Linux' : 'Unknown OS'}
                                </span>
                                <span className={cn(
                                  "px-2 py-0.5 text-[10px] font-bold uppercase rounded w-fit",
                                  interaction.status === 'solved' ? "bg-green-100 text-green-700" :
                                  interaction.status === 'failed' ? "bg-red-100 text-red-700" :
                                  "bg-gray-100 text-gray-600"
                                )}>
                                  {interaction.status || 'pending'}
                                </span>
                            </div>
                            <span className="text-xs font-medium text-gray-400 whitespace-nowrap">
                              {interaction.createdAt ? new Date(interaction.createdAt.seconds * 1000).toLocaleString() : ''}
                            </span>
                          </div>
                          <div className="mb-2">
                             <h4 className="font-semibold text-gray-900 line-clamp-2">"{interaction.query}"</h4>
                          </div>
                          <div className="bg-gray-100/50 p-3 rounded-xl border border-gray-100">
                             <div className="text-xs text-gray-500 font-medium tracking-wider uppercase mb-1">Detected Intent / Problem</div>
                             <p className="text-sm text-gray-700">{interaction.intent || 'Unclassified'}</p>
                          </div>
                       </div>
                    ))}
                </div>
              </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="relative z-10 py-12 border-t border-gray-100 mt-auto">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-gray-400">
          <div className="flex flex-col gap-1 items-center md:items-start">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4" />
              <span>Community Solutions Library</span>
            </div>
            <button 
              onClick={fetchDashboardData}
              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-700 font-medium mt-2"
              id="public-dashboard-link"
            >
              Browse Fixes
            </button>
          </div>
          
          <div className="flex items-center gap-6">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs">{user.email}</span>
                <button onClick={() => auth.signOut()} className="text-xs hover:text-gray-900 underline">Sign Out</button>
              </div>
            ) : (
              <button 
                onClick={async () => {
                  try {
                    await signInWithGoogle();
                  } catch (e) {
                    console.error(e);
                  }
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
                title="Sign in to appear on the leaderboard when your fixes help others!"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign in to contribute
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
