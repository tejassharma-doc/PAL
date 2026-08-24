--
-- PostgreSQL database dump
--

\restrict nWROGm7Z1c3DIL2PEs1tQlJccukQgb3SDSfDdn12WA8MQKQQbI2pGwCbpY4gUcT

-- Dumped from database version 16.14 (Debian 16.14-1.pgdg12+1)
-- Dumped by pg_dump version 16.14 (Debian 16.14-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: appointmentrequeststatus; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.appointmentrequeststatus AS ENUM (
    'pending',
    'confirmed',
    'dispatched',
    'cancelled'
);


ALTER TYPE public.appointmentrequeststatus OWNER TO pal;

--
-- Name: consentbasis; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.consentbasis AS ENUM (
    'session',
    'standing',
    'per_query',
    'family_relationship',
    'provider_grant'
);


ALTER TYPE public.consentbasis OWNER TO pal;

--
-- Name: consentscope; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.consentscope AS ENUM (
    'full_record',
    'specific_dossiers',
    'read_only',
    'annotate'
);


ALTER TYPE public.consentscope OWNER TO pal;

--
-- Name: deploymentmode; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.deploymentmode AS ENUM (
    'self_hosted',
    'institutional'
);


ALTER TYPE public.deploymentmode OWNER TO pal;

--
-- Name: evidenceclass; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.evidenceclass AS ENUM (
    'source_backed',
    'user_canonical',
    'inferred',
    'statistical',
    'unknown'
);


ALTER TYPE public.evidenceclass OWNER TO pal;

--
-- Name: privacymode; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.privacymode AS ENUM (
    'strict',
    'session_consent',
    'standing_consent'
);


ALTER TYPE public.privacymode OWNER TO pal;

--
-- Name: relationshiptype; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.relationshiptype AS ENUM (
    'spouse',
    'parent_of',
    'child_of'
);


ALTER TYPE public.relationshiptype OWNER TO pal;

--
-- Name: sourcetype; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.sourcetype AS ENUM (
    'upload',
    'fhir_import',
    'manual_entry',
    'ai_extraction'
);


ALTER TYPE public.sourcetype OWNER TO pal;

--
-- Name: tenantrole; Type: TYPE; Schema: public; Owner: pal
--

CREATE TYPE public.tenantrole AS ENUM (
    'member',
    'caregiver',
    'provider',
    'operator_admin',
    'operator_developer',
    'operator_support',
    'operator_security',
    'operator_billing'
);


ALTER TYPE public.tenantrole OWNER TO pal;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.analytics_events (
    id uuid NOT NULL,
    user_id uuid,
    event_type character varying(64) NOT NULL,
    source character varying(32),
    ref_code character varying(128),
    doctor_id character varying(128),
    clinic_id character varying(128),
    metadata jsonb,
    ts timestamp with time zone DEFAULT '2026-07-09 09:42:59.629459+00'::timestamp with time zone NOT NULL
);


ALTER TABLE public.analytics_events OWNER TO pal;

--
-- Name: appointment_requests; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.appointment_requests (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    requesting_user_id uuid NOT NULL,
    session_id character varying(255) NOT NULL,
    action_type character varying(50) NOT NULL,
    action_payload jsonb NOT NULL,
    status public.appointmentrequeststatus NOT NULL,
    confirmed_at timestamp without time zone,
    dispatched_at timestamp without time zone,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.appointment_requests OWNER TO pal;

--
-- Name: appointments; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.appointments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid,
    patient_id uuid,
    doctor_id uuid,
    slot_time timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 30,
    type character varying(50),
    status character varying(50) DEFAULT 'scheduled'::character varying,
    reason_for_visit text,
    notes text,
    intake jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.appointments OWNER TO pal;

--
-- Name: attributions; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.attributions (
    user_id uuid NOT NULL,
    source character varying(32) NOT NULL,
    ref_code character varying(128),
    doctor_id character varying(128),
    clinic_id character varying(128),
    app_store character varying(32),
    install_at timestamp with time zone DEFAULT '2026-07-09 09:42:59.629459+00'::timestamp with time zone NOT NULL
);


ALTER TABLE public.attributions OWNER TO pal;

--
-- Name: call_sessions; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.call_sessions (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    doctor_id character varying(128),
    doctor_name character varying(256),
    patient_name character varying(256),
    appointment_reason character varying(512),
    status character varying(32) NOT NULL,
    call_state character varying(32) NOT NULL,
    transcript jsonb,
    appointment_booked boolean NOT NULL,
    appointment_details jsonb,
    lab_tests jsonb,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.call_sessions OWNER TO pal;

--
-- Name: clinical_outputs; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.clinical_outputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid,
    soap_note text,
    icd_codes jsonb DEFAULT '[]'::jsonb,
    snomed_codes jsonb DEFAULT '[]'::jsonb,
    management_plan text,
    patient_summary text,
    interactions jsonb,
    raw_api_response jsonb,
    processed_at timestamp with time zone DEFAULT now(),
    appointment_id uuid
);


ALTER TABLE public.clinical_outputs OWNER TO pal;

--
-- Name: clinics; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.clinics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    subscription_tier character varying(50),
    address text,
    phone character varying(30),
    email character varying(320),
    gstin character varying(50),
    settings jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    code character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.clinics OWNER TO pal;

--
-- Name: consent_grants; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.consent_grants (
    tenant_id uuid NOT NULL,
    subject_member_id uuid NOT NULL,
    grantee_user_id uuid NOT NULL,
    scope public.consentscope NOT NULL,
    basis public.consentbasis NOT NULL,
    dossier_types jsonb,
    granted_by_user_id uuid NOT NULL,
    granted_at timestamp without time zone NOT NULL,
    expires_at timestamp without time zone,
    revoked_at timestamp without time zone,
    revoked_by_user_id uuid,
    revocation_reason text,
    session_id character varying(128),
    active boolean NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.consent_grants OWNER TO pal;

--
-- Name: conversation_turns; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.conversation_turns (
    conversation_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    scope character varying(20),
    safety_category character varying(50),
    provenance jsonb,
    citations jsonb,
    contains_phi boolean NOT NULL,
    embedding public.vector(1536),
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.conversation_turns OWNER TO pal;

--
-- Name: conversations; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.conversations (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    title character varying(512),
    scope_tag character varying(50),
    consent_basis character varying(50),
    consent_grant_id uuid,
    hindsight_summary text,
    hindsight_updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    active boolean NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.conversations OWNER TO pal;

--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.credit_transactions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    delta integer NOT NULL,
    kind character varying(32) NOT NULL,
    pack_id character varying(32),
    tokens_used integer,
    llm_model character varying(64),
    amount_inr integer,
    balance_after integer NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.credit_transactions OWNER TO pal;

--
-- Name: health_facts; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.health_facts (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    fact_type character varying(100) NOT NULL,
    fact_key character varying(255) NOT NULL,
    fact_value text,
    unit character varying(50),
    recorded_at timestamp without time zone,
    evidence_class public.evidenceclass NOT NULL,
    raw_source_id uuid,
    derivation_notes text,
    provenance_chain jsonb,
    embedding public.vector(1536),
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.health_facts OWNER TO pal;

--
-- Name: lab_tests; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.lab_tests (
    patient_id uuid NOT NULL,
    appointment_id uuid,
    document_id uuid,
    test_name character varying(255) NOT NULL,
    test_category character varying(100),
    test_type character varying(100),
    ordered_date date NOT NULL,
    sample_collected_date date,
    result_date date,
    status character varying(50) NOT NULL,
    results jsonb,
    reference_range text,
    abnormal_flag boolean NOT NULL,
    interpretation text,
    ordered_by character varying(255),
    lab_name character varying(255),
    lab_location character varying(255),
    notes text,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.lab_tests OWNER TO pal;

--
-- Name: member_relationships; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.member_relationships (
    from_member_id uuid NOT NULL,
    to_member_id uuid NOT NULL,
    relationship_type public.relationshiptype NOT NULL,
    tenant_id uuid NOT NULL,
    requires_reconsent_at_majority boolean NOT NULL,
    majority_reconsent_completed boolean NOT NULL,
    active boolean NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.member_relationships OWNER TO pal;

--
-- Name: model_run_audits; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.model_run_audits (
    tenant_id uuid NOT NULL,
    requesting_user_id uuid,
    target_member_id uuid,
    conversation_id uuid,
    model_provider character varying(50) NOT NULL,
    model_id character varying(100) NOT NULL,
    prompt_version character varying(50),
    agent_name character varying(100),
    input_tokens integer,
    output_tokens integer,
    cache_read_tokens integer,
    phi_involved boolean NOT NULL,
    consent_basis character varying(50),
    egress_allowed boolean,
    latency_ms integer,
    success boolean NOT NULL,
    error_type character varying(100),
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.model_run_audits OWNER TO pal;

--
-- Name: otp_sessions; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.otp_sessions (
    phone character varying(30) NOT NULL,
    delivery_channel character varying(10) NOT NULL,
    delivery_address character varying(320) NOT NULL,
    otp_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    verified boolean NOT NULL,
    attempts integer NOT NULL,
    purpose character varying(20) NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.otp_sessions OWNER TO pal;

--
-- Name: patient_documents; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.patient_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid,
    patient_id uuid,
    kind character varying(50),
    title character varying(255),
    file_name character varying(500),
    mime_type character varying(100),
    size_bytes bigint,
    data_url text,
    uploaded_by_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.patient_documents OWNER TO pal;

--
-- Name: patients; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.patients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clinic_id uuid,
    mrn character varying(100),
    abha_id character varying(100),
    abha_address character varying(255),
    full_name character varying(255) NOT NULL,
    date_of_birth date,
    gender character varying(20),
    phone character varying(30),
    email character varying(320),
    blood_group character varying(10),
    address text,
    allergies text,
    chronic_conditions text,
    current_medications text,
    emergency_contact jsonb,
    photo_url character varying(500),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.patients OWNER TO pal;

--
-- Name: phi_audit_log; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.phi_audit_log (
    event_type character varying(100) NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid,
    subject_member_id uuid,
    conversation_id uuid,
    detail jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    id uuid NOT NULL
);


ALTER TABLE public.phi_audit_log OWNER TO pal;

--
-- Name: prescriptions; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.prescriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consultation_id uuid,
    items jsonb DEFAULT '[]'::jsonb,
    interaction_acknowledged boolean DEFAULT false,
    refillable boolean DEFAULT false,
    refills_remaining integer DEFAULT 0,
    pdf_url text,
    shared_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    patient_id uuid
);


ALTER TABLE public.prescriptions OWNER TO pal;

--
-- Name: raw_sources; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.raw_sources (
    tenant_id uuid NOT NULL,
    member_id uuid NOT NULL,
    source_type public.sourcetype NOT NULL,
    filename character varying(512),
    mime_type character varying(128),
    storage_path character varying(512) NOT NULL,
    content_hash character varying(128) NOT NULL,
    file_size_bytes integer,
    is_imaging boolean NOT NULL,
    is_document boolean NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.raw_sources OWNER TO pal;

--
-- Name: tenant_memberships; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.tenant_memberships (
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    role public.tenantrole NOT NULL,
    active boolean NOT NULL,
    member_record_id uuid,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tenant_memberships OWNER TO pal;

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.tenants (
    name character varying(255) NOT NULL,
    slug character varying(100) NOT NULL,
    deployment_mode public.deploymentmode NOT NULL,
    privacy_mode public.privacymode NOT NULL,
    baa_signed boolean NOT NULL,
    baa_signed_at timestamp without time zone,
    baa_counterparty character varying(255),
    operator_key_config jsonb,
    operator_key_configured boolean NOT NULL,
    daily_token_budget integer,
    per_user_daily_token_budget integer,
    age_of_majority_days integer NOT NULL,
    active boolean NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.tenants OWNER TO pal;

--
-- Name: user_llm_credits; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.user_llm_credits (
    user_id uuid NOT NULL,
    balance integer NOT NULL,
    last_refill_date date DEFAULT CURRENT_DATE NOT NULL,
    total_purchased integer NOT NULL,
    total_used integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_llm_credits OWNER TO pal;

--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.user_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    encrypted_token text NOT NULL,
    session_name character varying(100),
    ip_address character varying(45),
    user_agent character varying(500),
    is_active boolean NOT NULL,
    last_activity timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone
);


ALTER TABLE public.user_sessions OWNER TO pal;

--
-- Name: users; Type: TABLE; Schema: public; Owner: pal
--

CREATE TABLE public.users (
    email character varying(320) NOT NULL,
    hashed_password character varying(255) NOT NULL,
    id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    username character varying(100) NOT NULL,
    password_updated_at timestamp with time zone,
    password_updated_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    roles text[] DEFAULT '{patient}'::text[]
);


ALTER TABLE public.users OWNER TO pal;

--
-- Data for Name: analytics_events; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.analytics_events (id, user_id, event_type, source, ref_code, doctor_id, clinic_id, metadata, ts) FROM stdin;
\.


--
-- Data for Name: appointment_requests; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.appointment_requests (tenant_id, member_id, requesting_user_id, session_id, action_type, action_payload, status, confirmed_at, dispatched_at, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: appointments; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.appointments (id, clinic_id, patient_id, doctor_id, slot_time, duration_minutes, type, status, reason_for_visit, notes, intake, created_at, updated_at) FROM stdin;
a2c6c2e5-d152-44db-9141-1a23dcb800d8	\N	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	\N	2026-07-20 04:30:00+00	30	consultation	scheduled	General Checkup	Annual physical examination	\N	2026-07-17 07:37:10.20486+00	2026-07-17 07:37:10.20486+00
\.


--
-- Data for Name: attributions; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.attributions (user_id, source, ref_code, doctor_id, clinic_id, app_store, install_at) FROM stdin;
\.


--
-- Data for Name: call_sessions; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.call_sessions (tenant_id, member_id, doctor_id, doctor_name, patient_name, appointment_reason, status, call_state, transcript, appointment_booked, appointment_details, lab_tests, started_at, ended_at, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: clinical_outputs; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.clinical_outputs (id, consultation_id, soap_note, icd_codes, snomed_codes, management_plan, patient_summary, interactions, raw_api_response, processed_at, appointment_id) FROM stdin;
eb863721-3905-4c00-998c-ebb8f8e03295	a2c6c2e5-d152-44db-9141-1a23dcb800d8	S: Patient Tejash Sharma presents for annual physical examination. Reports feeling well overall. No acute complaints. Occasional headaches (1-2 times per week), manageable with over-the-counter medication. Exercises 3-4 times per week. Sleep pattern regular (7-8 hours).\n\nO: Vital signs - BP: 118/76 mmHg, HR: 72 bpm, RR: 16/min, Temp: 98.4°F, Weight: 72 kg, Height: 175 cm, BMI: 23.5\nGeneral: Alert, oriented, well-nourished, no acute distress\nHEENT: Normocephalic, PERRLA, TMs clear bilaterally\nCardiovascular: Regular rate and rhythm, no murmurs\nRespiratory: Clear to auscultation bilaterally, no wheezing\nAbdomen: Soft, non-tender, non-distended, normal bowel sounds\nExtremities: No edema, pulses intact\n\nA: Healthy 23-year-old male\n   - General health maintenance\n   - Routine health screening appropriate for age\n   - Mild episodic tension headaches\n\nP: \n   1. Ordered comprehensive metabolic panel, CBC, lipid panel\n   2. Advised continued regular exercise and balanced diet\n   3. Recommended stress management techniques for headaches\n   4. Follow-up in 1 year for annual checkup or sooner if concerns arise\n   5. Discussed importance of adequate hydration and sleep hygiene	[]	[]	Continue healthy lifestyle. Monitor blood pressure at home monthly. Follow-up after lab results available to review and discuss any findings.	Patient is a healthy 23-year-old male with no significant medical history. Annual checkup shows all vital signs within normal limits. Occasional tension headaches, well-controlled. Lab work ordered for comprehensive health screening.	\N	\N	2026-07-20 05:30:32.960678+00	a2c6c2e5-d152-44db-9141-1a23dcb800d8
\.


--
-- Data for Name: clinics; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.clinics (id, name, subscription_tier, address, phone, email, gstin, settings, is_active, code, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: consent_grants; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.consent_grants (tenant_id, subject_member_id, grantee_user_id, scope, basis, dossier_types, granted_by_user_id, granted_at, expires_at, revoked_at, revoked_by_user_id, revocation_reason, session_id, active, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: conversation_turns; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.conversation_turns (conversation_id, tenant_id, member_id, role, content, scope, safety_category, provenance, citations, contains_phi, embedding, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.conversations (tenant_id, member_id, title, scope_tag, consent_basis, consent_grant_id, hindsight_summary, hindsight_updated_at, deleted_at, active, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: credit_transactions; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.credit_transactions (id, user_id, delta, kind, pack_id, tokens_used, llm_model, amount_inr, balance_after, ts) FROM stdin;
\.


--
-- Data for Name: health_facts; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.health_facts (tenant_id, member_id, fact_type, fact_key, fact_value, unit, recorded_at, evidence_class, raw_source_id, derivation_notes, provenance_chain, embedding, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lab_tests; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.lab_tests (patient_id, appointment_id, document_id, test_name, test_category, test_type, ordered_date, sample_collected_date, result_date, status, results, reference_range, abnormal_flag, interpretation, ordered_by, lab_name, lab_location, notes, id, created_at, updated_at) FROM stdin;
5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	a2c6c2e5-d152-44db-9141-1a23dcb800d8	\N	Complete Blood Count (CBC)	blood	\N	2026-07-20	\N	2026-07-21	completed	{"RBC": {"unit": "x10^6/μL", "range": "4.5-5.9", "value": 5.1, "abnormal": false}, "WBC": {"unit": "x10^3/μL", "range": "4.0-11.0", "value": 7.2, "abnormal": false}, "Platelets": {"unit": "x10^3/μL", "range": "150-400", "value": 245, "abnormal": false}, "Hematocrit": {"unit": "%", "range": "38.8-50.0", "value": 44.5, "abnormal": false}, "Hemoglobin": {"unit": "g/dL", "range": "13.5-17.5", "value": 15.2, "abnormal": false}}	\N	f	All CBC parameters within normal limits. No signs of anemia or infection.	Dr. Rao	City Diagnostic Lab	\N	\N	7aa55545-ee62-44ba-be22-ecb8213068fd	2026-07-20 05:33:18.566539+00	2026-07-20 05:33:18.566539+00
5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	a2c6c2e5-d152-44db-9141-1a23dcb800d8	\N	Lipid Panel	blood	\N	2026-07-20	\N	2026-07-21	completed	{"HDL": {"unit": "mg/dL", "range": ">40", "value": 52, "abnormal": false}, "LDL": {"unit": "mg/dL", "range": "<100", "value": 110, "abnormal": true}, "VLDL": {"unit": "mg/dL", "range": "5-40", "value": 20, "abnormal": false}, "Triglycerides": {"unit": "mg/dL", "range": "<150", "value": 98, "abnormal": false}, "Total_Cholesterol": {"unit": "mg/dL", "range": "<200", "value": 182, "abnormal": false}}	\N	t	LDL cholesterol slightly elevated. Recommend dietary modifications - reduce saturated fat intake, increase fiber. Recheck in 3 months.	Dr. Rao	City Diagnostic Lab	\N	\N	6fd0a57e-0156-4957-b9dd-ba9585bfacf7	2026-07-20 05:33:18.566539+00	2026-07-20 05:33:18.566539+00
5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	a2c6c2e5-d152-44db-9141-1a23dcb800d8	\N	Comprehensive Metabolic Panel (CMP)	blood	\N	2026-07-20	\N	2026-07-21	completed	{"ALT": {"unit": "U/L", "range": "7-56", "value": 28, "abnormal": false}, "AST": {"unit": "U/L", "range": "10-40", "value": 24, "abnormal": false}, "BUN": {"unit": "mg/dL", "range": "7-20", "value": 15, "abnormal": false}, "Sodium": {"unit": "mEq/L", "range": "136-145", "value": 140, "abnormal": false}, "Calcium": {"unit": "mg/dL", "range": "8.5-10.5", "value": 9.5, "abnormal": false}, "Glucose": {"unit": "mg/dL", "range": "70-100", "value": 92, "abnormal": false}, "Potassium": {"unit": "mEq/L", "range": "3.5-5.0", "value": 4.2, "abnormal": false}, "Creatinine": {"unit": "mg/dL", "range": "0.7-1.3", "value": 1.0, "abnormal": false}}	\N	f	Kidney and liver function normal. Glucose and electrolytes within normal range.	Dr. Rao	City Diagnostic Lab	\N	\N	ff4bb5fd-60f2-4a95-aa92-edb8acf9064e	2026-07-20 05:33:18.566539+00	2026-07-20 05:33:18.566539+00
\.


--
-- Data for Name: member_relationships; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.member_relationships (from_member_id, to_member_id, relationship_type, tenant_id, requires_reconsent_at_majority, majority_reconsent_completed, active, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: model_run_audits; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.model_run_audits (tenant_id, requesting_user_id, target_member_id, conversation_id, model_provider, model_id, prompt_version, agent_name, input_tokens, output_tokens, cache_read_tokens, phi_involved, consent_basis, egress_allowed, latency_ms, success, error_type, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: otp_sessions; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.otp_sessions (phone, delivery_channel, delivery_address, otp_hash, expires_at, verified, attempts, purpose, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: patient_documents; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.patient_documents (id, clinic_id, patient_id, kind, title, file_name, mime_type, size_bytes, data_url, uploaded_by_id, created_at) FROM stdin;
\.


--
-- Data for Name: patients; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.patients (id, clinic_id, mrn, abha_id, abha_address, full_name, date_of_birth, gender, phone, email, blood_group, address, allergies, chronic_conditions, current_medications, emergency_contact, photo_url, is_active, created_at, updated_at) FROM stdin;
5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	\N	\N	\N	\N	Tejash Sharma	\N	\N	+1234567890	tejash@gmail.com	\N	\N	\N	\N	\N	\N	\N	t	2026-07-17 07:36:56.155215+00	2026-07-17 07:36:56.155215+00
\.


--
-- Data for Name: phi_audit_log; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.phi_audit_log (event_type, tenant_id, actor_user_id, subject_member_id, conversation_id, detail, occurred_at, id) FROM stdin;
\.


--
-- Data for Name: prescriptions; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.prescriptions (id, consultation_id, items, interaction_acknowledged, refillable, refills_remaining, pdf_url, shared_at, created_at, updated_at, patient_id) FROM stdin;
ba2dec0c-b368-43af-9fdd-03ef424ab043	eb863721-3905-4c00-998c-ebb8f8e03295	[{"name": "Atorvastatin", "type": "tablet", "dosage": "20 mg", "reason": "LDL cholesterol management (current: 110 mg/dL, target: <100 mg/dL)", "duration": "3 months", "quantity": "90 tablets", "frequency": "Once daily at bedtime", "generic_name": "Atorvastatin Calcium", "instructions": "Take with or without food. Avoid grapefruit juice. Monitor for muscle pain or weakness."}, {"name": "Ibuprofen", "type": "tablet", "dosage": "400 mg", "reason": "Tension headaches (1-2 times per week)", "duration": "1 month", "quantity": "20 tablets", "frequency": "As needed for headache", "generic_name": "Ibuprofen", "instructions": "Take with food. Maximum 3 times per day. Do not exceed 1200 mg in 24 hours."}, {"name": "Multivitamin", "type": "tablet", "dosage": "1 tablet", "reason": "General health maintenance and nutritional support", "duration": "3 months", "quantity": "90 tablets", "frequency": "Once daily with breakfast", "generic_name": "Multivitamin and Minerals", "instructions": "Take with meal for better absorption."}]	f	t	2	\N	\N	2026-07-20 09:32:29.220438+00	2026-07-20 09:32:29.220438+00	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae
\.


--
-- Data for Name: raw_sources; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.raw_sources (tenant_id, member_id, source_type, filename, mime_type, storage_path, content_hash, file_size_bytes, is_imaging, is_document, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tenant_memberships; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.tenant_memberships (user_id, tenant_id, role, active, member_record_id, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.tenants (name, slug, deployment_mode, privacy_mode, baa_signed, baa_signed_at, baa_counterparty, operator_key_config, operator_key_configured, daily_token_budget, per_user_daily_token_budget, age_of_majority_days, active, id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: user_llm_credits; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.user_llm_credits (user_id, balance, last_refill_date, total_purchased, total_used, created_at, updated_at) FROM stdin;
3f1ee229-1577-4464-8b7f-b2b75d818666	20	2026-07-09	0	0	2026-07-09 09:44:28.487959+00	2026-07-09 09:44:28.487959+00
6fcbcb84-2e41-4895-81ff-6fc4b42811e8	20	2026-07-13	0	0	2026-07-13 06:19:21.923733+00	2026-07-13 06:19:21.923733+00
082ccf48-6fe4-43a5-b23e-e549d717585a	20	2026-07-13	0	0	2026-07-13 06:34:24.967789+00	2026-07-13 06:34:24.967789+00
5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	20	2026-07-16	0	0	2026-07-16 15:30:31.698811+00	2026-07-16 15:30:31.698811+00
\.


--
-- Data for Name: user_sessions; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.user_sessions (id, user_id, encrypted_token, session_name, ip_address, user_agent, is_active, last_activity, expires_at, created_at, revoked_at) FROM stdin;
89ee055f-d44b-41bc-a31f-425283a7ee70	3f1ee229-1577-4464-8b7f-b2b75d818666	Z0FBQUFBQnFUMjE2UjNWbS1TamZjTTd0NU1xRFVSZU1vUmlWTFItYlI5VG9JdEdfaUNWRTBzRmdWZTdfaDAxRFhKaDJEMDdxMVExbG43eURuVEdQZzRLYVpoUmVxUDVIbkxBYzNDWWxNRnZUbWtHcHNFS29PWTYzV1lSRVlqSUI5cDNUZUNHQWlLSXo3X243aW9iWHZZSllkT1gwdlIyME9QMUJPR0hzcTRrdWVqSUdIOTdXaEFZX3JmeDNzbWlmamxST0JaVzllSXdPMWhwZlFGZzBPeUVUck96VER5TmlMNUtNb0kzdEhHem55cFZYQlJrMUZSc0R5dHNrSmJhUDNodU9KY014UXJhSEtmYXRiUXNwSGhWZGVhclkxdF9TeW9JQ0JHZ2dEMENabFZva2lCRHRnYlE9	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Sa	172.18.0.1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t	2026-07-09 09:44:26.930037+00	2026-07-16 09:44:26.930037+00	2026-07-09 09:44:26.930037+00	\N
e614c691-eb10-43b0-851f-dc984c1fad15	3f1ee229-1577-4464-8b7f-b2b75d818666	Z0FBQUFBQnFVSXBtX3J5bEE5bFVLYktqQ1I0Rkp3OEljbVlXaUE4bWdPZWhBYjR3aWVLWG1ZZFNia2ctTEpnZ2lWbkhQT0JwcS1vMnRmU29XY1I0bG50TThyeklETTkzNjhhYnFaRzYtVkRRR0xhc0lyMzBUMTZWbW5ZRmFoZkpuWHV1MUpsVmJjeU5YV20zaXJvdmdmMkt2R0pIdHE0eEwtMTZqRXZLU2o3bi0xQ0N6X3JYNTZhN0dVdDNiTURDWERvX2ZTWEZIS1JGQzNMUU9NZVRuVlhQdWJjd3VwOU1RYUdmTFgyOGhFdTZhYUVuQnRhYW82U2RPQzVOM09mQWRNZ2tENTdGMU1oamZXMW5SRV9sWnhmTG1VdlFDb2xRQTI5SzVtZFFsRmJxRS1rN042OEI5SVk9	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Sa	172.18.0.1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	t	2026-07-10 06:00:06.630497+00	2026-07-17 06:00:06.630497+00	2026-07-10 06:00:06.630497+00	\N
495c2a1e-9021-402c-b8a6-bd737f7a8acd	b984dc0f-057a-40e8-b0f3-ec35b8df08dd	Z0FBQUFBQnFVTVYzT2E4dGJmYWMzTWNzQkN5TkhYSHRCaFM4M3o3VkphcUU0bjNwUllseFpVbDFveFg2VE5qOTRsWDhMazZoQmlLaTdGQ1ItTUFYM3ZDdnlTT0VNR0N2R0ozSmUzLWFla1FmMFpqRWZWNDdSWHp6Tm5VOU1HQm1kamhXcXZRLVJvZ0t0UXRUbEVWN29mVXJQRkZNM3NhQ2F0UnJXWDFzQWJ4Z3FJcHVSOHlCZEJ3T0s4RXlwX1FBYUxadlpESDNjLXdtYmJ6MEdYTV90OGpyekFIWmFZRm8ybHB2eTJnclk4LXRnZ2lZVWlMLU01NTRibDExUlZ6TTZmU25LaWpZTkhHd19nSVdTdUo5dG95RkxrV3RjX1Z3d05UejhfY2dDX1Jjc0g0dEZ4RlZSRUE9	john_doe's session	172.18.0.1	curl/8.18.0	t	2026-07-10 10:12:07.75844+00	2026-07-17 10:12:07.75844+00	2026-07-10 10:12:07.75844+00	\N
60feccac-cc8e-42c6-bdcf-1ad1cb8fd248	1daefd00-e95c-4a83-aa30-6ad9cb1d3001	Z0FBQUFBQnFWSHlSbEZOQVQyWlpBNVgxUzNrbE1ycFdnMlUyZ2Z2aGFlczB4Ujlwdm8tclNhQUtsNHdFcXROM3hTazNfV21RV3JSZm5rMk9LVXc5d1lCTVdoQl9PRUh6Tm9wdHltSWtlVnU3MWFpYXdpQkh2U0VLOUVzYXg0Zm43azJaSkxqQlcwbkI1TjNWN1hRMm5vMGw3ZkM1LTlLMWlHRXVhd0h6SVNncDMxa0t2X2NHYnRZRlBERFl3NnRtSlNrNzhEWG82a0JZaG9IMXJCSG9hVklGX094Q3dtY1ZzQzE5R0pIa216LW91MkFySmc2WktPTHZBNWotaXJXdjBPczUtQ2ZRbVVRN1lncFgyeFBmdzhubEFoTmQzYXRwRjI4RlhGNGxNTnZhWmk3cHNpUHJISnc9	alice_wonder's session	172.18.0.1	curl/8.18.0	t	2026-07-13 05:50:09.888383+00	2026-07-20 05:50:09.888383+00	2026-07-13 05:50:09.888383+00	\N
38c2c6a5-3119-440b-a96a-b82d6db99b1b	ed441b39-3c6a-4cf5-abde-e5cca5681b9d	Z0FBQUFBQnFWSDNuajl2OGdJWFZJaXVVRkVjYkt2SU8wWERqeVlZYVc5WFJnZDBid25YQXRBOVdBYS16TzZ3MFN2Q0hidDluVE9hdEhaWUNiZUIxY09KX2hFeDdOUGtRQ3JDZFF5MkhkYUNtampkNTVzcmpES1NBdmwtcEM5M0l5eTdTaW5qaUFZLXFWS25EMnN0ejROUG5PRXBCeVZ4VElnOUo5dm9GMTVaWE1JWnhkYUZ3bFc3WTZLdjVPdjJhMURIOEJoNFYxRTE5anhpZGdIT0ktU3hTTVZERWcxNjhESkpXQWIyZUVlWEthREZzWGN6b2pFR0lmN2tDdXJCNThWemRXOU5veVltLVZDOTQySmEyLVlHSTlIVmlkWGdnNmlFLWliWHhnbGZQSVlBZGI4d1F6SE09	sharma2003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 05:55:51.872001+00	2026-07-20 05:55:51.872001+00	2026-07-13 05:55:51.872001+00	\N
0f13488d-a457-485b-b793-4de0cf52f3ad	ed441b39-3c6a-4cf5-abde-e5cca5681b9d	Z0FBQUFBQnFWSDQ3dWtuZlFPZk04aTMyeFdMYjJRMDB1VjU2SVAtUnlPdHNSc2xtLVhVOVlpdXhpc0J6S19aNUFINUZUQTZENFlNaEtDdWxNTHpQZXhQblA2ZW5BQzJ6NHVaTlUzc05US09mdy1uYi16Q3hPR1hISnhrOWJYWHJ5RkI1TWZ5TkhIaG02VVk3RGtQUE9HRTY0bU5udnhKc1RGZ2NzWlVsQWdfQTJQMzNGbVdsak9WWDNIcTVOVXVscmdiZncxcmhhWGJBc3NNcmFsMG5lbG9LVGwxSG9oV0JXZ2tmZFZLMFBmSVdXRndmM0s3ZTE3NUtFekM0S1MzNGJYNG9oeE9tZms0Xy1VQ2c2TGVwZ3d2d2lhbGl4MUNWX0VqLWN5RFB4QUpvZlRhTjBqNENSVUk9	sharma2003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 05:57:15.772574+00	2026-07-20 05:57:15.772574+00	2026-07-13 05:57:15.772574+00	\N
c8839c7d-8a27-478a-8406-8914c2e37768	ed441b39-3c6a-4cf5-abde-e5cca5681b9d	Z0FBQUFBQnFWSDVTZnk2LU1jYkVJUzlMelF3QmYyenBUZnBNMlZzck1YZU1wNU1QS0tzMHptQW5HN3VfUWhqVl9ld1JDVjljYkV2dUtlb2RlR2xIODBNTTdDUTByMkJoV0lyRUVSWFE5T2NhWDAxQzdPNVBlWVBxSHIydURCM2JoTjY1UE1iUURjVms2YjZpNHV2aDRrZmZDVEQwWFJ1N1Q3SmY2VHl6U2x1UWF3UnpFM0EwQkhRanBuNk5paVdVam5TTlI0S0VBeG9PTy1RQ2FMcnhzVWZIUWp1YWhMbEZZU2N0dkx5ak5yQ1llWnMzMnVaZDR0eGlEUTR1dFhLQ3IwWlRpbElkdl82VS1tdF9FV3NrS2RUYUtJa0FieVhNa2ZsVmRhQWhqQWl1N2h5YkJhZ3JKSFk9	sharma2003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 05:57:38.662546+00	2026-07-20 05:57:38.662546+00	2026-07-13 05:57:38.662546+00	\N
ddbd9a05-ece7-4726-a1e4-11d86f2f07f4	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWSUFybGtDM1ZON0x6SVhZTFRNNzhtcXRlWFpIOV9KdWNTa0FraG5lWjhfWlBoVjRxRWlIQXQ4cFBZcXRfblpXYmlEdmpZaWozbjhpMGdIT2w4N1BEcFdqbnBFaGMwX01XNVhYMDNpY1k4Y1dRWVlVZ1RjOTFQQUdXQ3NhTWExT3JYOEJXdUExeV8xaVpodEstaUtfZ0tCZ2NPM1lhUmhkb3VGN29JNFhINFJYUlEtaWtscUJpZnI5TGM3Tks3YkhUT1NUcEVhQWlpZFo4enh1YkROR2VES1RqdnptUEk0RkhfSGhrZnpCdnAyQmU4VkFhWjg0cE5EUnFidGNfakEycFhybDBxS0pxSlYzb0FaYnJ4eHdYN1VOd2tKNGFnWkRjQ25PcWZVSjlhUEhSM3M9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 06:05:31.97169+00	2026-07-20 06:05:31.97169+00	2026-07-13 06:05:31.97169+00	\N
20702dac-8507-4d68-980b-e1385464b587	33d0efcb-cda8-45e1-a776-7c9961bdcd4f	Z0FBQUFBQnFWSUZXakl3ajdaelZkcVNUd09oVmlRZjRONkxCMzl0QzdwakVqQ3VkcWE3dkllekM0WGlFVmN3cHNyZEhINUpDclBaZjF1dm9wTVpRVHVIRUtGRzA2ODltTWt6RHZyTFp5YVpyWG1IVm1wSjRzbExBODQ2dFF3ZGE0a0Q3dXZmRmpJX3NJMUgzQUFVNl9oYmJUdUdIbGFOb0F1clNEUjVxV0V5RHhZTDhGZ295VFpQNzVCSlgxVzUtTzFGRm1DcWp1bFhyWUdmOXJpM1ZBWFNPSF9MenJiV3NJZ0YzOXNLRkFwVkxzcVE2ZFI4NEZXVURsbV9wal80Y2pVX3d3aGpRUVhmMXdpRkdiWDl4d1J2Qi1nd2QtZkM2aEtXUmNzVmQ4VThzYnd5STdhZGV1MWM9	bob_test's session	172.18.0.1	curl/8.18.0	t	2026-07-13 06:10:30.613359+00	2026-07-20 06:10:30.613359+00	2026-07-13 06:10:30.613359+00	\N
80e17daa-64d6-4c6d-977c-3277759848f8	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWSVFWQkxPNE1sVlAtWUpTRjgtdEQ2Qml5Ty1nbkFDZHhtUk9YSzd5RXJpYVhPRERTcjZ0dWZnV2c0Q2tpYzU1b256a2ZLN01FeHJTYjFJV1lSQ1ZCMWxybTNTWS1hSDI2M2s0aHN5c0JYOEpFdFM5ek1Ud1RtZWIxUzlIUzVEU2pnYXRHaC1DbXN2VTViTDlvaTdhWGtlelU1OTdUOGtoSURjTHJRTi1LVGVETmdBZ2lTU3RMcXQyUTJ6eW5XU3dHS2VydGFhM0pYQ3RqU1BNOGtUTTdIQ3ZlWHJmTjlpZkdwc0NPNkV0NUlfMzRNZkNjazBFTWFGRGJjRmprYzVkaDBid0RadVhUZF9uZUNvbDFySm5vNmdTQV80ZnBmV1l3RUd5T2tVR0ZCMnVFQUk9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 06:22:13.618733+00	2026-07-20 06:22:13.618733+00	2026-07-13 06:22:13.618733+00	\N
7084b119-b4c8-4d39-9f1f-94a9558e18fc	082ccf48-6fe4-43a5-b23e-e549d717585a	Z0FBQUFBQnFWSWJNblgxYVFNVTFQYUVfSU4tQ0pvVVJfSEVGMU4zZkR6WVl0WEwzNmNNX2kyN0FlOFU1VzhCdi1qWWF1ZDhIdzNWOFZ2aktPQVpSNHlrdWw1eHc3M0JSZTVfZXZ6NVR0bWdlTEhUV0R4OTJGdWk3N3U3RFB2UUtqeWhGX09PVmkyN25VMnZTX2xHQnZPenRqdjhQUEtBUXZGSTJvbTBGVkF6U25QVU9aWXl0TWF0VkQ5VDdhNF8wYTNyblpNTG9Dei1pTTh0bk1zTFlZSEh0T1pySU1seUhKdnFxOWFUNmpzYWxRY0lnRmRGU2l5MHJkV3NnNWE1QTJobTJtVGJzTXJ3bUpmX2VqeTZseGl5NFlueDE2S0Q3R1A4UEEyazRpNHNXMmsyLVhvSFR4TWs9	newuser123's session	172.18.0.1	curl/8.18.0	t	2026-07-13 06:33:48.83939+00	2026-07-20 06:33:48.83939+00	2026-07-13 06:33:48.83939+00	\N
a0a92565-c36e-4634-957f-cdc5fddcd547	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWSWdic1hRUHNtZ29RMGJtYlRHYVpyN2ZiTVkzZW5MblVHWXctMVZKeWpiNGtKbXhiaDFnaHB0VHY3VjFja0d1R2JtZ0gydWNqMzF0M2VnYXM3UU8xTmUtRy14Z013anZKWFU0R2I1RmV4cU1iZDM2YUdQcnotNmdoZ0kxM01TcUFKTk9MbHgtY19mMjE5RC1VclcwVzBBN3QtblNneGJtaGtqcU90WmtXbm5NMGhEWUJYMy10RXdGUkg2bDNwaWNzeFR3NEY2d0FfRnJmSXA5RGhrSzJmVmZVc2Y2eV9EazhKVlZJLUpCS3EtbVJwOEN1RlFFZnVaLWpiR0VTeWF2SHYwX19zNlZoaWg3alBsSVVKRU9rRVc3dkVmclVHT3ExUmNBUHZ6UWgtUFJEb009	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 06:39:23.260031+00	2026-07-20 06:39:23.260031+00	2026-07-13 06:39:23.260031+00	\N
57020642-8cc6-4021-8b1a-4600aec8bb91	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWSWc2Zk9TTXQ1cEFEdnFxemF1SWFtb2dpU3gwSG85c3B2YmhfLXZGM3d1YnhmN0h3N0xGOHRxMjJmRE41eGI2R0UtaXVtcUNfSUNna0x3N0pPNEVXLUhJbm45WlFyX0xPcmJwNXkzZkkwQTRHbXExNXVHT3lNU2VmTkcwNFdGdjJ3cV9ybEtDMDdncmdndGtkc3VBY0FHamRpNHBhbVEwTTRnRkh5QXdzQ0M4YjR1SDRrX2RKMUVveHYweWhxRU9yWUJqcjBkNkRYajRibTlYbVhvdUxuSDdlSXpaVU5DNGJ0T3p0cVhqYlMtTDhJX1Y2WTZlOWhsUEduSDZNNG81a2hsMkVkanVKWTFhdlBfcngwUjlxNWFBWDRVVGEyTDFhSGNISWYwSGhZdE5jcEU9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 06:39:54.686207+00	2026-07-20 06:39:54.686207+00	2026-07-13 06:39:54.686207+00	\N
210df5d6-181d-464e-a092-2d8f39f5daee	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWSlRHYm9pVGJRYnA3U2pmdXd1MVlScmlZVDNidTNXWlBRM3hSOFo5RlNIdWs4NG4zWjRDVXRWMS1fbnJsZ3hVSG04M3VrdmRpVmtnV1hIaEtXNXJEd3VhVllpUGZuTWdia0hfNktwSFBIOTB3M1dscmEtSENWNXZYaDlDTmZIOElzTzBtOGJzMUZrNmt0ckV4SnhkUVlQMlhrMFVFTE5ZQXVxMW55bWczNGZoTnpOUWxQVko0a09QM1VCOGVhSmdaTUE5aUgwSy1hVWhES0dfZ25RVXRBYmtveXdnT29rNzBraWp2TnNDUkNsSV9KSXltTVlzSXRvVjgtaUs0MFppVmIwU21uekNsNEpjUVNOQkdSbkN0eXRuS2xrMWdkanBCSzREb2ZXVV9FaTZBY2s9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 07:33:26.095919+00	2026-07-20 07:33:26.095919+00	2026-07-13 07:33:26.095919+00	\N
c23bb4f7-3e6f-4cc6-b5f5-a1233c8ff573	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWS2R3VG5VN001WXU3MU51c2xBYy1OUGswczVnVFNzTm1OOGQzSWRjNmtjdzJCZTJWN3VsQnZYa3ExbVlvWlNzY3JmT0t0RlByM2Z6akRPU3RoeXM1V2c5Y01ZUjJ2QVBpMTFrbGtnWHA5N1hKSW5GYjExZHFCc01GNjVqc2dGQU9MSjFQeFlmelpQUk9rcWU3aGdfQWplUF9OZ3Y3eTNWMHN3VmxmbUlyaHpDdHJrbUZ6dmVpcGotTG9faHlmZkZPYWY3enR6MEw4c3NlSTNfZmlvM0VReURrdW9yeU9ROVNKenBxV2VUcnc3UUVlVGVKbUUzbjk5R2dyaTBFOVFWdGxQdGVCN2xjRTZ5b0RKMHJJWENPR3ZuZE5pOUMtUm9VZzdPNHZyTk11VkN5NnM9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 08:53:04.795529+00	2026-07-20 08:53:04.795529+00	2026-07-13 08:53:04.795529+00	\N
252b3a4a-ae88-4663-8c99-ecb6bd373594	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWTTNJYWM1WThUZkNKN2Mwa0tadF9zajMxZnpGbDgwT19PdUhPZEl1TTYwTnUyRTZwWmV0X0pvNmR3NUpDNmlYS0dXcE5ic0VhUDN1bXhWT1kwaDltMUhIcmo1aTN6UXBHSnYtU1ZtSkJKS2dvUFlUM3RWSDlZQmFvT2FWNlZaRGtqZVgxc1RuODZxLXd4SzRVa3A4ZVFKQnFMX2xvdDdocXZmbHdmTEN6cTdpeXZXS21DVDRDSjhQSkVraUs2c1dkekkwYXFsbTh0Y2c3bkZ6N0xnQ0RvcUxEV3FPR1ZieU9OUHdiNEZMZFZlTG5rREIzZU1mUzJoY04yLW1NbGJxWmo1MnhBUnBQX01yaVNYay16VG1WNXJrMkU5YXJkejRTNWNjeTMtdXdQcUUtLTA9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 11:36:40.834466+00	2026-07-20 11:36:40.834466+00	2026-07-13 11:36:40.834466+00	\N
99cc37b1-d2a6-4f8c-a3b5-76631bb30837	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWUFphZEQzYmRJc1NHbkYxbm1nbnc3bmJleWtYWWdmT04tTWhvWlRKRHhmakdNZHhZN0RqaTQxM1NHS3N1ejhFTnRPbkVFUmxxOHFlcmFtQzJLV0dJWWZXcTI5R0x0RWpnQ183am9WR3VOVlA1SFYyRWMyWm5fVm0zUXlPdUNGem5DazJ6dzdPUmxkcHlxeldmS2tJRG0yQ2ZIdEVVa1lGNTBNOUVqaVBJWVc0dEx3Q2ZCRHRWSzRMZHlrMzA0V0hBUU92Y1EybFhyTzB3SXF2THUzQlJ2RHNvdTFvWU1NNkoyd25tNHBIclMwMG5OcWw5SGZpNUlRamt6MkhodG9rZDZBNWNCTklpeVRXVzI0a1M4cFMxY2VERUdUcHU4clY1U3QxbVlYUkJ4SGY3Um89	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 14:29:46.494735+00	2026-07-20 14:29:46.494735+00	2026-07-13 14:29:46.494735+00	\N
4e63bed4-70bb-4906-aead-b3e82aa81ae4	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWUGdMNHJ4dnJRTC1qZ0lPd2J0Wkk1aWVpZEJ3V3dZN2g5U1d5aHZ3UVhOU0xFLU41WnVaU2stOWFqbWd0dklxdWxqUlU2SF9TMlNtbi13Sm11VkNBTm9qZUZCbUFjN2p2aEk4MnNUQzNyR2tzenZyblFFeDZ6ZzRKeE92dzFZUFRRNVM1dGFRWkdlYXZhNElqSkduTFk3akVidV83X3ljWXhUWXo0OEVucl8yZ3h2STBlZmxGWE5MTk1uNmt4SWp1bC1aZXJRSW9YZHVWZlpzZEIyc1hpNWdjTDltd05hWEtMZzFvNEptLTJKd0NfSHRLMkVkQmlueGJqZi1fQWhOeGNhVUlLM3Qxcm1hTWdEQS15OHR3YS0tYkRGZXNhU0lBdmtXTkhzVXZGU0h6MEk9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 14:36:59.301388+00	2026-07-20 14:36:59.301388+00	2026-07-13 14:36:59.301388+00	\N
4b1fc333-aa3c-4177-9563-95be7906223a	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWUHJsYzlrbThYNVJWUHhmNy1pZlhIQ1ZaMV8xWExxcFJNREVrdjc2d2UxWk9GeXlSWFR4ajhQVE5iVm43bXMxRUxiYU9zNlV4QVVfM055VXhoQWFBT3Z1ZXRNRk1SMExsUXBZNU5IX3IxVk5HS2tMUGRaYWQ4cVpXc0taVGNKM0J5aWNyWndDNnJOZ2hRSW9vU09hREJSM2JfNF9DTC0tYTlFa093VHlpOVhGU0QxTG81ZFA3SHdPYVp1TnZTdmg0S19KVTJPdVM5UGc5LVpKT01meE5tYTVWVDFwRHhKNjJlUUZNWnVQOWZUQkdFMFpNRkhCOXplRzNPbW9fSFotdWNMMDFFMTFXdWQ1TG9lVkg1OXdBdlFqeGtlZS04cUR3SmNraDBzRndSaUUwbWM9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-13 14:49:09.920396+00	2026-07-20 14:49:09.920396+00	2026-07-13 14:49:09.920396+00	\N
5067ee1a-ef9e-41d7-b6c7-9e8ba61c827d	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWY3RHUVhCTDhkZXpIQ0lkSjBIV3FfcWRGcFQ4TDB1MDlpc1ZRODhBcVdiSVVhUURzbDJMcjVqNUVYaXNjMlFwZVpMTERTU2RyQnVzY1g4WmVBc0hmWHJRcHgwTE5DcjY5R0k4TmZzV3N3ODduSXBMbDhCb2tlOHplVmtKVnozczlLX2R5OTE3Ym1lQzhGdldlRGJfTTREYi1VM0xCbk9PTTQ3ZTFySzFIVjhQMEU0dndkQl9jTzFOeHR3VUxPd3JGaUIxUjZZdGwwZVZvdXRSZjRFa1pXV2hzSW5mcWlNU1JHMUpEaTJjMVhPbWN3Wmw3UnA1blJaQkZSQmxUZFBmTHRudl9ZNkRvUTR6Qzl4dU9lNEZhUi12RmpCbmNrM1NNSl9ZYzU1NldVZmtBU0E9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-14 05:38:14.224496+00	2026-07-21 05:38:14.224496+00	2026-07-14 05:38:14.224496+00	\N
90ca1401-93ae-49ce-81c0-6ca5aa83d38d	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWZUV5VFUtQUkxZ3MzVmxNSGdfTWF1bkdwb0hYdHFxc1V1X3k0YlF5d3RaMk02eVVaUkR5T1hwbV9LakxVSG5QY2ZCOVFtVjlSTVFpQlZ0VXEyX3RUV2JTcHdXaHBmcVNGR3lia3F6am1aMVNTeTJBbDRSNW1hdllTTW8xRjItLXJwbC1XZGdQaWRJMVdpMjQ5bFhvOFJ0cnlUY0hoOUVjYU1IWjZlYXk5dkZfNF9wcXpKNUYwV3pCRktzOHBnQ2ExNTlsUG5xcF9NbDJOVE12aS1RaWEwRXZldFNaZnBwZDFDd2JUQU9pWmhtMURHWGlPTjFOYk9uXzZ4N0ZybmJ3R2hCLWNaZTZVcllrVV91Sm1VVW9LX2ZHeFBocDgyQndzeDg5dzl3eW9FOHR3bnc9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-14 07:11:46.819932+00	2026-07-21 07:11:46.819932+00	2026-07-14 07:11:46.819932+00	\N
8050fca1-d410-4e68-9c09-9fddec22f0a0	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWZjZ5NkFFM2NhYThUOWRkUEc1OUZGU0ZGemZJOHVQSHdDMUQxSUZfMUx2NXdaaEJxODdZbGRzcXZlenl1bFBGNmd6Q3ZzcXVxTlh4eG1jTXc1VWxEUk11YVlYWkJGSFJoNS1sZ2oxU1d6SmRJTXZMOU9JTG5OV1VFamI2YUc0cXJGc0x1Nk5wOUUxYkYydkNXcG1RdV8yS3JjTnQyRU1IcXRWTE54RVpCX0ttMmtYVTRtNVAxTFZnMVNVQ18tS25TSjdmM0NNQzVPSFY5Njg0b1pXUGtKdEFXallnVEVJWnFacGdqbkgtakI3bU9TZ3Y0TEt6NEdNUFptVllCY2VnV0dmTFlkNWtLNXl5ODdiYTYwRmVRT2VLVHpVbWJjLVlCamNwZ2wxRXFwNGUyS1k9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-14 09:17:38.874228+00	2026-07-21 09:17:38.874228+00	2026-07-14 09:17:38.874228+00	\N
78cafeff-1679-4312-92b4-419b5dfc7609	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWaUVoaS0yQXJxREY5OFMyVjQzSTQ1NzY2N3lPRUlJaHFWMmZTLWRFUUVuSnpIcnJmTm9NblItSjQ2N3k1V1o0YkwwSjBDMGExbnlaSzdOZGhndDhaT09oRTFCWW5PdEg5T3JIQ0FBOXVrZ3RyUHBHYmNFOHdfRVZsRmNkY0xLREpHWHBlaG44MWQ2UG9xSS1GMW9HMFowcml5OWNaYWNLOWtabGlhdFBla2l0N2RlTmRIVm5JT19fZG9CMUtGMmhOajdaNS13RHR1Qk5oZ3Y4cWZ3ZDRNTVRaX19FdlpBWElfMmtwOVNab2U0bFQtejJxTzQ2UDN2QU5udkZ1ak56ZTdCcW1qUC1NVVg5TVZ0aWw1SFdPeThubU1WZ3loaFFPbzlCSGhYNllkekJCRm89	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-14 11:44:33.809529+00	2026-07-21 11:44:33.809529+00	2026-07-14 11:44:33.809529+00	\N
98c70d5d-18a2-4a85-9ea2-27f32dcfe466	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWeVozRU1sZnB0RHE1MHc2WnNId2Z0cEQtZzhyUjNaQkhIcUlJd1NoS2Q1cXh0QUI2UWlaaWZNWkJQcGJMVU14cVdhQl9IOWd0YUowSGhGOTlreV9iV29hb3JjQUlBV25zcmtPa0RfNDFBcTdtbkhhTWR6THFlZTVrV241QzlSVm5oSFF2TWU2RnB0ZkJWZ0w4dVVzczdtdEFXMGNULWhwQkFvQ29zSlcxZ1U1dlFnLTB6eDhVVkxtcHJPSU1iVkVoeVNKRF9KcWljSXQ2eGUwQ3NSRUxyRDNtNE5JZVNnc2RWMlhyMzk2VFRJZDdOdGdDYzZhZDlJWld4anNVRkpvazRCZWF4RkZqeGhlaDFXT1BSdU1iVlZyTERiYmhYbXhpbXJUc0NMN0x4QkF5X2M9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-15 06:19:35.228666+00	2026-07-22 06:19:35.228666+00	2026-07-15 06:19:35.228666+00	\N
44d1b951-1f2a-4bb7-9928-a48be3b468e2	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFWM1JRZEZqRTBEZENvT3lPWUx5WGxqMk1mZG9mdVVudTBabGFtVDhfQkoxM1JIRXc1VEVxdVYtUElad2VVam9JY1poTU5QWDdpdDI3ZlYzdFBrVnBYcDJ5dGpZcVU4dVVJUklDNGVQS3ZIZi1IWWhsY0tBQzZHdms4a0hkRXRXdEJPREFEMElTYVprVENyTzItclVWTnJjNnpvanJsaXhCY3ZvaUx2eXdtZ0FaZGdFS1RGTjZaLVlYSmpnVmlNRDRxM05IMk5WUDRxZzExZnR1cGRjMzlCZDBVeGVhYkFiN1pST0tEOE5tUkhyTUx5TTlIV1RqZjZRRlVoeHFMclpMczlWc1dobUNaUWtwTXgta1NNWkxVWk9VVlFza2U3MlpTbmR0ZlNXNDZ2N3VJWU09	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-15 11:51:44.149365+00	2026-07-22 11:51:44.149365+00	2026-07-15 11:51:44.149365+00	\N
4fe2bbae-e251-4a23-a6c5-a22e8ac57914	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFXSE5UWnpwVkwySWw5QWNZckFTYzJQangtSUFna2pNS0J5WlFMX3lLVkFpWURIRFEwWXoyWDYzZVcwQXNCejJXcVEzWHFjYjNBby1XNy1YNVV4UUU0LVR2OUNtclY3dnRzN1E4emVjcmNWOTREd2VLRmFHYlp6THhFbXdVcllpcUNHeC1aQ2NzR2NpSDN6TXlWQ21OaV90a2NwN1cycm1ERmZ0Mm1pVkJCMTVfcDZDMDRtM0RscGJVVDlDNFRGbTJWNXJsT3BTdm1WbWNGMlA2NVpIQlNnNzFMa0MwRkNHMG1Rd3hFcG1JbGdmYVJobFlBTW0wTFItZkc3X2RndExTVGZMSnA3MVM1Wi1mQkNJOFd2S2o0WGNiSmdxa0YzTlB1cTlQWnlfdndCOEVlZUE9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 05:59:47.166749+00	2026-07-23 05:59:47.166749+00	2026-07-16 05:59:47.166749+00	\N
31854c77-a80a-4053-9bd7-9b4d231d547a	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFXTkdoNEZVUlp2NFNpa0Yyd3p4UWdqN212NmZnRTdEV1M5X0hfVWN2WWNndHdRb1dBd01DNDY3WUFkRW1Edi1aRU05SVg4Y1doSVE5alNORTEzTlZUWGtmdmJWTzJKaGsweGFPRVdua3lRTU1PVzZGNG5RVlNGY1BwaWpjeXdHcWVsOXM5VS0zMFJfbVJ3T0I0cGljbFNLZVRoWnVSV0NFOGVuRGhFTVllZlc1czdEY2N6TkE5c1h0SHRTdEhiT01VNURJbDlPSHVoMTZBZHh1dEdwYzhTS1E5RTV6TE9Bel94M3ZXd2NGbHR1SFNxQmIyWXFWYU5aVGFfSGhJZU9UbGhCQTE4RTNMbXZUQ200cTNmbGNhWVByckVUekt2dC1aLVFyNFN0V1BycFhwU009	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 12:42:09.540321+00	2026-07-23 12:42:09.540321+00	2026-07-16 12:42:09.540321+00	\N
798e82e3-ef91-4d7d-b4ef-f795bec8e31a	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFXT0taSlY5TDVHMmUxSEJ1RVF6SnhqWHV1T2pDM3EtT3hTOW1UcGhfdWFOQnBxOGNuRkZFcHhkR3hZX0RRancwTmtaOERhaVkyXzRRUFRBQVRYR1gwRW5YY0Nkek1qVGM3NTd6NEZ4cEVpWkV3S3lpSDdlWmVwTDF2a3BJRllWT3pYRjFVLXJWaFNDemhsZ25YbGtxMWgyZFdsVHhlLVhiVHNBOWdJbG42dlZ0ZkRxTXJzUHJiMlJydVMwRjBreFhpdWFuTGhrb3l5LXh5TmxILVpTLWRLNFZ3b09welpkRGJTajNocFlMTXBpcE53RlVVczZQbmJrcUMtT0RHamdIckZYVGw2WEIzWHoySU9WNkJLN3BHQUs0M0d0ZTl1Q0c0SEp2U2czQ1hUVXNsS1U9	sharma18's session	172.18.0.1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 13:54:33.722674+00	2026-07-23 13:54:33.722674+00	2026-07-16 13:54:33.722674+00	\N
ee6e6de5-cec5-466d-a5b6-edf54c40a5bc	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFXT04zbFVBci0tRTdUNE9MMllQaVRYRFR2ZjJXT3FQblNGcXNXbjA2LUY3VzRycGFXSUlGcTkyNDk4WXl2UFpSRHVfVWhYeUxUYjM0dGVPNEVwRTNXbVdGZEN3NVVMSXdjX0ljQmhHNDZEak1mcV9LbGVGTlZYMjhtS1Y2dnpVbXluTVNJajdtd2RJNkV5dG1wRDFSeWY4aWhaSGJpam9SZHNwemFPelJkdDdhNUttMW51QW9fa3ZGalkybDh2dVdJRE9CSHpGS0tvQUE4U1VKcFc5bFpoRkl3Z3pXLVpVcE0yaEF0OUlOYjk0LVNmb19ZYlNlWDJ4LUJVOGp1QWc0TDlOWmVVYlpjbjF6RThFZEtsSWV1ejJPRHgtSTFPcXpRSXJHQ1ZVODZ3U1BxMkU9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 13:58:15.760101+00	2026-07-23 13:58:15.760101+00	2026-07-16 13:58:15.760101+00	\N
dbbb470b-a5b2-4db2-8bc3-978860d554b7	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	Z0FBQUFBQnFXUGFWRmEzdUN4dnhDTjlpczJVRWR5SDVzZGRNNF92VWw3UGllUlFyODFWZWpIZDhOYVY2NFU2Z2N5ajlwX1g2Y3BwRHdBR2xGV2xORXhvbFVReERNZlpIUXdYdm9uQm9nak5MNkpJT0JhQWlPOS1SbnVpUlg3WndNa0hfUE5DalBLMUwybzlhOHdIRGVjYktVT3ZneWlQc1hKYTlVTi1GZ3p6Y3BZajdZeUZ1UndBX3UtUUhlTkcwUEkyYnhCcVVOaU0tZE13UWtJcmZ3RGlKT24yaWFQRkhzOUFDQUp2THJTU1gtdjNOZGt4c2VPQUpqZ2dpcjMwOHNNbWwwX3BZblp1OTdDRG44WlFkWEs2dGdwTTZPc0tsU2cxQkswQWhqUjhWU2psU25QX0txS2M9	sharma18's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 15:19:49.477121+00	2026-07-23 15:19:49.477121+00	2026-07-16 15:19:49.477121+00	\N
2a49b21b-6a71-4f5d-b495-d4e618390a96	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXUGtYUGQ1eUpQRGwyR3hRVkJQZmtETWU3LV8tRnpBamd3U0Y0YTFmdzA1ZmlqZF95X3pCSDl1NWxYdlhUSWlTRG1JSUl0OTctT1NiNE90VGtFbjdhbE1RNnNvMmduNmdlbGlYR0cyaDZfWXZLSW9XcVRZSHp3dEF5amNyYXFzWHNRb1ZzbGEzZHg2WTFfOUxVYWE4bVZHb0U0ay15LVU0S2psZEc2blpaNXFaWmtzUFBzblF1c0pWeFZGNGZjTGhyekU3b3hmalVrN1RNcjdhYVV6ZFhLT2VvWFREWGlsbGllX0tLcktrOGtaMmVZblR1b0gzd1FKRkhubXU1RXdmWHdFa0dISEhaUVZXNlJTUnIwWkZXeDNlcnBWYU12WHQzcWVHVnlYVFdJZWRNaVk9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 15:30:31.509397+00	2026-07-23 15:30:31.509397+00	2026-07-16 15:30:31.509397+00	\N
9257f929-f470-4d0a-97e0-175e49811f6c	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXUUJpWnpwUGRiV3UzQ1l2S0hpM2FCdDRmakpXYkp1V0pDdUtnS0ZHRDVHWjNTYXdVZkR4RFQ4aHdOa0t0a2Z2T2NBa2xETGxDSm5XZlRtT0Y1UHloMHpJUWlqZ05pUU16OFhhSk9hWkhLb3FtcHJfdWhwenozMUxwcFBTWWd4aVNOaDRhS2RfaWpna1JpZ0x4dDR2Uk1EdjdsTUtNZWR2QVhPbl8xZTdERGF4QW4teWFIVmY4aHpfYTZibmg2blVVeWhoVXltdFZWcU1lZmVPdE95Q3RxTG1ucWdOakNDNTVzZGZPSHVVQTc2a0tuWmFZekNnNkhZWm1xdkNDWnNLOFBWSllHRkNCU0lsTzJ2clJSeGZwMFZZUXAzOXhoZXZWUUhKTEh6bG9HdFQtSnc9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 16:01:38.493968+00	2026-07-23 16:01:38.493968+00	2026-07-16 16:01:38.493968+00	\N
ed5100dd-2e2b-4c73-b843-452cb4f79e1f	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXUlJMOEtld3dPQ3BHWjV2UkNodkZwcVZjaC1SZVdfZUU2MDYxOXBDcnp2eVZjb3VQTk52dFN1MXJoZERZTklNRkR4ZHg1R2FsRlpxZUo1NXREY05rdFY4clEzTU9YVHhnaE1lQWdzTmh3aUp6eUZHMjlaV29uNGwyVWVONGNZTUdheEp3Z2hwMzZXRk8tU1VHcFkyZDZZZ0NIV1h0WTkwWmVfR1MwWDlCMzhQQmxUNzc1d3Q5SjFnUzM0Z3hlVEdteHUyQXNEdmcyS1lLczZjbFNsU3lTODJjQXVyVlR1b01ONzdRc0RhcUdkRC0wc2YxbEg0dldib1V2eDc5OFlhTEVRQmV2RHk2aVBjNU5lSGw1ZHB3WnAxcVNuaDF0SENnd205d2VncGQzVTA2UWs9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-16 17:26:35.802936+00	2026-07-23 17:26:35.802936+00	2026-07-16 17:26:35.802936+00	\N
76b284a1-b159-4390-bfbf-e6e29f04a778	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXY1dqUlJYNDdzMEQ2QXVlV2JOUXJuQXBfd0E5eklEeWhSSm93SFoyVlR6OFdfSGNwX1RybEhEekxfNkc4LS1wZ2Zuczd3a19aaVZOa0laTUZSOGFNSXBzamljMXIzbVBZbmowS2dHSnFabFhBbXR2SUw1dXk5QVBjUW5oX3JlZEl5bWtmeFhjN0Ytb1htcG52TVk3ejRvVElzZGlUUHZiUnRXeVk0bF9HbEdwU29FOEpsaXdRdHplcHhzY042QTl5dVpSUER5eEM0LWNLYVAtOEVIeHVxQmQ4N1BQbmZMUklXUmM2MVBadGRPb0Y2VXhfZk1kc1U1b04yamVxMGJ0MkNCMzR3M3JQdEtUYjRXdXdYN09Zei14cUdlSm41QnJ4RDhzclZBaWd3SWxqY2c9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-17 06:03:15.6014+00	2026-07-24 06:03:15.6014+00	2026-07-17 06:03:15.6014+00	\N
2e7bb706-17fd-40d4-a4db-5a19d0ad7178	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXY2VRVkY0OXM1SkpGcWpXQXEwOUhEelhaVFdKMEJYRnBmWUhhVGwtdXJkRnNmaTdLUWM3NHB0TndDVnBFVnJkM3NyTE9TbVQtQmsweGZqbkFVc1VmRHpid1VhekFjeThtb1Z5Z3d4NFVvWGRQN2hpa2pzTVYzU1NQY1RJb2tKd1RQcERHTlEtM1VGUGpnR3A3QW8wVllLSnFTRWRMN0pMN0M1ZUR6NWFUaGQ0Y0ZKTWZJSGJYUXBaNXRLbDdyTk9oNmtQMEdVV2lkNDN4QjZvLXlqX3Ezc1FGQVNsdUprR1Iwa2VsRmZ5N1g1enBHSVF5WFpmVkIyNHBYMXMwckMteHlja21IOE1YYWJXeE5BVnlQUWZmYlY5OWRicjdtT2ZVdm44UmhnblFYNExWcTQ9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-17 06:11:28.321987+00	2026-07-24 06:11:28.321987+00	2026-07-17 06:11:28.321987+00	\N
637d90f7-6b00-4186-80e6-225c656ce0c8	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXY2VyVDZCWkROYl90bU1hNjdCMzFYam9pY21YWERVTnZ1ZjFhc3Zxc2RuOGNUeVo4ZDE4SlZueHgwbnF5ZXVBZ2pnWElydGtSWnZZRHJvWlRPcW1ZcDljTWY4QWlic3Rnd1U0T2FSNkN6YklEXzVZTFl2VHllTGd5Y0hJOERlNkQ4MzBJa2Rla2ZvU1dIU3hwUFl6MDJoU0ptWnE1dUl6N215X3I1cUhES3ZyS1lHdzBWVURtaFdkakdiSHRWU3FTZTBWS3VrWGVQcXE4UEw2WE9sNUU1REdxTXJ4cWJJU05xZGUwQjNMYndqYVFoOHU2Y253WGRFY2ZteHRNN1o0TUc0Zk5tZFRFWDhsT05DMWs3M2FPWWNFVUhFb0piM2pXT1ltZmREQ19iREIxOGM9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-17 06:11:55.878635+00	2026-07-24 06:11:55.878635+00	2026-07-17 06:11:55.878635+00	\N
20215995-15f0-46a2-88e3-8970c2931457	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXZEk1amdZemp4VlBxWXlxaG00Y2xpUFBiX21WRTZEckZhU0pObTc0djY4SUJWRFZxUWM3UWRVSDZFcklReXFkOGlaSnF3ZXFoQ2FGcS1rck1ZVUlBWndyREdxU25oUlNjLVhTWDdmUEU5NmtjU21JdjMyQ2dib0FfYnd2bUJheG1jUWNRU1B3T3hfY3BudWNzOGNNbFZtSFpSQTQ3ejdvT19ZNlE4c0lIcHBfN1BpVXB1Zm9oT3JHTFMtVWUxakx5Z0NDV1ZEeUl0SEFTZnpoTlJ0SC15RmZJbWVLLV9uczlGNWhMY2dmQlhFWFFUb0s2Z25NWlJMbWZIbjFVTjJsSDZFWnRBc1pYWnhHYlRYNDNJLVVhdDgxalFLMEQydXVrV3ZPOGZqLWIwM0xCb289	sharma182003's session	172.18.0.1	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-17 06:56:57.918218+00	2026-07-24 06:56:57.918218+00	2026-07-17 06:56:57.918218+00	\N
343206fa-432e-48ef-ad45-136a90aa18a8	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXZE12aHpFSXVBS3RRM3haUHU3Z2lwSDhTQXVvam0zeUlWSGxfWHI0dE1XamlOMVB0Q3FpN0dOZlp5aWlzekhTV3BmQk9aVVBPYkJTUF81NEhlRHNaSlUteTcwcWgta2JnaktUUEJrdVZLNTVnaDdiaVpsR01rVWg4dm5iZ0hPVVl0WUFNV3FoUm1hdW95NWNiYVBJTld0bWZoWHBaQkdvUWlvb1FTenJ4VU9ERHVmVFRMWHdfMjUzUkk0X0U2bWNCcXpwR1JZYl85ajVCeDlQS3NSX0E1eGJiUWFFRy1odmVYZ2hyQWo0VlJ0azVVdWYxSzJScHR2SVloYW9wc1g2RjROMzJoOEd3NHFUTzNZX3RNYlVmOHBXTk5iaFlVckhEdFBMTzJCWHV4STBHTVk9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-17 07:01:03.970421+00	2026-07-24 07:01:03.970421+00	2026-07-17 07:01:03.970421+00	\N
9905d013-97b9-4c3b-a222-ef511e5ccc5b	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFXZzU5ZGdmT0tJR1Bjd0oyWUxIU0N4aUNlaHFPMmVxTVU1MGFsaGJ3UUNCYW0tQTRzZmk4MmkxbE1RbC15RUxKcmFlcUVnWnpXY0VCanZZQTE3N0tUdEZmVEROZGFSZGoyRWdKMWpfQVhhdWtwcVdYMDdoX0xhZEVOT1dRWmNldWpFazNxQ1M5UDFwbEpDN0hEUXhUUmc1VXpxOFR4aFRkQndDUFNtVi1jVmxqLVNLNEp2SjJnSVJCNDJVb0tacmIzdFpJcE9jQU5Tb3BTaEVlcW4ta2ljSUZpNW5tS1hEUXZoclJOYWlaRFBSZDZ0ZUMzU0F0R0Z5ZU9kc2JQc3dISlp6WDYxcmZYYTZEajhFOFFtaWFfbzY0M19hU0x6NkhYSEh1aUwxVGlXanR3UkE9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-17 11:14:05.088684+00	2026-07-24 11:14:05.088684+00	2026-07-17 11:14:05.088684+00	\N
b47be230-e1b3-4185-9fa9-de4a95d1319b	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYYXBlelVYY3NYWVJZSy0wVkt1VGhOc0IzSzJCWkI4OVZSc2tlWWlDS0ctWXh2SWtHSldHQlJ1YjFiajgzREZhMWpscjJVc2F5SndPRmNzSHdpX0tkWjR6XzhKbW1GRDdQU3RMTTJzZ0UxeVQ4U01uSXlOREUyeEdKUnpvdmVROWlvc2NoNEM4WE9HOHZSa2UtSThuUVpGTnRxLU4wRjFlR3JVZF9xWURoNk5GS1c4VElNTTFuLUNLVHd4ZXhFWW93a012N0xDa2NlaWlLWVREcmZ2VmVNV2hRV0F1d093Rkl6bzJQamIwNjZyTXc1WnFNZEtBU3M3R1VyTjVyY3gzTHcwbmdVWlZYTVA1dkI3QnhVSzAwX0l2czNpa3NOQVd5VHBzbHdvV2RhTDQxTzQ9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 04:55:58.700743+00	2026-07-27 04:55:58.700743+00	2026-07-20 04:55:58.700743+00	\N
de1908ad-d22f-4664-b424-6da83d47ae13	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYY1YyVTIzOHRnMF9LeHBFMWFORF90OE9OSjNVeEJWaHU4ZHJ2cENNU3hReTR5RXNrSm9DUm9WRXFFZ2Y5MzIyaV9yVGZRMnVoMnQ3TGM2RTBBQWpiNTN6ZkxUY25TSGJaRHdPVEFMZU9zTGxRVXpZZ3FMRmduU0I0U05mdHZuWmIxQ2tZbC0ya3pFY05zdGpjcEQzVjZaWWZ6aVdaLXQ0a2xmSXNoSkVIYkZMcG05TWZnbkoyQUQxSXFqR2p0X3lJU1FrcVlHR0tiUm9obnl5YXpjOUQxMTBkY0x4RXZhQWJOMWl6LUhyaE9Dem5OSklRakZvbVBfYzFmeDdDVjk4aEp2SGxmQW95SUg4TmhNdDN0c2F0am5qRWtMbFVEczg4V2pWNGNJRTF5dVVsMG89	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 06:51:34.198234+00	2026-07-27 06:51:34.198234+00	2026-07-20 06:51:34.198234+00	\N
bfdd9941-1793-48c0-9ba0-8d9acb7436ff	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYY1pkc0NsakZlM21FbXZhRUdzNDRvWGk3NENKMUhxTUNQZ3ltVGlUMDhLVlFZSXpJUldXTjZjSFFRbnhLVUIxNktQT3VkOExhbHVUODhmRUVrUWlXQ0JIa0RNSjNlc1U0STJJZTZUdnFTWWhpSkhvUGFJbU1CY0xCeHlpaldQZ1RsbUw3LUJ4QnI4dkpBUHJheENCTHE0SUlQbndRc2c4MWtUTmk4UTlkQXl1Q0xxMW9yUWF5aENSa0I4VXdFZ1VncElKVzMyS2E3MkN2ZDIwWkZBRVZyNWNXR3ZIcVFXd2pUcmY3OHVzbGZmZE90MTcxcTFxdXF0eGVBRDB0QVQtcThubWprN2ZJdVRSMXlDSEJ5ZXg1TWo4aXpMUWZXeDJuMWtlVWNzdHVWMlNTSlE9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 06:55:25.660764+00	2026-07-27 06:55:25.660764+00	2026-07-20 06:55:25.660764+00	\N
b3abd708-91bc-4fee-96a0-a2c45ec43aca	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYY2UzTjhlNHhuRjBYTVhwMnIzOHZNUk0yYWhvUDN4NzBYT2FTakJUc2RrNWFJVURvcXNGdUxwaExIRjhmWS1KTDhpMXFZQzU3WnhRTWEwT1RLOUI5ZjBraEEzMExHamVBM3FtVDZwMHltbTFRSkhKZlYzZE5KQkdrSVBiVnc1N05xM1h3UzR2V01tNVdBWE5lOF82UWZyN0pJYVhlMDdaMTlMOWJmR0l5REFDdmdTRkRpLWNKQ2NkR3IxYldiVFIycjdhbFIxaTQyTDdkQUZTVTVWM2drRVZ0ajBXbC12Vkd4M0Jwd3EweFg1MGg3TlRQQ3Zlb0JZZkEyM19zcE9BVWJlYjBnVWhUcF8wZXp3djhNRjdfMld6b1FlcnJxblBoTmVnYVYyQ3F3MjBBcDQ9	sharma182003's session	172.18.0.5	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 07:01:11.792116+00	2026-07-27 07:01:11.792116+00	2026-07-20 07:01:11.792116+00	\N
ca4f4183-8f0f-4909-b2b9-6383c8b7caba	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYZFNINVZMVy1sd2t2b1l1U0xfejdBQTVFZlUyWWVpMVpjX0kzdXpYODhfZlhWOU1ack9leHVhM1FCZVdEU3UwNng3V0dQbXJLbXJhT0VUdEVKVHFGNWN2MlhfX0k2M2FvdFFZQ0RUenZCWkRxZEV4Z3haeVEtcFg5ZG5vcVRySF9iVlg2aUUzcTh5TGh4VDYyVFRwbG9aVklReExTOENLQ2dXLVdKTnJibEJTb0dtVXhTc0V3R1JPOHItY1J6SWUxYlFfOVhoc2lkc0tBZXpGV0hqSUtQemQ4ZmNxb3JoQmN0UmRydkhCWkVXWHdrY0V6Q0h3T3ZEOWlYMzF4RFkxOF9pQWhnekltTWRsQ3BHLUdaeHhoV0c0QUY1MUZCOEhreVdXamI5UDdicW5ob0U9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 07:55:51.380313+00	2026-07-27 07:55:51.380313+00	2026-07-20 07:55:51.380313+00	\N
f59e1ec6-1710-486c-95c8-353f99f7f0d3	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYZXBDR2RzZmttUXNEamFqaTY0NklXNXNYRHd3ck51MTUyVk94dk9Fb2ttSVJicXhVd1VTX2xjRFQ5dG1uTS03WnpOV2RkMFphZnRYT3BtMEtxZlBqclJoTHRPUmFPYXVsRnFuLWdpZHhpT1JHSTBBVkp0UExpc05YU0VLT1czTHVKbEloQ1pvWWZCeVJWdzJPSGd6UzgzWmV1eXRIUXAxajRWa0VXbDhfTV84LW1MVmJjR1E4cGlPeWJTY1JNLXlCMkc4S2FybHVoV1JTdGhDdHJTcno4anVuUVE5dkZJYTlnUlBGRnlfaFQ5aDVCbXRqeFVUdHItZm9RUUx0clRMbWFVeFhFUi1WTWF6YVlLLVVqbGU3dHg5azBxZUtubTRwMnQ3b094Ym14OTdjTWM9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 09:28:34.572214+00	2026-07-27 09:28:34.572214+00	2026-07-20 09:28:34.572214+00	\N
2c9f1845-b839-4539-aae6-e1cb22fa84e0	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYZkEzdXdHZTg0SkJRNHdXRjhoM0E2WFFpbk5GLUgtNjFmZDdWcU5KYUhrcWEzTGNQdVF5SVFGR2hzMXFoNi13MF9VS2lSSHZKYS00UkdHbVpnOC1pVFpNM0ZpTVdzMk92WGN3VFdzcUgwSDYxTnU3UWZGWFdpcUtTY1J0LUpiSVdaS2ljT0h5dVlqRUR3TE9oakFpa3kxbUUxa0hmZ0N4ekhoTXBOdmRpdy1kUnNvYi1WVUt0M3VFSktiUVhZNk51c1VLRDFEMjhZbWNHcTFMVURCeWRvOExzVGxmY0RrRERvMGJFVUpzVk1fakF4N0JKUkJ1UVppdzE0X2ZMdlhWYlU5djBpZWVOcUdJOGRDcDhCY2JEX05BWXUxLU9vZnF5bE11M3JKYVVKcWU4Smc9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 09:53:59.835402+00	2026-07-27 09:53:59.835402+00	2026-07-20 09:53:59.835402+00	\N
2c9775e0-cecf-4ba3-8874-10580d214b4c	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYZkd6NVAzZldJbU5kZkRaM3kyS3d6eGhuT0ZidnZBdmtjZENObVBQREZldjc2cXVQaUtyX3YyTEE0NkFDSjZ0RzFKZUlQTTNBZXhDZnNpWjVSc1NGVndqY3dONkc4MHp2YXlJQmFKdFY3d1ZxTXlpY1JJWWFSU3ktNXBWVG53VVd5dDFIUGpWU3JCUGVRMGNGLTdaMmotUU80U05HNVl1RTZEcllicjJhcXJpaUVPZnpqQkxzM2ZUSDRxX2F1aXVFUWoxS25ERy1HanBaUENiWjNHZ29UM1kxVWUtT21UcFY0YzUxRWY4UG9WS3lISUFLVWRYQnVRM2NvYzFJdVZ2TG83bnZZbmFsYVJOLXJOQkF5RE80X0dXV2tUTG85OTlLd01ENzBSOUs0dUlURjA9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-20 10:00:19.046799+00	2026-07-27 10:00:19.046799+00	2026-07-20 10:00:19.046799+00	\N
840e24cc-e98d-4a7a-b3ef-87c4e0b4945b	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	Z0FBQUFBQnFYeENDSEMwazdkMk9pOWI5QzRoQlM2VkFEb2dobkpCMnVCeEd3b01pQVBTdVNzTUFDa3hpYUNXWW9LYU9UQTBpM0c3a1IyVGNQWjdPOW9hako2bVBEYXp3b1BTVE5jU2VLX3MtalcwTG1Sc1U0QlBXN1I5V05TY1REQ0xLTF9VZ2JjT2J1S3g2bEdJT3hOVjdoMzRJMXpVbXVqd3RsX1A2YV90alE1dWV4M0gxVFdmM2ZKZnRFN3hDWndBb2w2d19JeU5LUVZRaTV1cXUweEVqRTZBay1MRXFTVzZ6emRCQ0tnSDdjTnUzcTB0aTloczRwQTExTnZzVFNraENSX3JaZmtpNTBMd2VsUmhpWXFrTGs2WGVNd2tZV3E4QU5jd3VtNGYzc09oazNzU1prLUk9	sharma182003's session	172.18.0.6	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36	t	2026-07-21 06:24:02.630273+00	2026-07-28 06:24:02.630273+00	2026-07-21 06:24:02.630273+00	\N
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: pal
--

COPY public.users (email, hashed_password, id, created_at, updated_at, username, password_updated_at, password_updated_count, is_active, roles) FROM stdin;
test@example.com	$2b$12$4vBFEXUJaQzwTI9djIMygOT9/tEjwBclGdgIhZf61/gWLnnORG7Xm	95ed7407-7a15-4a27-966c-37dc8bccb6a6	2026-07-10 10:09:20.674502+00	2026-07-10 10:09:20.674502+00	testuser	2026-07-10 10:09:20.927284+00	0	t	{patient}
testuser@example.com	$2b$12$zPM7kVVM1T4e/ur2mqD5uebckqAVyFUT30UWXh21bsFI/DN1H6wYW	38e9964e-61d6-43aa-80d8-9863a5d6487e	2026-07-10 10:09:58.558969+00	2026-07-10 10:09:58.558969+00	testuser123	2026-07-10 10:09:58.811306+00	0	t	{patient}
john@example.com	$2b$12$/spH970pv4TWIkLvmUeJaO1ENw3jorxJxHWkZqoL5C84Uyl5v5/rC	b984dc0f-057a-40e8-b0f3-ec35b8df08dd	2026-07-10 10:10:16.379587+00	2026-07-10 10:10:16.379587+00	john_doe	2026-07-10 10:10:16.625814+00	0	t	{patient}
jane@example.com	$2b$12$i2G0V2qg2JBKUmT7ksidburCuEg2jGkbpnwiZwSmR4FPqH5s0Mzx6	4ee25e8a-735f-4297-b6d1-92f7268bcca6	2026-07-10 10:10:39.682883+00	2026-07-10 10:10:39.682883+00	jane_smith	2026-07-10 10:10:39.953015+00	0	t	{patient}
alice@example.com	$2b$12$XRcJaCOmE9jLAnklzy.s4ecNsEUXql9yCRBkWxu/dj2eE/2U5lRLi	1daefd00-e95c-4a83-aa30-6ad9cb1d3001	2026-07-13 05:50:09.616387+00	2026-07-13 05:50:09.616387+00	alice_wonder	2026-07-13 05:50:09.858021+00	0	t	{patient}
tejas.sharma@docmode.com	$2b$12$ob2IK8b6KtwN5v8Gx5an8ecbBG8na670qTv4ts1pKVZUUXxuyce.S	ed441b39-3c6a-4cf5-abde-e5cca5681b9d	2026-07-13 05:55:51.42769+00	2026-07-13 05:55:51.42769+00	sharma2003	2026-07-13 05:55:51.76451+00	0	t	{patient}
tejas@gmail.com	$2b$12$NHgDr5OYOfAbmvoeUEzcsumrq7WEKguRtK9/tGXJRm3aREKesYxPi	6fcbcb84-2e41-4895-81ff-6fc4b42811e8	2026-07-13 06:05:31.677834+00	2026-07-13 06:05:31.677834+00	sharma18	2026-07-13 06:05:31.941021+00	0	t	{patient}
bob@example.com	$2b$12$E/1KoQZXNt/elJtnEHScAu/4oT.VmeZehXQJ9F3RJy.sbTJuLAZRq	33d0efcb-cda8-45e1-a776-7c9961bdcd4f	2026-07-13 06:10:07.773573+00	2026-07-13 06:10:07.773573+00	bob_test	2026-07-13 06:10:08.022308+00	0	t	{patient}
newuser123@test.com	$2b$12$PLk0jU7Cw2i96MJOhwUFW.f81FYLKgTlWfwWCK2tK5D1mP2HA3suS	082ccf48-6fe4-43a5-b23e-e549d717585a	2026-07-13 06:33:40.589315+00	2026-07-13 06:33:40.589315+00	newuser123	2026-07-13 06:33:40.854956+00	0	t	{patient}
tejash@gmail.com	$2b$12$6pH2ofxIsNv1xc/DLaBWUOrReJDmxn.Vj16cy/ns1KBgEV9jVqRtq	5e44a95d-d09c-4f46-b92c-9bc4c08ecdae	2026-07-16 15:30:22.676177+00	2026-07-16 15:30:22.676177+00	sharma182003	2026-07-16 15:30:22.939294+00	0	t	{patient}
\.


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: appointment_requests appointment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.appointment_requests
    ADD CONSTRAINT appointment_requests_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: attributions attributions_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.attributions
    ADD CONSTRAINT attributions_pkey PRIMARY KEY (user_id);


--
-- Name: call_sessions call_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_pkey PRIMARY KEY (id);


--
-- Name: clinical_outputs clinical_outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.clinical_outputs
    ADD CONSTRAINT clinical_outputs_pkey PRIMARY KEY (id);


--
-- Name: clinics clinics_code_key; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.clinics
    ADD CONSTRAINT clinics_code_key UNIQUE (code);


--
-- Name: clinics clinics_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.clinics
    ADD CONSTRAINT clinics_pkey PRIMARY KEY (id);


--
-- Name: consent_grants consent_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.consent_grants
    ADD CONSTRAINT consent_grants_pkey PRIMARY KEY (id);


--
-- Name: conversation_turns conversation_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: health_facts health_facts_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.health_facts
    ADD CONSTRAINT health_facts_pkey PRIMARY KEY (id);


--
-- Name: lab_tests lab_tests_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.lab_tests
    ADD CONSTRAINT lab_tests_pkey PRIMARY KEY (id);


--
-- Name: member_relationships member_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.member_relationships
    ADD CONSTRAINT member_relationships_pkey PRIMARY KEY (id);


--
-- Name: model_run_audits model_run_audits_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.model_run_audits
    ADD CONSTRAINT model_run_audits_pkey PRIMARY KEY (id);


--
-- Name: otp_sessions otp_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.otp_sessions
    ADD CONSTRAINT otp_sessions_pkey PRIMARY KEY (id);


--
-- Name: patient_documents patient_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.patient_documents
    ADD CONSTRAINT patient_documents_pkey PRIMARY KEY (id);


--
-- Name: patients patients_abha_id_key; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_abha_id_key UNIQUE (abha_id);


--
-- Name: patients patients_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


--
-- Name: phi_audit_log phi_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.phi_audit_log
    ADD CONSTRAINT phi_audit_log_pkey PRIMARY KEY (id);


--
-- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);


--
-- Name: raw_sources raw_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.raw_sources
    ADD CONSTRAINT raw_sources_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_key UNIQUE (slug);


--
-- Name: users uq_users_email; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_email UNIQUE (email);


--
-- Name: users uq_users_username; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT uq_users_username UNIQUE (username);


--
-- Name: user_llm_credits user_llm_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.user_llm_credits
    ADD CONSTRAINT user_llm_credits_pkey PRIMARY KEY (user_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_appointments_clinic_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_appointments_clinic_id ON public.appointments USING btree (clinic_id);


--
-- Name: idx_appointments_doctor_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_appointments_doctor_id ON public.appointments USING btree (doctor_id);


--
-- Name: idx_appointments_patient_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_appointments_patient_id ON public.appointments USING btree (patient_id);


--
-- Name: idx_appointments_slot_time; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_appointments_slot_time ON public.appointments USING btree (slot_time);


--
-- Name: idx_appointments_status; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_appointments_status ON public.appointments USING btree (status);


--
-- Name: idx_clinical_outputs_appointment_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_clinical_outputs_appointment_id ON public.clinical_outputs USING btree (appointment_id);


--
-- Name: idx_clinical_outputs_consultation_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_clinical_outputs_consultation_id ON public.clinical_outputs USING btree (consultation_id);


--
-- Name: idx_clinics_code; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_clinics_code ON public.clinics USING btree (code);


--
-- Name: idx_clinics_is_active; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_clinics_is_active ON public.clinics USING btree (is_active);


--
-- Name: idx_patient_documents_clinic_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patient_documents_clinic_id ON public.patient_documents USING btree (clinic_id);


--
-- Name: idx_patient_documents_kind; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patient_documents_kind ON public.patient_documents USING btree (kind);


--
-- Name: idx_patient_documents_patient_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patient_documents_patient_id ON public.patient_documents USING btree (patient_id);


--
-- Name: idx_patients_abha_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patients_abha_id ON public.patients USING btree (abha_id);


--
-- Name: idx_patients_clinic_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patients_clinic_id ON public.patients USING btree (clinic_id);


--
-- Name: idx_patients_email; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patients_email ON public.patients USING btree (email);


--
-- Name: idx_patients_is_active; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patients_is_active ON public.patients USING btree (is_active);


--
-- Name: idx_patients_mrn; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patients_mrn ON public.patients USING btree (mrn);


--
-- Name: idx_patients_phone; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_patients_phone ON public.patients USING btree (phone);


--
-- Name: idx_prescriptions_consultation_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_prescriptions_consultation_id ON public.prescriptions USING btree (consultation_id);


--
-- Name: idx_prescriptions_patient_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX idx_prescriptions_patient_id ON public.prescriptions USING btree (patient_id);


--
-- Name: ix_analytics_events_doctor_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_analytics_events_doctor_id ON public.analytics_events USING btree (doctor_id);


--
-- Name: ix_analytics_events_ts; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_analytics_events_ts ON public.analytics_events USING btree (ts);


--
-- Name: ix_analytics_events_user_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_analytics_events_user_id ON public.analytics_events USING btree (user_id);


--
-- Name: ix_appointment_requests_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_appointment_requests_member_id ON public.appointment_requests USING btree (member_id);


--
-- Name: ix_appointment_requests_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_appointment_requests_tenant_id ON public.appointment_requests USING btree (tenant_id);


--
-- Name: ix_attributions_doctor_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_attributions_doctor_id ON public.attributions USING btree (doctor_id);


--
-- Name: ix_call_sessions_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_call_sessions_member_id ON public.call_sessions USING btree (member_id);


--
-- Name: ix_call_sessions_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_call_sessions_tenant_id ON public.call_sessions USING btree (tenant_id);


--
-- Name: ix_consent_grants_grantee_user_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_consent_grants_grantee_user_id ON public.consent_grants USING btree (grantee_user_id);


--
-- Name: ix_consent_grants_session_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_consent_grants_session_id ON public.consent_grants USING btree (session_id);


--
-- Name: ix_consent_grants_subject_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_consent_grants_subject_member_id ON public.consent_grants USING btree (subject_member_id);


--
-- Name: ix_consent_grants_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_consent_grants_tenant_id ON public.consent_grants USING btree (tenant_id);


--
-- Name: ix_conversation_turns_conversation_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_conversation_turns_conversation_id ON public.conversation_turns USING btree (conversation_id);


--
-- Name: ix_conversation_turns_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_conversation_turns_member_id ON public.conversation_turns USING btree (member_id);


--
-- Name: ix_conversation_turns_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_conversation_turns_tenant_id ON public.conversation_turns USING btree (tenant_id);


--
-- Name: ix_conversations_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_conversations_member_id ON public.conversations USING btree (member_id);


--
-- Name: ix_conversations_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_conversations_tenant_id ON public.conversations USING btree (tenant_id);


--
-- Name: ix_credit_transactions_ts; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_credit_transactions_ts ON public.credit_transactions USING btree (ts);


--
-- Name: ix_credit_transactions_user_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_credit_transactions_user_id ON public.credit_transactions USING btree (user_id);


--
-- Name: ix_health_facts_fact_key; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_health_facts_fact_key ON public.health_facts USING btree (fact_key);


--
-- Name: ix_health_facts_fact_type; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_health_facts_fact_type ON public.health_facts USING btree (fact_type);


--
-- Name: ix_health_facts_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_health_facts_member_id ON public.health_facts USING btree (member_id);


--
-- Name: ix_health_facts_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_health_facts_tenant_id ON public.health_facts USING btree (tenant_id);


--
-- Name: ix_lab_tests_abnormal_flag; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_abnormal_flag ON public.lab_tests USING btree (abnormal_flag);


--
-- Name: ix_lab_tests_appointment_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_appointment_id ON public.lab_tests USING btree (appointment_id);


--
-- Name: ix_lab_tests_ordered_date; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_ordered_date ON public.lab_tests USING btree (ordered_date);


--
-- Name: ix_lab_tests_patient_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_patient_id ON public.lab_tests USING btree (patient_id);


--
-- Name: ix_lab_tests_status; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_status ON public.lab_tests USING btree (status);


--
-- Name: ix_lab_tests_test_category; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_test_category ON public.lab_tests USING btree (test_category);


--
-- Name: ix_lab_tests_test_name; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_lab_tests_test_name ON public.lab_tests USING btree (test_name);


--
-- Name: ix_member_relationships_from_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_member_relationships_from_member_id ON public.member_relationships USING btree (from_member_id);


--
-- Name: ix_member_relationships_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_member_relationships_tenant_id ON public.member_relationships USING btree (tenant_id);


--
-- Name: ix_member_relationships_to_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_member_relationships_to_member_id ON public.member_relationships USING btree (to_member_id);


--
-- Name: ix_model_run_audits_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_model_run_audits_tenant_id ON public.model_run_audits USING btree (tenant_id);


--
-- Name: ix_otp_sessions_phone; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_otp_sessions_phone ON public.otp_sessions USING btree (phone);


--
-- Name: ix_phi_audit_log_event_type; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_phi_audit_log_event_type ON public.phi_audit_log USING btree (event_type);


--
-- Name: ix_phi_audit_log_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_phi_audit_log_tenant_id ON public.phi_audit_log USING btree (tenant_id);


--
-- Name: ix_raw_sources_content_hash; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_raw_sources_content_hash ON public.raw_sources USING btree (content_hash);


--
-- Name: ix_raw_sources_member_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_raw_sources_member_id ON public.raw_sources USING btree (member_id);


--
-- Name: ix_raw_sources_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_raw_sources_tenant_id ON public.raw_sources USING btree (tenant_id);


--
-- Name: ix_tenant_memberships_tenant_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_tenant_memberships_tenant_id ON public.tenant_memberships USING btree (tenant_id);


--
-- Name: ix_tenant_memberships_user_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_tenant_memberships_user_id ON public.tenant_memberships USING btree (user_id);


--
-- Name: ix_user_sessions_user_id; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_user_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: ix_users_email; Type: INDEX; Schema: public; Owner: pal
--

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);


--
-- Name: ix_users_username; Type: INDEX; Schema: public; Owner: pal
--

CREATE INDEX ix_users_username ON public.users USING btree (username);


--
-- Name: appointment_requests appointment_requests_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.appointment_requests
    ADD CONSTRAINT appointment_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: appointments appointments_clinic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;


--
-- Name: appointments appointments_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: clinical_outputs clinical_outputs_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.clinical_outputs
    ADD CONSTRAINT clinical_outputs_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: consent_grants consent_grants_granted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.consent_grants
    ADD CONSTRAINT consent_grants_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES public.users(id);


--
-- Name: consent_grants consent_grants_grantee_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.consent_grants
    ADD CONSTRAINT consent_grants_grantee_user_id_fkey FOREIGN KEY (grantee_user_id) REFERENCES public.users(id);


--
-- Name: consent_grants consent_grants_revoked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.consent_grants
    ADD CONSTRAINT consent_grants_revoked_by_user_id_fkey FOREIGN KEY (revoked_by_user_id) REFERENCES public.users(id);


--
-- Name: consent_grants consent_grants_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.consent_grants
    ADD CONSTRAINT consent_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: conversation_turns conversation_turns_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.conversation_turns
    ADD CONSTRAINT conversation_turns_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: health_facts health_facts_raw_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.health_facts
    ADD CONSTRAINT health_facts_raw_source_id_fkey FOREIGN KEY (raw_source_id) REFERENCES public.raw_sources(id);


--
-- Name: health_facts health_facts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.health_facts
    ADD CONSTRAINT health_facts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: lab_tests lab_tests_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.lab_tests
    ADD CONSTRAINT lab_tests_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;


--
-- Name: lab_tests lab_tests_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.lab_tests
    ADD CONSTRAINT lab_tests_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.patient_documents(id) ON DELETE SET NULL;


--
-- Name: lab_tests lab_tests_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.lab_tests
    ADD CONSTRAINT lab_tests_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: member_relationships member_relationships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.member_relationships
    ADD CONSTRAINT member_relationships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: patient_documents patient_documents_clinic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.patient_documents
    ADD CONSTRAINT patient_documents_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;


--
-- Name: patient_documents patient_documents_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.patient_documents
    ADD CONSTRAINT patient_documents_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: patients patients_clinic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.patients
    ADD CONSTRAINT patients_clinic_id_fkey FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;


--
-- Name: prescriptions prescriptions_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.prescriptions
    ADD CONSTRAINT prescriptions_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.patients(id) ON DELETE CASCADE;


--
-- Name: raw_sources raw_sources_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.raw_sources
    ADD CONSTRAINT raw_sources_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: tenant_memberships tenant_memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships tenant_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: pal
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict nWROGm7Z1c3DIL2PEs1tQlJccukQgb3SDSfDdn12WA8MQKQQbI2pGwCbpY4gUcT

