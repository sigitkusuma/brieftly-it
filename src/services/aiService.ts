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
  sources?: string[]; // Optional array of URLs for sources
}

export const parseUserIssue = async (query: string, clientHint?: string, imageBase64?: string, logsText?: string): Promise<ParsedIssue> => {
  const res = await fetch("/api/ai/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, clientHint, imageBase64, logsText })
  });

  if (!res.ok) {
    throw new Error("Failed to parse user issue");
  }

  return res.json();
};

export const generateSolution = async (parsed: ParsedIssue, isDeep: boolean = false, kbReference: any = null, logsText?: string): Promise<AISolution> => {
  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parsed, isDeep, kbReference, logsText })
  });

  if (!res.ok) {
    throw new Error("Failed to generate solution");
  }

  return res.json();
};

export const generateEmbedding = async (text: string): Promise<number[] | null> => {
  try {
    const response = await fetch('/api/ai/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data.embedding;
  } catch (error) {
    console.error("Embedding generation failed:", error);
    return null;
  }
};
