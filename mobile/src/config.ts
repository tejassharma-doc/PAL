/**
 * App-wide configuration.
 *
 * API_BASE
 *   Release builds talk to production: nginx maps https://palcare.life/api/<path>
 *   to FastAPI /<path>.
 *   Debug builds talk to a backend on your dev machine. 10.0.2.2 is the Android
 *   emulator's alias for the host's localhost. For a physical phone on Wi-Fi,
 *   change DEV_API_BASE to your machine's LAN IP (and add it to
 *   android/app/src/debug/res/xml/network_security_config.xml), or set
 *   USE_PROD_IN_DEBUG = true to run a debug build against production.
 */

export const PROD_API_BASE = 'https://palcare.life/api'
// docker-compose.yml publishes the API container on host port 8001.
export const DEV_API_BASE = 'http://10.0.2.2:8001'
export const USE_PROD_IN_DEBUG = false

export const API_BASE = __DEV__ && !USE_PROD_IN_DEBUG ? DEV_API_BASE : PROD_API_BASE

/** The backend never returns a tenant; the web client hard-codes the same id. */
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001'

/** Per-request timeout. Chat answers can take a while (LLM + PubMed). */
export const REQUEST_TIMEOUT_MS = 30_000
export const CHAT_TIMEOUT_MS = 90_000
export const UPLOAD_TIMEOUT_MS = 120_000

/**
 * Default test account (created on the server by api/scripts/seed_test_account.py).
 * Only used to PRE-FILL the login form in debug builds — never shipped as an
 * auto-login, and the release bundle strips it because __DEV__ is false.
 */
export const DEV_TEST_LOGIN = __DEV__
  ? { username: 'paltest', password: 'PalTest@2026' }
  : { username: '', password: '' }
