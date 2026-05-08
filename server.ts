import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

const configTools: any[] = [
  { googleSearch: {} }
];

const callOpenRouter = async (model: string, systemPrompt: string, userMessage: any, responseFormat?: string) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OpenRouter API Key is missing");

  console.log(`[AI Server] Fallback to OpenRouter using model: ${model}`);
  const body: any = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ]
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3001",
      "X-Title": "Brieftly IT Assistant",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`OpenRouter Error: ${await res.text()}`);
  }

  const data = await res.json();
  console.log(`[AI Server] OpenRouter request successful`);
  return data.choices[0].message.content;
};

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3001;

  app.use(express.json({ limit: '50mb' }));

  // --- AI ENDPOINTS ---
  app.post("/api/ai/parse", async (req, res) => {
    console.log(`\n[AI Server] --- New Issue Parsing Request ---`);
    const { query, clientHint, imageBase64, logsText } = req.body;
    
    const contents: any[] = [];
    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
      if (match) {
        console.log(`[AI Server] Image attachment detected`);
        contents.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }

    contents.push(`
      Analyze this IT request: "${query}"
      User's current platform: ${clientHint || "unknown"}
      ${logsText ? `Provided System Logs: ${logsText}\n` : ""}
      
      Tasks:
      1. Determine if the request (and image or logs, if provided) is OS system related (e.g., related to computers, devices, software issues). Determine this and set 'isOSRelated' boolean.
      2. Determine the TARGET operating system (macos, windows, linux, android, ios). Use the platform hint if ambiguous. Or 'unknown'.
      3. Classify the 'queryType': 
         - 'troubleshoot' for errors, bugs, or things not working.
         - 'how-to' for learning how to access settings, tools, or perform general tasks.
      4. Extract the 'intent' (e.g., 'terminal access', 'driver update') and 'context'. IF an image or logs are provided, extract context from them. 
      5. CRITICAL PRIVACY PRECAUTION: You MUST rigorously scrub any Personally Identifiable Information (PII) from the extracted 'intent' and 'context'. Replace any found email, name, person address, gender, race, or phone number with a generic placeholder (e.g., [REDACTED EMAIL], [REDACTED NAME]). Never store sensitive data.
    `);    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
      if (match) {
        console.log(`[AI Server] Image attachment detected (${match[1]})`);
        contents.push({ inlineData: { mimeType: match[1], data: match[2] } });
      } else {
        console.warn(`[AI Server] Image provided but failed regex match. Length: ${imageBase64.length}`);
      }
    }

    try {
      const modelName = process.env.GEMINI_MODEL_STANDARD!;
      console.log(`[AI Server] Attempting Gemini (${modelName})...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isOSRelated: { type: Type.BOOLEAN, description: "Whether the issue and/or image is related to operating systems, computers, or devices." },
              os: { type: Type.STRING, enum: ["macos", "windows", "linux", "android", "ios", "unknown"] },
              queryType: { type: Type.STRING, enum: ["troubleshoot", "how-to"] },
              intent: { type: Type.STRING },
              context: { type: Type.STRING },
              severity: { type: Type.STRING, enum: ["low", "medium", "high"] }
            },
            required: ["isOSRelated", "os", "queryType", "intent", "context", "severity"]
          }
        }
      });

      console.log(`[AI Server] Gemini parsing successful`);
      res.json(JSON.parse(response.text.trim()));
    } catch (e: any) {
      console.warn(`[AI Server] Gemini failed: ${e.message}`);
      
      const hasImage = !!(imageBase64 && imageBase64.length > 20);
      const openRouterModel = hasImage ? process.env.OPENROUTER_MODEL_OCR! : process.env.OPENROUTER_MODEL_STANDARD!;
      
      console.log(`[AI Server] Fallback decision - hasImage: ${hasImage}, using model: ${openRouterModel}`);

      const systemPrompt = `You must output strictly valid JSON matching this schema: 
 { "isOSRelated": boolean, "os": "macos" | "windows" | "linux" | "android" | "ios" | "unknown", "queryType": "troubleshoot" | "how-to", "intent": "string", "context": "string", "severity": "low" | "medium" | "high" }
 Return ONLY JSON without markdown wrapping.`;
      
      let userMessageContent: any[] = [{ type: "text", text: contents[contents.length - 1] as string }];
      if (imageBase64) {
        userMessageContent.push({ type: "image_url", image_url: { url: imageBase64 } });
      }

      try {
        const orResponse = await callOpenRouter(openRouterModel, systemPrompt, userMessageContent, "json_object");
        // Robustly extract JSON object if the model was chatty or used markdown
        const jsonMatch = orResponse.match(/\{[\s\S]*\}/);
        const cleanJson = (jsonMatch ? jsonMatch[0] : orResponse).trim();
        res.json(JSON.parse(cleanJson));
      } catch (orError: any) {
        console.error(`[AI Server] OpenRouter fallback failed: ${orError.message}`);
        res.json({ isOSRelated: true, os: "unknown", queryType: "troubleshoot", intent: "general", context: query, severity: "medium" });
      }
    }
  });

  app.post("/api/ai/generate", async (req, res) => {
    console.log(`\n[AI Server] --- New Solution Generation Request ---`);
    const { parsed, isDeep, kbReference, logsText, imageBase64 } = req.body;
    
    console.log(`[AI Server] Deep Mode: ${isDeep}, Target OS: ${parsed.os}`);

    const contents: any[] = [];
    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
      if (match) {
        contents.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }

    const basePersona = `You are the core AI Support Concierge for "Brieftly," a frictionless, public-facing IT platform.
Your Scope: Strictly handle device troubleshooting, OS-level configurations, and instructional "how-to" queries exclusively for macOS, Windows, Linux, Android, and iOS.
Your Persona & Tone: Highly skilled, patient, and empathetic Senior IT System Administrator. Use extremely simple, everyday language. Avoid all technical jargon unless absolutely necessary to identify an item on the screen. Assume the user has zero IT knowledge. 
Break down complex ideas into relatable analogies if needed. Be direct, clear, and prioritize getting the user to their solution without overwhelming them with unnecessary technical details. Use a "High Signal, Low Noise, Zero Jargon" communication style.

Instructions for Resolution & How-Tos:
- For troubleshooting: Provide the most likely, direct solution using simple steps.
- For how-tos: Provide standard UI navigation paths over complex keyboard shortcuts unless the shortcut is universally known.
- Code & Commands: If a terminal command is necessary, explain exactly what it does in plain English BEFORE giving the command. Always wrap the exact command in a markdown code block. Give explicit, easy-to-follow instructions on how to open the terminal/command prompt.
- Imagery & Navigation: Use clear, unambiguous descriptions of icons and menus (e.g., "Click the Apple icon in the very top left corner of your screen").
- Formatting: Use clean Markdown inside your steps. Use bolding for UI elements the user needs to click. Explain what to look for after they click it.

Strict Guardrails:
- OUT OF SCOPE: Decline non-core-OS requests (like hardware purchases, test phrases, or app-specific usage like Excel). If a request is not a genuine technical problem or how-to, simply answer with a brief, friendly sentence in 'explanation' (or 'problemSummary' if not deep) and return an EMPTY array [] for 'steps'. Do NOT hallucinate resolution steps for non-technical queries.
- DANGER COMMANDS: Never suggest destructive commands without explicit, bolded warnings explained in simple terms (e.g., "This will permanently delete your files").
- NO HALLUCINATIONS: If no verified solution exists, state "I couldn't find a safe, verified way to do this. Can you provide a bit more detail about what you are trying to achieve?"
- ZERO PII: NEVER include specific user emails, names, phone numbers, or addresses in your response. Genericize them (e.g., "your email", "the given address").`;

    let prompt = '';
    const logsContext = logsText ? `\n\nUser Provided OS Logs:\n${logsText}\n` : '';

    if (kbReference) {
      prompt = `${basePersona}\n\nAdapt and improve a validated Knowledge Base (KB) solution for the user's specific issue.
         User Issue Target OS: ${parsed.os.toUpperCase()}
         User Intent: ${parsed.intent}
         Specific Context: ${parsed.context}${logsContext}
         Severity: ${parsed.severity}
         Existing KB Solution Steps (${kbReference.problemSummary}):
         ${kbReference.steps.map((s: string, i: number) => `${i+1}. ${s}`).join('\n')}

         ${kbReference.recentFeedbacks && kbReference.recentFeedbacks.length > 0 ? `
         CRITICAL - User Feedback to Address:
         The following parts of the existing solution were reported as confusing or incorrect:
         - ${kbReference.recentFeedbacks.join('\n         - ')}
         PLEASE REWRITE THE STEPS TO FIX THESE SPECIFIC COMPLAINTS.` : ''}
         Task: 
         - Tailor the KB steps specifically to the user's 'Context' and logs using strictly simple, non-technical language.
         - Make the steps more precise based on the context (e.g., specific error codes, app names).
         - Ensure the steps are accurate for the target OS.
         - ${isDeep ? "Explain in detail why the proposed solution works and offer deeper insights into the root cause of the problem using the 'explanation' field. Remember to use simple analogies instead of technical terms." : "Keep it concise, actionable, and easy to understand for beginners."}
         Format the 'problemSummary' as a clean title. Provide actionable 'steps' as an array of strings. Include URLs to any relevant official documentation in the 'sources' array.`;
    } else {
      prompt = isDeep 
        ? `${basePersona}\n\nPerform a deep analysis and provide a comprehensive guide for this ${parsed.queryType} request on ${parsed.os.toUpperCase()}:
           Intent: ${parsed.intent}
           Context: ${parsed.context}${logsContext}
           Severity: ${parsed.severity}
           Explain in detail why the proposed solution works and offer deeper insights into the root cause of the problem using the 'explanation' field. Remember to use simple analogies instead of technical terms.
           Heavily rely on the Google Search tool for the most up-to-date information from manufacturer documentation (Apple, Microsoft, Ubuntu, Google, etc.) to prevent hallucination.
           State clearly if you cannot find a verified solution rather than hallucinating or guessing.
           Provide detailed, bullet-proof steps in plain English as an array of strings. 
           Include URLs to any relevant official documentation in the 'sources' array.
           IMPORTANT: For any terminal, command prompt, or powershell commands, wrap them strictly in triple backticks with the correct language (e.g. \`\`\`bash, \`\`\`powershell, \`\`\`cmd). Do not use single backticks for full commands.
           Note: Be extremely thorough for complex scenarios, but always maintain a beginner-friendly tone.`
        : `${basePersona}\n\nProvide a step-by-step guide for this ${parsed.queryType} request on ${parsed.os.toUpperCase()}:
           Intent: ${parsed.intent}
           Context: ${parsed.context}${logsContext}
           Severity: ${parsed.severity}
           Heavily rely on the Google Search tool for the most up-to-date information from manufacturer documentation (Apple, Microsoft, Ubuntu, Google, etc.) to prevent hallucination.
           State clearly if you cannot find a verified solution rather than hallucinating or guessing.
           Format the 'problemSummary' as a clean title. Provide max 5 clear, actionable 'steps' in plain English as an array of strings. Include URLs to any relevant official documentation in the 'sources' array.
           IMPORTANT: For any terminal, command prompt, or powershell commands, wrap them strictly in triple backticks with the correct language (e.g. \`\`\`bash, \`\`\`powershell, \`\`\`cmd). Do not use single backticks for full commands.`;
    }

    const modelName = isDeep 
      ? process.env.GEMINI_MODEL_DEEP! 
      : process.env.GEMINI_MODEL_STANDARD!;
    
    contents.push(prompt);

    try {
      console.log(`[AI Server] Attempting Gemini (${modelName})...`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: {
          tools: configTools,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: isDeep ? ThinkingLevel.HIGH : ThinkingLevel.LOW },
          responseSchema: {
            type: Type.OBJECT,
            properties: isDeep ? {
              problemSummary: { type: Type.STRING },
              os: { type: Type.STRING, enum: ["macos", "windows", "linux", "android", "ios"] },
              steps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of actionable steps." },
              explanation: { type: Type.STRING, description: "A detailed explanation of the problem and why these steps work." },
              sources: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of URLs for official sources." }
            } : {
              problemSummary: { type: Type.STRING },
              os: { type: Type.STRING, enum: ["macos", "windows", "linux", "android", "ios"] },
              steps: { type: Type.ARRAY, items: { type: Type.STRING }, description: "A list of actionable steps." },
              sources: { type: Type.ARRAY, items: { type: Type.STRING }, description: "List of URLs for official sources." }
            },
            required: isDeep ? ["problemSummary", "os", "steps", "explanation"] : ["problemSummary", "os", "steps"]
          }
        }
      });
      console.log(`[AI Server] Gemini generation successful`);
      res.json(JSON.parse(response.text.trim()));
    } catch (error: any) {
      console.warn(`[AI Server] Gemini failed: ${error.message}`);
      
      const hasImage = !!(imageBase64 && imageBase64.length > 20);
      const openRouterModel = hasImage 
        ? process.env.OPENROUTER_MODEL_OCR! 
        : (isDeep ? process.env.OPENROUTER_MODEL_DEEP! : process.env.OPENROUTER_MODEL_STANDARD!);
      
      if (hasImage) {
        console.log(`[AI Server] Image detected in generation fallback, using OCR model: ${openRouterModel}`);
      }

      const systemPrompt = `You must output strictly valid JSON. Return ONLY JSON without markdown wrapping. ${
        isDeep 
          ? 'Schema: { "problemSummary": "string", "os": "string", "steps": ["string"], "explanation": "string", "sources": ["string"] }' 
          : 'Schema: { "problemSummary": "string", "os": "string", "steps": ["string"], "sources": ["string"] }'
      }\n\n${prompt}`;
      
      let userMessageContent: any[] = [{ type: "text", text: "Proceed with the instructions." }];
      if (imageBase64) {
        userMessageContent.push({ type: "image_url", image_url: { url: imageBase64 } });
      }

      try {
        const orResponse = await callOpenRouter(openRouterModel, systemPrompt, userMessageContent, "json_object");
        // Robustly extract JSON object if the model was chatty or used markdown
        const jsonMatch = orResponse.match(/\{[\s\S]*\}/);
        const cleanJson = (jsonMatch ? jsonMatch[0] : orResponse).trim();
        res.json(JSON.parse(cleanJson));
      } catch (orError: any) {
        console.error(`[AI Server] OpenRouter fallback failed: ${orError.message}`);
        res.status(500).json({ error: "All AI generation failed" });
      }
    }
  });

  // API stub for future webhooks/automation
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "TechConcierge-API" });
  });

  // Generate Embeddings for Vector Search
  app.post("/api/ai/embed", async (req, res) => {
    try {
      const { text } = req.body;
      if (!text) return res.status(400).json({ error: "No text provided" });
      
      let response;
      try {
        const primaryEmbedModel = process.env.GEMINI_MODEL_EMBEDDING!;
        response = await ai.models.embedContent({
          model: primaryEmbedModel,
          contents: text,
        });
      } catch (err: any) {
        const fallbackEmbedModel = process.env.GEMINI_MODEL_EMBEDDING_FALLBACK!;
        console.warn(`[AI Server] Primary embedding failed, trying ${fallbackEmbedModel}`);
        response = await ai.models.embedContent({
          model: fallbackEmbedModel,
          contents: text,
        });
      }

      res.json({ embedding: response.embeddings[0].values });
    } catch (error: any) {
      console.error(`[AI Server] Embedding failed: ${error.message}`);
      res.status(500).json({ error: "Failed to generate embedding" });
    }
  });

  // Endpoint for external systems to query the KB (read-only for now)
  app.get("/api/kb/search", async (req, res) => {
    res.json({ message: "KB Search API available for automation integration." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    console.log(`[Production] Current Working Directory: ${process.cwd()}`);
    console.log(`[Production] Serving static files from: ${distPath}`);
    
    // Diagnostic: List files in dist to see what's actually there
    import("fs").then(fs => {
      if (fs.existsSync(distPath)) {
        const files = fs.readdirSync(distPath, { recursive: true });
        console.log(`[Production] Files found in dist: ${JSON.stringify(files)}`);
      } else {
        console.error(`[Production] ERROR: dist folder does NOT exist at ${distPath}`);
        // Try to see if it's in the parent or a sibling
        console.log(`[Production] Root Scan: ${JSON.stringify(fs.readdirSync(__dirname))}`);
      }
    });

    // Serve static files with a fallback to index.html ONLY for non-file requests
    app.use(express.static(distPath));
    
    app.get("*", (req, res) => {
      // If the request looks like a file (has an extension) or is in /assets, 
      // but reached here, it means express.static didn't find it.
      // Return 404 instead of index.html to avoid MIME type mismatch errors.
      if (req.path.includes('.') || req.path.startsWith('/assets/')) {
        return res.status(404).send("File not found");
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
