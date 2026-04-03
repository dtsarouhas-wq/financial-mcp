import express from "express";

// ── Top 20 Stocks Data ───────────────────────────────────────────────
const TOP_20_STOCKS = [
  { rank: 1,  symbol: "AAPL",  name: "Apple Inc.",                   sector: "Technology",        marketCap: "3.4T",  price: 228.50 },
  { rank: 2,  symbol: "MSFT",  name: "Microsoft Corporation",        sector: "Technology",        marketCap: "3.1T",  price: 415.80 },
  { rank: 3,  symbol: "NVDA",  name: "NVIDIA Corporation",           sector: "Technology",        marketCap: "2.8T",  price: 135.20 },
  { rank: 4,  symbol: "GOOGL", name: "Alphabet Inc.",                sector: "Technology",        marketCap: "2.1T",  price: 170.30 },
  { rank: 5,  symbol: "AMZN",  name: "Amazon.com Inc.",              sector: "Consumer Cyclical", marketCap: "2.0T",  price: 192.40 },
  { rank: 6,  symbol: "META",  name: "Meta Platforms Inc.",          sector: "Technology",        marketCap: "1.5T",  price: 585.60 },
  { rank: 7,  symbol: "BRK.B", name: "Berkshire Hathaway Inc.",      sector: "Financial",         marketCap: "1.1T",  price: 478.90 },
  { rank: 8,  symbol: "TSM",   name: "Taiwan Semiconductor",         sector: "Technology",        marketCap: "950B",  price: 183.70 },
  { rank: 9,  symbol: "LLY",   name: "Eli Lilly and Company",        sector: "Healthcare",        marketCap: "850B",  price: 895.20 },
  { rank: 10, symbol: "AVGO",  name: "Broadcom Inc.",                sector: "Technology",        marketCap: "820B",  price: 178.40 },
  { rank: 11, symbol: "JPM",   name: "JPMorgan Chase & Co.",         sector: "Financial",         marketCap: "680B",  price: 235.10 },
  { rank: 12, symbol: "V",     name: "Visa Inc.",                    sector: "Financial",         marketCap: "620B",  price: 310.50 },
  { rank: 13, symbol: "WMT",   name: "Walmart Inc.",                 sector: "Consumer Defensive",marketCap: "600B",  price: 90.80  },
  { rank: 14, symbol: "XOM",   name: "Exxon Mobil Corporation",      sector: "Energy",            marketCap: "510B",  price: 118.30 },
  { rank: 15, symbol: "MA",    name: "Mastercard Incorporated",      sector: "Financial",         marketCap: "480B",  price: 515.40 },
  { rank: 16, symbol: "UNH",   name: "UnitedHealth Group Inc.",      sector: "Healthcare",        marketCap: "470B",  price: 520.60 },
  { rank: 17, symbol: "COST",  name: "Costco Wholesale Corp.",       sector: "Consumer Defensive",marketCap: "420B",  price: 950.20 },
  { rank: 18, symbol: "HD",    name: "The Home Depot Inc.",          sector: "Consumer Cyclical", marketCap: "400B",  price: 405.30 },
  { rank: 19, symbol: "PG",    name: "Procter & Gamble Co.",         sector: "Consumer Defensive",marketCap: "390B",  price: 168.70 },
  { rank: 20, symbol: "ORCL",  name: "Oracle Corporation",           sector: "Technology",        marketCap: "380B",  price: 170.90 },
];

function handleGetStockPrice(ticker) {
  const stock = TOP_20_STOCKS.find(s => s.symbol.toUpperCase() === ticker.toUpperCase());
  if (!stock) {
    const available = TOP_20_STOCKS.map(s => s.symbol).join(", ");
    return { content: [{ type: "text", text: `Ticker "${ticker}" not found. Available: ${available}` }] };
  }
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ symbol: stock.symbol, name: stock.name, price: stock.price, sector: stock.sector, marketCap: stock.marketCap, rank: stock.rank }, null, 2),
    }],
  };
}

const TOOL_DEF = {
  name: "get_stock_price",
  description: "Returns the price and details of a stock by its ticker symbol. Supported tickers: AAPL, MSFT, NVDA, GOOGL, AMZN, META, BRK.B, TSM, LLY, AVGO, JPM, V, WMT, XOM, MA, UNH, COST, HD, PG, ORCL.",
  inputSchema: {
    type: "object",
    $schema: "http://json-schema.org/draft-07/schema#",
    required: ["ticker"],
    properties: { ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL, MSFT, NVDA)" } },
  },
};

const SERVER_INFO = { name: "FinancialMCP", description: "An MCP Server for looking up stock prices and details.", version: "1.0.0" };

// ── Express Setup ────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

// Log ALL requests
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url} Accept: ${req.headers.accept || 'none'}`);
  next();
});

// ── Helper: respond in format the client wants ───────────────────────
function respond(req, res, jsonRpcResponse) {
  const accept = req.headers.accept || "";

  // If client wants SSE → send as event stream
  if (accept.includes("text/event-stream")) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.write(`event: message\ndata: ${JSON.stringify(jsonRpcResponse)}\n\n`);
    res.end();
  }
  // Otherwise → send as plain JSON
  else {
    res.json(jsonRpcResponse);
  }
}

// ── GET /mcp → simple 200 OK ────────────────────────────────────────
app.get("/mcp", (req, res) => {
  const accept = req.headers.accept || "";

  // If client wants SSE stream
  if (accept.includes("text/event-stream")) {
    console.log("[get] SSE stream requested");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");

    const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000);
    res.on("close", () => { clearInterval(keepAlive); console.log("[get] SSE stream closed"); });
  }
  // Otherwise just return server info
  else {
    console.log("[get] Health check");
    res.json({ name: SERVER_INFO.name, version: SERVER_INFO.version, status: "ok" });
  }
});

// ── POST /mcp → handle JSON-RPC ─────────────────────────────────────
app.post("/mcp", (req, res) => {
  const { method, id, params } = req.body;
  console.log(`[post] ${method} (id: ${id})`);

  if (method === "initialize") {
    respond(req, res, {
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: true } },
        serverInfo: SERVER_INFO,
      },
      jsonrpc: "2.0", id,
    });
  }

  else if (method === "notifications/initialized") {
    res.status(204).end();
  }

  else if (method === "tools/list") {
    respond(req, res, { result: { tools: [TOOL_DEF] }, jsonrpc: "2.0", id });
  }

  else if (method === "tools/call") {
    const toolName = params?.name;
    if (toolName === "get_stock_price") {
      respond(req, res, { result: handleGetStockPrice(params.arguments?.ticker || ""), jsonrpc: "2.0", id });
    } else {
      respond(req, res, { error: { code: -32601, message: `Unknown tool: ${toolName}` }, jsonrpc: "2.0", id });
    }
  }

  else {
    respond(req, res, { error: { code: -32601, message: `Method not found: ${method}` }, jsonrpc: "2.0", id });
  }
});

app.delete("/mcp", (req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🟢 Financial MCP Server running on port ${PORT}`);
  console.log(`   Endpoint:  http://localhost:${PORT}/mcp`);
  console.log(`   Tool:      get_stock_price(ticker)\n`);
});
