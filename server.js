import express from "express";
import crypto from "node:crypto";

// ── Stock Data ───────────────────────────────────────────────────────
const STOCKS = {
  AAPL:  { symbol: "AAPL",  name: "Apple Inc.",              sector: "Technology",        marketCap: "3.4T",  price: 228.50, rank: 1 },
  MSFT:  { symbol: "MSFT",  name: "Microsoft Corporation",   sector: "Technology",        marketCap: "3.1T",  price: 415.80, rank: 2 },
  NVDA:  { symbol: "NVDA",  name: "NVIDIA Corporation",      sector: "Technology",        marketCap: "2.8T",  price: 135.20, rank: 3 },
  GOOGL: { symbol: "GOOGL", name: "Alphabet Inc.",           sector: "Technology",        marketCap: "2.1T",  price: 170.30, rank: 4 },
  AMZN:  { symbol: "AMZN",  name: "Amazon.com Inc.",         sector: "Consumer Cyclical", marketCap: "2.0T",  price: 192.40, rank: 5 },
  META:  { symbol: "META",  name: "Meta Platforms Inc.",     sector: "Technology",        marketCap: "1.5T",  price: 585.60, rank: 6 },
  "BRK.B": { symbol: "BRK.B", name: "Berkshire Hathaway",   sector: "Financial",         marketCap: "1.1T",  price: 478.90, rank: 7 },
  TSM:   { symbol: "TSM",   name: "Taiwan Semiconductor",    sector: "Technology",        marketCap: "950B",  price: 183.70, rank: 8 },
  LLY:   { symbol: "LLY",   name: "Eli Lilly and Company",   sector: "Healthcare",        marketCap: "850B",  price: 895.20, rank: 9 },
  AVGO:  { symbol: "AVGO",  name: "Broadcom Inc.",           sector: "Technology",        marketCap: "820B",  price: 178.40, rank: 10 },
  JPM:   { symbol: "JPM",   name: "JPMorgan Chase & Co.",    sector: "Financial",         marketCap: "680B",  price: 235.10, rank: 11 },
  V:     { symbol: "V",     name: "Visa Inc.",               sector: "Financial",         marketCap: "620B",  price: 310.50, rank: 12 },
  WMT:   { symbol: "WMT",   name: "Walmart Inc.",            sector: "Consumer Defensive",marketCap: "600B",  price: 90.80,  rank: 13 },
  XOM:   { symbol: "XOM",   name: "Exxon Mobil Corporation", sector: "Energy",            marketCap: "510B",  price: 118.30, rank: 14 },
  MA:    { symbol: "MA",    name: "Mastercard Incorporated",  sector: "Financial",         marketCap: "480B",  price: 515.40, rank: 15 },
  UNH:   { symbol: "UNH",   name: "UnitedHealth Group",      sector: "Healthcare",        marketCap: "470B",  price: 520.60, rank: 16 },
  COST:  { symbol: "COST",  name: "Costco Wholesale Corp.",  sector: "Consumer Defensive",marketCap: "420B",  price: 950.20, rank: 17 },
  HD:    { symbol: "HD",    name: "The Home Depot Inc.",     sector: "Consumer Cyclical", marketCap: "400B",  price: 405.30, rank: 18 },
  PG:    { symbol: "PG",    name: "Procter & Gamble Co.",    sector: "Consumer Defensive",marketCap: "390B",  price: 168.70, rank: 19 },
  ORCL:  { symbol: "ORCL",  name: "Oracle Corporation",      sector: "Technology",        marketCap: "380B",  price: 170.90, rank: 20 },
};

const TOOL_DEF = {
  name: "get_stock_price",
  description: "Returns the price and details of a stock by its ticker symbol.",
  inputSchema: {
    type: "object",
    required: ["ticker"],
    properties: { ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL, MSFT, NVDA)" } },
  },
};

const SERVER_INFO = { name: "FinancialMCP", version: "1.0.0" };

// ── Express ──────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

app.use((req, res, next) => {
  console.log(`>>> ${req.method} ${req.url} | Accept: ${req.headers.accept}`);
  next();
});

// ── SSE Sessions: sessionId → sseResponse ────────────────────────────
const sessions = {};

// Handle JSON-RPC message and return result object
function handleMessage(body) {
  const { method, id, params } = body;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: true } },
        serverInfo: SERVER_INFO,
      },
    };
  }

  if (method === "notifications/initialized") {
    return null; // no response needed
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: [TOOL_DEF] } };
  }

  if (method === "tools/call") {
    const ticker = (params?.arguments?.ticker || "").toUpperCase();
    const stock = STOCKS[ticker];
    if (!stock) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Ticker "${ticker}" not found. Available: ${Object.keys(STOCKS).join(", ")}` }] } };
    }
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(stock, null, 2) }] } };
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

// ── GET /mcp → SSE stream (old SSE protocol) ─────────────────────────
app.get("/mcp", (req, res) => {
  const sessionId = crypto.randomUUID();
  console.log(`[sse] New session: ${sessionId}`);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send endpoint event — tells client where to POST messages
  res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
  res.flush?.();

  // Store session
  sessions[sessionId] = res;

  // Keep alive
  const keepAlive = setInterval(() => {
    res.write(`: ping\n\n`);
    res.flush?.();
  }, 15000);

  res.on("close", () => {
    console.log(`[sse] Session closed: ${sessionId}`);
    delete sessions[sessionId];
    clearInterval(keepAlive);
  });
});

// ── POST /mcp → handle messages ──────────────────────────────────────
app.post("/mcp", (req, res) => {
  const sessionId = req.query.sessionId;
  const { method } = req.body || {};
  console.log(`[post] ${method} | session: ${sessionId || "none"}`);

  const result = handleMessage(req.body);

  // If we have an SSE session, send result there
  if (sessionId && sessions[sessionId]) {
    const sseRes = sessions[sessionId];

    if (result) {
      sseRes.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      sseRes.flush?.();
      console.log(`[post] Result sent via SSE stream`);
    }

    // Acknowledge the POST
    res.status(202).send("Accepted");
  }
  // No SSE session — respond directly with SSE format on POST
  else {
    if (result) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } else {
      res.status(204).end();
    }
  }
});

// ── Health check ─────────────────────────────────────────────────────
app.head("/", (req, res) => res.status(200).end());
app.get("/", (req, res) => res.json({ status: "ok", ...SERVER_INFO }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`\n🟢 Financial MCP on port ${PORT} — SSE + POST\n`));
