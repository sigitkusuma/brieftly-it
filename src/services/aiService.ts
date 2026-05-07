import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export interface ParsedIssue {
  os: "macos" | "windows" | "linux" | "android" | "ios" | "unknown";
  intent: string;
  context: string;
  severity: "low" | "medium" | "high";
  queryType: "troubleshoot" | "how-to";
  isOSRelated: boolean;
}

export interface AISolution {
  problemSummary: string;
  steps: string[];
  os: "macos" | "windows" | "linux" | "android" | "ios";
  explanation?: string; // For deep mode
}

export const parseUserIssue = async (query: string, clientHint?: string, imageBase64?: string, logsText?: string): Promise<ParsedIssue> => {
  const contents: any[] = [];
  
  if (imageBase64) {
    // Extract mime type and base64 data from the data URL
    const match = imageBase64.match(/^data:(image\/[a-zA-Z]+);base64,(.*)$/);
    if (match) {
      contents.push({
        inlineData: {
          mimeType: match[1],
          data: match[2]
        }
      });
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
  `);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
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

  try {
    const text = response.text.trim();
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse AI response", e);
    return { isOSRelated: true, os: "unknown", queryType: "troubleshoot", intent: "general", context: query, severity: "medium" };
  }
};

export const generateSolution = async (parsed: ParsedIssue, isDeep: boolean = false, kbReference: any = null, logsText?: string): Promise<AISolution> => {
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
- OUT OF SCOPE: Decline non-core-OS requests (like hardware purchases or app-specific usage like Excel) and state your scope gently.
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
       
       Task: 
       - Tailor the KB steps specifically to the user's 'Context' and logs using strictly simple, non-technical language.
       - Make the steps more precise based on the context (e.g., specific error codes, app names).
       - Ensure the steps are accurate for the target OS.
       - ${isDeep ? "Explain in detail why the proposed solution works and offer deeper insights into the root cause of the problem using the 'explanation' field. Remember to use simple analogies instead of technical terms." : "Keep it concise, actionable, and easy to understand for beginners."}
       
       Format the 'problemSummary' as a clean title.
       Provide actionable 'steps' as an array of strings.`;
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
         IMPORTANT: For any terminal, command prompt, or powershell commands, wrap them strictly in triple backticks with the correct language (e.g. \`\`\`bash, \`\`\`powershell, \`\`\`cmd). Do not use single backticks for full commands.
         Note: Be extremely thorough for complex scenarios, but always maintain a beginner-friendly tone.`
      : `${basePersona}\n\nProvide a step-by-step guide for this ${parsed.queryType} request on ${parsed.os.toUpperCase()}:
         Intent: ${parsed.intent}
         Context: ${parsed.context}${logsContext}
         Severity: ${parsed.severity}
         
         Heavily rely on the Google Search tool for the most up-to-date information from manufacturer documentation (Apple, Microsoft, Ubuntu, Google, etc.) to prevent hallucination.
         State clearly if you cannot find a verified solution rather than hallucinating or guessing.
         Format the 'problemSummary' as a clean title.
         Provide max 5 clear, actionable 'steps' in plain English as an array of strings.
         IMPORTANT: For any terminal, command prompt, or powershell commands, wrap them strictly in triple backticks with the correct language (e.g. \`\`\`bash, \`\`\`powershell, \`\`\`cmd). Do not use single backticks for full commands.`;
  }

  const modelName = isDeep ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";

  const configTools = !kbReference ? [{ googleSearch: {} }] : undefined;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      tools: configTools,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: isDeep ? ThinkingLevel.HIGH : ThinkingLevel.LOW },
      responseSchema: {
        type: Type.OBJECT,
        properties: isDeep ? {
          problemSummary: { type: Type.STRING },
          os: { type: Type.STRING, enum: ["macos", "windows", "linux", "android", "ios"] },
          steps: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "A list of actionable steps."
          },
          explanation: {
            type: Type.STRING,
            description: "A detailed explanation of the problem and why these steps work."
          }
        } : {
          problemSummary: { type: Type.STRING },
          os: { type: Type.STRING, enum: ["macos", "windows", "linux", "android", "ios"] },
          steps: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "A list of actionable steps."
          }
        },
        required: isDeep ? ["problemSummary", "os", "steps", "explanation"] : ["problemSummary", "os", "steps"]
      }
    }
  });

  return JSON.parse(response.text.trim());
};
