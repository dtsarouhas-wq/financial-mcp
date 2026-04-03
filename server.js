import express from "express";
import crypto from "node:crypto";

// ── Yahoo Finance API ────────────────────────────────────────────────
async function fetchYahooData(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;

  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!resp.ok) throw new Error(`Yahoo API returned ${resp.status}`);

  const data = await resp.json();
  if (data.chart.error) throw new Error(data.chart.error.description || "Yahoo error");

  const result = data.chart.result?.[0];
  if (!result) throw new Error(`No data found for: ${ticker}`);

  const meta = result.meta;
  const change = meta.regularMarketPrice - meta.chartPreviousClose;
  const changePct = ((change / meta.chartPreviousClose) * 100).toFixed(2);

  return {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || ticker,
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose,
    change: parseFloat(change.toFixed(2)),
    changePercent: `${changePct}%`,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    volume: meta.regularMarketVolume,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    currency: meta.currency,
    exchange: meta.fullExchangeName,
  };
}

// ── Market Indices mapping ───────────────────────────────────────────
const INDICES = {
  "SP500":   "^GSPC",   "S&P500":  "^GSPC",   "S&P 500": "^GSPC",
  "NASDAQ":  "^IXIC",   "IXIC":    "^IXIC",
  "DOW":     "^DJI",    "DJIA":    "^DJI",    "DOW JONES": "^DJI",
  "FTSE":    "^FTSE",   "FTSE100": "^FTSE",   "FTSE 100": "^FTSE",
  "DAX":     "^GDAXI",  "DAX40":   "^GDAXI",
  "NIKKEI":  "^N225",   "NIKKEI225": "^N225",
  "HANG SENG": "^HSI",  "HSI":     "^HSI",
  "CAC":     "^FCHI",   "CAC40":   "^FCHI",
  "STOXX":   "^STOXX50E", "EUROSTOXX": "^STOXX50E",
  "RUSSELL": "^RUT",    "RUSSELL2000": "^RUT",
  "VIX":     "^VIX",
  "ASX":     "^AXJO",   "ASX200":  "^AXJO",
};

// ── Tool Definitions ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_stock_price",
    description: "Returns real-time stock price and details from Yahoo Finance. Works with any valid ticker symbol (e.g. AAPL, MSFT, NVDA, GOOGL, TSLA, AMZN, META, etc.).",
    inputSchema: {
      type: "object",
      required: ["ticker"],
      properties: {
        ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL, MSFT, NVDA, TSLA)" },
      },
    },
  },
  {
    name: "get_market_index",
    description: "Returns real-time data for major market indices. Supported: SP500, NASDAQ, DOW, FTSE, DAX, NIKKEI, HANG SENG, CAC, EUROSTOXX, RUSSELL, VIX, ASX.",
    inputSchema: {
      type: "object",
      required: ["index"],
      properties: {
        index: { type: "string", description: "Market index name (e.g. NASDAQ, SP500, FTSE, DAX, NIKKEI, DOW, VIX)" },
      },
    },
  },
];

const SERVER_INFO = { name: "FinancialMCP", version: "2.1.0" };

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
  console.log(`>>> ${req.method} ${req.url} | ${req.body?.method || ""}`);
  next();
});

// ── Handle tool calls ────────────────────────────────────────────────
async function handleToolCall(name, args) {
  if (name === "get_stock_price") {
    const ticker = (args?.ticker || "").toUpperCase();
    const data = await fetchYahooData(ticker);
    return JSON.stringify(data, null, 2);
  }

  if (name === "get_market_index") {
    const input = (args?.index || "").toUpperCase();
    const yahooTicker = INDICES[input] || `^${input}`;
    const data = await fetchYahooData(yahooTicker);
    return JSON.stringify(data, null, 2);
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── Handle JSON-RPC message ──────────────────────────────────────────
async function handleMessage(body) {
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

  if (method === "notifications/initialized") return null;

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    try {
      const text = await handleToolCall(toolName, params?.arguments);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}` }] } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

// ── SSE Sessions ─────────────────────────────────────────────────────
const sessions = {};

app.get("/mcp", (req, res) => {
  const sessionId = crypto.randomUUID();
  console.log(`[sse] New session: ${sessionId}`);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`event: endpoint\ndata: /mcp?sessionId=${sessionId}\n\n`);
  res.flush?.();

  sessions[sessionId] = res;

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

app.post("/mcp", async (req, res) => {
  const sessionId = req.query.sessionId;
  const { method } = req.body || {};
  console.log(`[post] ${method} | session: ${sessionId || "none"}`);

  const result = await handleMessage(req.body);

  if (sessionId && sessions[sessionId]) {
    const sseRes = sessions[sessionId];
    if (result) {
      sseRes.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
      sseRes.flush?.();
    }
    res.status(202).send("Accepted");
  } else {
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

app.head("/", (req, res) => res.status(200).end());
app.get("/", (req, res) => res.json({ status: "ok", ...SERVER_INFO }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`\n🟢 Financial MCP v2.1 on port ${PORT} — Stocks + Market Indices\n`));
