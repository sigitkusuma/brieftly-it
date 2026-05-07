import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3001;

  app.use(express.json());

  // API stub for future webhooks/automation
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "TechConcierge-API" });
  });

  // Endpoint for external systems to query the KB (read-only for now)
  app.get("/api/kb/search", async (req, res) => {
    // In a real scenario, this would interact with Firestore via Admin SDK
    // For now, it's a structural placeholder for "external automation engines"
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
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
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
