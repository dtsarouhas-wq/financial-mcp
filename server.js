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

// ── Company Name → Ticker mapping ───────────────────────────────────
const COMPANY_NAMES = {
  "APPLE": "AAPL", "MICROSOFT": "MSFT", "NVIDIA": "NVDA",
  "GOOGLE": "GOOGL", "ALPHABET": "GOOGL", "AMAZON": "AMZN",
  "META": "META", "FACEBOOK": "META", "TESLA": "TSLA",
  "NETFLIX": "NFLX", "AMD": "AMD", "INTEL": "INTC",
  "DISNEY": "DIS", "WALMART": "WMT", "JPMORGAN": "JPM",
  "BANK OF AMERICA": "BAC", "GOLDMAN SACHS": "GS",
  "COCA COLA": "KO", "COCA-COLA": "KO", "PEPSI": "PEP",
  "NIKE": "NKE", "VISA": "V", "MASTERCARD": "MA",
  "PAYPAL": "PYPL", "SALESFORCE": "CRM", "ORACLE": "ORCL",
  "IBM": "IBM", "UBER": "UBER", "AIRBNB": "ABNB",
  "SPOTIFY": "SPOT", "SNAP": "SNAP", "SNAPCHAT": "SNAP",
  "BOEING": "BA", "EXXON": "XOM", "CHEVRON": "CVX",
  "PFIZER": "PFE", "MODERNA": "MRNA", "COSTCO": "COST",
  "STARBUCKS": "SBUX", "VANGUARD S&P 500": "VOO", "VOO": "VOO",
};

function resolveTicker(input) {
  const upper = (input || "").toUpperCase().trim();
  return COMPANY_NAMES[upper] || upper;
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

// ── Fake Member Portfolio ───────────────────────────────────────────
const MEMBER_PORTFOLIO = {
  member_id: "CU-88421",
  member_name: "Sarah Johnson",
  account_type: "Investment Account",
  holdings: [
    { ticker: "AAPL",  shares: 50,  avg_cost: 142.30 },
    { ticker: "MSFT",  shares: 30,  avg_cost: 285.10 },
    { ticker: "NVDA",  shares: 20,  avg_cost: 415.00 },
    { ticker: "VOO",   shares: 15,  avg_cost: 380.50 },
    { ticker: "GOOGL", shares: 25,  avg_cost: 131.75 },
    { ticker: "AMZN",  shares: 18,  avg_cost: 127.40 },
  ],
  cash_balance: 4250.00,
  last_updated: new Date().toISOString().split("T")[0],
};

// ── Trade Request Log (in-memory) ───────────────────────────────────
const tradeLog = [];

// ── Tool Definitions ─────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_stock_price",
    description: "Returns real-time stock price and details. Accepts ticker symbols (AAPL, NVDA) OR company names (Apple, Nvidia). The server resolves names to tickers automatically.",
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
  {
    name: "get_portfolio",
    description: "Returns the member's current investment portfolio including all stock holdings, number of shares, average cost basis, and available cash balance.",
    inputSchema: {
      type: "object",
      required: [],
      properties: {},
    },
  },
  {
    name: "place_trade_request",
    description: "Submits a trade request (buy, sell, or transfer) for the member's investment account. The request is queued for advisor confirmation within 24 hours.",
    inputSchema: {
      type: "object",
      required: ["action", "ticker", "shares"],
      properties: {
        action: { type: "string", description: "Trade action: buy, sell, or transfer" },
        ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL, MSFT)" },
        shares: { type: "number", description: "Number of shares to buy or sell" },
      },
    },
  },
  {
    name: "calculate_loan",
    description: "Calculates monthly payment, total interest, and total cost for a loan. Supports auto loans, personal loans, and mortgages.",
    inputSchema: {
      type: "object",
      required: ["principal", "annual_rate", "term_months"],
      properties: {
        principal: { type: "number", description: "Loan amount in USD (e.g. 25000)" },
        annual_rate: { type: "number", description: "Annual interest rate as percentage (e.g. 6.5 for 6.5%)" },
        term_months: { type: "number", description: "Loan term in months (e.g. 60 for 5 years)" },
      },
    },
  },
  {
    name: "get_exchange_rate",
    description: "Returns the current exchange rate between two currencies and converts an amount. Supports USD, EUR, GBP, JPY, CAD, AUD, CHF, MXN, BRL, and more.",
    inputSchema: {
      type: "object",
      required: ["from", "to"],
      properties: {
        from: { type: "string", description: "Source currency code (e.g. USD, EUR, GBP)" },
        to: { type: "string", description: "Target currency code (e.g. EUR, JPY, GBP)" },
        amount: { type: "number", description: "Amount to convert (default: 1)" },
      },
    },
  },
];

const SERVER_INFO = { name: "FinancialMCP", version: "3.0.0" };

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
  // ── Stock Price ──
  if (name === "get_stock_price") {
    const ticker = resolveTicker(args?.ticker);
    const data = await fetchYahooData(ticker);
    return JSON.stringify(data, null, 2);
  }

  // ── Market Index ──
  if (name === "get_market_index") {
    const input = (args?.index || "").toUpperCase();
    const yahooTicker = INDICES[input] || `^${input}`;
    const data = await fetchYahooData(yahooTicker);
    return JSON.stringify(data, null, 2);
  }

  // ── Portfolio ──
  if (name === "get_portfolio") {
    return JSON.stringify(MEMBER_PORTFOLIO, null, 2);
  }

  // ── Trade Request ──
  if (name === "place_trade_request") {
    const action = (args?.action || "").toLowerCase();
    const ticker = (args?.ticker || "").toUpperCase();
    const shares = args?.shares || 0;

    if (!["buy", "sell", "transfer"].includes(action)) {
      throw new Error(`Invalid action: ${action}. Must be buy, sell, or transfer.`);
    }
    if (!ticker) throw new Error("Ticker is required.");
    if (shares <= 0) throw new Error("Shares must be greater than 0.");

    // For sell — check if member has enough shares
    if (action === "sell") {
      const holding = MEMBER_PORTFOLIO.holdings.find(h => h.ticker === ticker);
      if (!holding) throw new Error(`You don't hold any ${ticker} shares.`);
      if (holding.shares < shares) throw new Error(`You only hold ${holding.shares} shares of ${ticker}.`);
    }

    const request = {
      request_id: `TR-${Date.now()}`,
      member_id: MEMBER_PORTFOLIO.member_id,
      action,
      ticker,
      shares,
      status: "pending_advisor_review",
      submitted_at: new Date().toISOString(),
      estimated_confirmation: "Within 24 hours",
    };

    tradeLog.push(request);
    return JSON.stringify(request, null, 2);
  }

  // ── Loan Calculator ──
  if (name === "calculate_loan") {
    const P = args?.principal || 0;
    const annualRate = args?.annual_rate || 0;
    const months = args?.term_months || 0;

    if (P <= 0) throw new Error("Principal must be greater than 0.");
    if (annualRate <= 0) throw new Error("Annual rate must be greater than 0.");
    if (months <= 0) throw new Error("Term must be greater than 0 months.");

    const r = annualRate / 100 / 12;
    const payment = P * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
    const totalCost = payment * months;
    const totalInterest = totalCost - P;

    return JSON.stringify({
      principal: P,
      annual_rate: `${annualRate}%`,
      term_months: months,
      term_years: parseFloat((months / 12).toFixed(1)),
      monthly_payment: parseFloat(payment.toFixed(2)),
      total_interest: parseFloat(totalInterest.toFixed(2)),
      total_cost: parseFloat(totalCost.toFixed(2)),
    }, null, 2);
  }

  // ── Exchange Rate ──
  if (name === "get_exchange_rate") {
    const from = (args?.from || "USD").toUpperCase();
    const to = (args?.to || "EUR").toUpperCase();
    const amount = args?.amount || 1;

    const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}&amount=${amount}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Exchange rate API returned ${resp.status}`);
    const data = await resp.json();

    return JSON.stringify({
      from,
      to,
      amount,
      rate: data.rates[to] / amount,
      converted: data.rates[to],
      date: data.date,
    }, null, 2);
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
app.listen(PORT, () => console.log(`\n🟢 Financial MCP v3.0 on port ${PORT} — Stocks, Indices, Portfolio, Trading, Loans, Forex\n`));
