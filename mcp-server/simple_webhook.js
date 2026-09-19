import express from 'express';
import bodyParser from 'body-parser';

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Error wrapper
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'MCP Webhook Server' });
});

// Webhook endpoint
app.post("/api/v1/webhook", wrap(async (req, res) => {
  const timestamp = new Date().toISOString();
  const payload = req.body || {};
  const headers = req.headers || {};

  console.log("========== WEBHOOK RECEIVED ==========");
  console.log("Timestamp:", timestamp);
  console.log("Headers:", JSON.stringify(headers, null, 2));
  console.log("Payload:", JSON.stringify(payload, null, 2));
  console.log("======================================");

  res.status(200).json({
    success: true,
    message: "Webhook received successfully",
    timestamp: timestamp,
    dataReceived: Object.keys(payload).length > 0
  });
}));

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP Webhook Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/v1/webhook`);
});
