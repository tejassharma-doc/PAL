
// ============ Webhook Endpoint for External Integrations ============
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

