/**
 * PAL Health API - MCP Server
 * REST endpoints for PAL Android/iOS app + ABDM integration.
 *
 * Env vars:
 *   PAL_API_KEY     - shared secret; clients must send it as X-API-Key header
 *   PORT            - HTTP port (default 3001)
 *   DATABASE_URL    - PostgreSQL connection string
 *   POSTGRES_HOST   - PostgreSQL host (default localhost)
 *   POSTGRES_PORT   - PostgreSQL port (default 5432)
 *   POSTGRES_USER   - PostgreSQL user (default pal)
 *   POSTGRES_PASSWORD - PostgreSQL password
 *   POSTGRES_DB     - PostgreSQL database (default pal)
 */
import express from "express";
import pkg from "pg";
const { Pool } = pkg;

const PORT = parseInt(process.env.PORT || "3001", 10);
const API_KEY = process.env.PAL_API_KEY || "";

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.POSTGRES_HOST || "localhost",
  port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
  user: process.env.POSTGRES_USER || "pal",
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || "pal",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err);
});

const app = express();
app.use(express.json());

// --- Auth middleware ---
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (!API_KEY) return res.status(500).json({ error: "Server misconfigured: PAL_API_KEY not set" });
  if (req.get("X-API-Key") !== API_KEY) return res.status(401).json({ error: "Invalid or missing X-API-Key" });
  next();
});

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error("Request error:", e);
  res.status(500).json({ error: e.message });
});

app.get("/health", (_req, res) => res.json({
  status: "ok",
  service: "pal-mcp-api",
  database: pool.totalCount
}));

// ============ PAL Patient Endpoints ============

/**
 * Find patients: /api/v1/patients?phone=...&email=...&patientId=...
 * Search by phone, email, or patient ID
 */
app.get("/api/v1/patients", wrap(async (req, res) => {
  const { phone, email, patientId } = req.query;

  if (!phone && !email && !patientId) {
    return res.status(400).json({ error: "Provide phone, email, or patientId" });
  }

  const conditions = [];
  const params = [];
  let paramCount = 1;

  if (phone) {
    conditions.push(`phone = $${paramCount++}`);
    params.push(phone);
  }
  if (email) {
    conditions.push(`email = $${paramCount++}`);
    params.push(email.toLowerCase());
  }
  if (patientId) {
    conditions.push(`id = $${paramCount++}`);
    params.push(patientId);
  }

  const query = `
    SELECT
      id, full_name, email, phone, date_of_birth, gender, blood_group,
      address, emergency_contact_name, emergency_contact_phone,
      medical_history, allergies, current_medications,
      height_cm, weight_kg, photo_url, is_active, created_at, updated_at
    FROM patients
    WHERE ${conditions.join(" OR ")} AND is_active = true
    ORDER BY updated_at DESC
    LIMIT 50
  `;

  const result = await pool.query(query, params);
  res.json(result.rows);
}));

/**
 * Patient detail by ID
 * GET /api/v1/patients/:id
 */
app.get("/api/v1/patients/:id", wrap(async (req, res) => {
  const result = await pool.query(`
    SELECT
      id, full_name, email, phone, date_of_birth, gender, blood_group,
      address, emergency_contact_name, emergency_contact_phone,
      medical_history, allergies, current_medications,
      height_cm, weight_kg, photo_url, is_active, created_at, updated_at
    FROM patients
    WHERE id = $1
  `, [req.params.id]);

  if (!result.rows.length) {
    return res.status(404).json({ error: "Patient not found" });
  }

  res.json(result.rows[0]);
}));

/**
 * Update patient profile
 * PUT /api/v1/patients/:id
 */
app.put("/api/v1/patients/:id", wrap(async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  const updates = [];
  const params = [id];
  let paramCount = 2;

  const allowedFields = [
    'full_name', 'phone', 'date_of_birth', 'gender', 'blood_group',
    'address', 'emergency_contact_name', 'emergency_contact_phone',
    'medical_history', 'allergies', 'current_medications',
    'height_cm', 'weight_kg', 'photo_url'
  ];

  for (const field of allowedFields) {
    if (b[field] !== undefined) {
      updates.push(`${field} = $${paramCount++}`);
      params.push(b[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  updates.push(`updated_at = NOW()`);

  const result = await pool.query(`
    UPDATE patients
    SET ${updates.join(', ')}
    WHERE id = $1
    RETURNING *
  `, params);

  if (!result.rows.length) {
    return res.status(404).json({ error: "Patient not found" });
  }

  res.json(result.rows[0]);
}));

// ============ Appointments Endpoints ============

/**
 * List appointments: /api/v1/appointments?patientId=...&date=...&status=...
 */
app.get("/api/v1/appointments", wrap(async (req, res) => {
  const { patientId, date, status } = req.query;

  const conditions = ["1=1"];
  const params = [];
  let paramCount = 1;

  if (patientId) {
    conditions.push(`patient_id = $${paramCount++}`);
    params.push(patientId);
  }
  if (date) {
    conditions.push(`DATE(slot_time) = $${paramCount++}`);
    params.push(date);
  }
  if (status) {
    conditions.push(`status = $${paramCount++}`);
    params.push(status);
  }

  const query = `
    SELECT
      a.id, a.patient_id, a.slot_time, a.duration_minutes, a.reason_for_visit,
      a.status, a.notes, a.created_at, a.updated_at,
      p.full_name as patient_name, p.phone as patient_phone
    FROM appointments a
    LEFT JOIN patients p ON p.id = a.patient_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY a.slot_time DESC
    LIMIT 100
  `;

  const result = await pool.query(query, params);
  res.json(result.rows);
}));

/**
 * Book appointment
 * POST /api/v1/appointments
 */
app.post("/api/v1/appointments", wrap(async (req, res) => {
  const b = req.body || {};

  if (!b.patientId || !b.slotTime) {
    return res.status(400).json({ error: "Missing required fields: patientId, slotTime" });
  }

  const result = await pool.query(`
    INSERT INTO appointments (
      patient_id, slot_time, duration_minutes, reason_for_visit, status, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [
    b.patientId,
    b.slotTime,
    b.durationMinutes || 30,
    b.reasonForVisit || 'General Consultation',
    b.status || 'scheduled',
    b.notes || null
  ]);

  res.status(201).json(result.rows[0]);
}));

/**
 * Get appointment details with clinical output (SOAP notes)
 * GET /api/v1/appointments/:id
 */
app.get("/api/v1/appointments/:id", wrap(async (req, res) => {
  const appointment = await pool.query(`
    SELECT
      a.id, a.patient_id, a.slot_time, a.duration_minutes, a.reason_for_visit,
      a.status, a.notes, a.created_at, a.updated_at,
      p.full_name as patient_name, p.phone as patient_phone, p.email as patient_email
    FROM appointments a
    LEFT JOIN patients p ON p.id = a.patient_id
    WHERE a.id = $1
  `, [req.params.id]);

  if (!appointment.rows.length) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  // Get clinical output (SOAP notes)
  const clinical = await pool.query(`
    SELECT id, soap_note, management_plan, patient_summary, created_at
    FROM clinical_outputs
    WHERE appointment_id = $1
  `, [req.params.id]);

  res.json({
    ...appointment.rows[0],
    clinical_output: clinical.rows[0] || null
  });
}));

// ============ Prescriptions Endpoints ============

/**
 * Get patient prescriptions
 * GET /api/v1/patients/:id/prescriptions
 */
app.get("/api/v1/patients/:id/prescriptions", wrap(async (req, res) => {
  const result = await pool.query(`
    SELECT
      id, patient_id, consultation_id, items, notes,
      pdf_url, refillable, refills_remaining, created_at
    FROM prescriptions
    WHERE patient_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [req.params.id]);

  res.json(result.rows);
}));

/**
 * Get latest prescription with SOAP notes
 * GET /api/v1/patients/:id/prescriptions/latest
 */
app.get("/api/v1/patients/:id/prescriptions/latest", wrap(async (req, res) => {
  const prescription = await pool.query(`
    SELECT
      id, patient_id, consultation_id, items, notes,
      pdf_url, refillable, refills_remaining, created_at
    FROM prescriptions
    WHERE patient_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [req.params.id]);

  if (!prescription.rows.length) {
    return res.status(404).json({ error: "No prescriptions found" });
  }

  const rx = prescription.rows[0];

  // Get linked clinical output if consultation_id exists
  if (rx.consultation_id) {
    const clinical = await pool.query(`
      SELECT id, soap_note, management_plan, patient_summary, created_at
      FROM clinical_outputs
      WHERE id = $1
    `, [rx.consultation_id]);

    rx.clinical_output = clinical.rows[0] || null;
  }

  res.json(rx);
}));

/**
 * Create prescription
 * POST /api/v1/patients/:id/prescriptions
 */
app.post("/api/v1/patients/:id/prescriptions", wrap(async (req, res) => {
  const b = req.body || {};

  if (!b.items || !Array.isArray(b.items)) {
    return res.status(400).json({ error: "Missing required field: items (array)" });
  }

  const result = await pool.query(`
    INSERT INTO prescriptions (
      patient_id, consultation_id, items, notes, refillable, refills_remaining
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [
    req.params.id,
    b.consultationId || null,
    JSON.stringify(b.items),
    b.notes || null,
    b.refillable !== undefined ? b.refillable : true,
    b.refillsRemaining !== undefined ? b.refillsRemaining : 2
  ]);

  res.status(201).json(result.rows[0]);
}));

// ============ Lab Tests Endpoints ============

/**
 * Get patient lab tests
 * GET /api/v1/patients/:id/lab-tests
 */
app.get("/api/v1/patients/:id/lab-tests", wrap(async (req, res) => {
  const result = await pool.query(`
    SELECT
      id, patient_id, report_name, report_type, test_category, ordered_date, result_date,
      status, processing_status, results, has_abnormal_values, interpretation,
      ordered_by, lab_name, report_format, file_name, confidence_score,
      processed_at, created_at
    FROM lab_tests
    WHERE patient_id = $1
    ORDER BY ordered_date DESC
    LIMIT 50
  `, [req.params.id]);

  res.json(result.rows);
}));

/**
 * Create lab test result
 * POST /api/v1/patients/:id/lab-tests
 */
app.post("/api/v1/patients/:id/lab-tests", wrap(async (req, res) => {
  const b = req.body || {};

  if (!b.reportName) {
    return res.status(400).json({ error: "Missing required field: reportName" });
  }

  const result = await pool.query(`
    INSERT INTO lab_tests (
      patient_id, report_name, report_type, test_category, ordered_date, result_date,
      status, processing_status, results, has_abnormal_values, interpretation,
      ordered_by, lab_name, report_format, file_name, file_size, mime_type,
      storage_path, confidence_score, extraction_model
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING *
  `, [
    req.params.id,
    b.reportName,
    b.reportType || null,
    b.testCategory || null,
    b.orderedDate || new Date(),
    b.resultDate || null,
    b.status || 'pending',
    b.processingStatus || 'pending',
    b.results ? JSON.stringify(b.results) : null,
    b.hasAbnormalValues || false,
    b.interpretation || null,
    b.orderedBy || null,
    b.labName || null,
    b.reportFormat || null,
    b.fileName || null,
    b.fileSize || null,
    b.mimeType || null,
    b.storagePath || null,
    b.confidenceScore || null,
    b.extractionModel || null
  ]);

  res.status(201).json(result.rows[0]);
}));

// ============ Vitals Endpoints ============

/**
 * Push vitals from mobile app
 * POST /api/v1/patients/:id/vitals
 */
app.post("/api/v1/patients/:id/vitals", wrap(async (req, res) => {
  const patientId = req.params.id;
  const b = req.body || {};

  // Check if patient exists
  const patient = await pool.query(`
    SELECT id, full_name FROM patients WHERE id = $1
  `, [patientId]);

  if (!patient.rows.length) {
    return res.status(404).json({ error: "Patient not found" });
  }

  // Update patient record with latest vitals
  const updates = [];
  const params = [patientId];
  let paramCount = 2;

  if (b.heightCm !== undefined) {
    updates.push(`height_cm = $${paramCount++}`);
    params.push(b.heightCm);
  }
  if (b.weightKg !== undefined) {
    updates.push(`weight_kg = $${paramCount++}`);
    params.push(b.weightKg);
  }

  if (updates.length > 0) {
    updates.push(`updated_at = NOW()`);

    await pool.query(`
      UPDATE patients
      SET ${updates.join(', ')}
      WHERE id = $1
    `, params);
  }

  // Create a vitals record (you might want to create a separate vitals table)
  // For now, returning success with the updated patient data
  const updated = await pool.query(`
    SELECT id, full_name, height_cm, weight_kg FROM patients WHERE id = $1
  `, [patientId]);

  res.status(201).json({
    success: true,
    vitals: {
      patientId,
      heightCm: b.heightCm,
      weightKg: b.weightKg,
      bpSystolic: b.bpSystolic,
      bpDiastolic: b.bpDiastolic,
      pulseRate: b.pulseRate,
      temperature: b.temperature,
      recordedAt: new Date()
    },
    patient: updated.rows[0]
  });
}));

// ============ Medical Records Endpoints ============

/**
 * Get complete patient records
 * GET /api/v1/patients/:id/records
 */
app.get("/api/v1/patients/:id/records", wrap(async (req, res) => {
  const patientId = req.params.id;

  // Get patient info
  const patient = await pool.query(`
    SELECT * FROM patients WHERE id = $1
  `, [patientId]);

  if (!patient.rows.length) {
    return res.status(404).json({ error: "Patient not found" });
  }

  // Get appointments
  const appointments = await pool.query(`
    SELECT a.*, co.soap_note, co.management_plan, co.patient_summary
    FROM appointments a
    LEFT JOIN clinical_outputs co ON co.appointment_id = a.id
    WHERE a.patient_id = $1
    ORDER BY a.slot_time DESC
    LIMIT 20
  `, [patientId]);

  // Get prescriptions
  const prescriptions = await pool.query(`
    SELECT * FROM prescriptions
    WHERE patient_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [patientId]);

  // Get lab tests
  const labTests = await pool.query(`
    SELECT * FROM lab_tests
    WHERE patient_id = $1
    ORDER BY ordered_date DESC
    LIMIT 20
  `, [patientId]);

  res.json({
    patient: patient.rows[0],
    appointments: appointments.rows,
    prescriptions: prescriptions.rows,
    labTests: labTests.rows
  });
}));

// ============ ABDM Integration Endpoints (Reserved) ============

/**
 * ABDM Health ID verification
 * POST /api/v1/abdm/verify-health-id
 */
app.post("/api/v1/abdm/verify-health-id", wrap(async (req, res) => {
  // TODO: Implement ABDM health ID verification
  res.status(501).json({ error: "ABDM integration not yet implemented" });
}));

/**
 * ABDM consent request
 * POST /api/v1/abdm/consent-request
 */
app.post("/api/v1/abdm/consent-request", wrap(async (req, res) => {
  // TODO: Implement ABDM consent request
  res.status(501).json({ error: "ABDM integration not yet implemented" });
}));

// ============ Generic Webhook Endpoint ============


/**
 * Generic webhook endpoint - accepts any JSON
 * POST /api/v1/webhook
 * Logs all incoming data for debugging
 */
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

// ============ Error Handler ============
app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  console.error(err.stack);
  res.status(500).json({
    error: "Internal server error",
    message: err.message
  });
});

// ============ Start Server ============
app.listen(PORT, () => {
  console.log(`PAL MCP API Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/api/v1/webhook`);
});
