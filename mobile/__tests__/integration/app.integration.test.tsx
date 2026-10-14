/**
 * End-to-end UI tests: the real app (navigation, screens, API client) rendered
 * in Jest and driven like a user, talking to a REAL PAL FastAPI backend.
 *
 *   PAL_TEST_API=http://localhost:8000 npx jest __tests__/integration
 *
 * Skipped when PAL_TEST_API is not set, so plain `npm test` needs no server.
 * The backend must have the default test account seeded
 * (api/scripts/seed_test_account.py) and these flags on:
 *   UNIVERSAL_SEARCH=true MEDICATION_REMINDER_ENABLED=true FAMILY_PLAN_ENABLED=true CHAT_ENABLED=true
 *
 * Only two things are faked: the file picker (no Android file chooser in Jest)
 * and — in the tests that say so — single LLM responses, because a test
 * server has no AI key. Every other request hits the backend.
 */
import React from 'react'
import * as fs from 'fs'
import { Alert } from 'react-native'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import App from '../../App'
import { clearSession, saveSession, loadSession } from '../../src/lib/session'

const BACKEND = process.env.PAL_TEST_API
const d = BACKEND ? describe : describe.skip

// ── network plumbing ─────────────────────────────────────────────────────────
type Override = (url: string, init: any) => any | undefined
let overrides: Override[] = []
const realFetch: typeof fetch = (globalThis as any).__NODE_FETCH__ ?? globalThis.fetch
let NodeFormData: any
// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeBlob = require('buffer').Blob

async function toNodeBody(body: any) {
  // React Native's FormData keeps {uri,name,type} parts; Node's fetch needs Blobs.
  if (body && typeof body.getParts === 'function') {
    const fd = new NodeFormData()
    for (const part of body.getParts()) {
      const name = /name="([^"]+)"/.exec(part.headers['content-disposition'])?.[1]
      if (part.uri) {
        const buf = fs.readFileSync(part.uri.replace('file://', ''))
        fd.append(name, new NodeBlob([buf], { type: part.type }), part.name)
      } else {
        fd.append(name, part.string)
      }
    }
    return fd
  }
  return body
}

beforeAll(async () => {
  NodeFormData = (await new Response(new URLSearchParams('a=1')).formData()).constructor
  ;(globalThis as any).fetch = async (url: string, init: any = {}) => {
    const u = String(url).replace(/^http:\/\/10\.0\.2\.2:\d+/, BACKEND!)
    for (const o of overrides) {
      const canned = o(u, init)
      if (canned !== undefined) {
        return new Response(JSON.stringify(canned), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    }
    const headers = { ...(init.headers ?? {}) }
    const body = await toNodeBody(init.body)
    if (body instanceof NodeFormData) delete headers['Content-Type']
    // RN's AbortController polyfill is not a Node AbortSignal; drop it (tests have their own timeouts).
    const { signal: _signal, ...rest } = init
    try {
      return await realFetch(u, { ...rest, headers, body })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('fetch failed', u, e)
      throw e
    }
  }
})

// Alerts: record them and press the destructive/confirm button automatically.
const alerts: { title: string; message?: string }[] = []
beforeEach(() => {
  alerts.length = 0
  overrides = []
  ;(global as any).__PICKED_FILE__ = undefined
  jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
    alerts.push({ title, message })
    const b = buttons?.find(x => x.style === 'destructive') ?? buttons?.[buttons.length - 1]
    b?.onPress?.()
  })
})
afterEach(() => {
  cleanup()
  jest.restoreAllMocks()
})

// ── helpers ─────────────────────────────────────────────────────────────────
const LONG = { timeout: 20000 }

async function renderApp() {
  render(<App />)
}

async function freshStart() {
  await AsyncStorage.clear()
  await clearSession()
}

async function signIn() {
  await freshStart()
  await renderApp()
  fireEvent.press(await screen.findByText('Login with Email', {}, LONG))
  await screen.findByText("What's on your mind?", {}, LONG)
}

async function openTab(label: string) {
  fireEvent.press(screen.getByLabelText(label))
}

async function openFamily() {
  // Family is not a bottom tab any more: it opens from the top-bar family-chat button.
  fireEvent.press(screen.getAllByLabelText('Family chat')[0])
}

async function openSettings() {
  fireEvent.press(screen.getAllByLabelText('Settings')[0])
}

jest.setTimeout(120000)

d('PAL app against a live backend', () => {
  test('login with the default test account lands on Ask', async () => {
    await signIn()
    expect(screen.getAllByText(/Good (morning|afternoon|evening), PAL Test User/).length).toBeGreaterThan(0)
  })

  test('wrong password shows the server message', async () => {
    await freshStart()
    await renderApp()
    await screen.findByText('Login with Email', {}, LONG)
    fireEvent.changeText(screen.getByDisplayValue('PalTest@2026'), 'nope-nope')
    fireEvent.press(screen.getByText('Login with Email'))
    await screen.findByText('Invalid credentials', {}, LONG)
  })

  test('sign-up form validates the password rules before calling the server', async () => {
    await freshStart()
    await renderApp()
    fireEvent.press(await screen.findByText('Sign up', {}, LONG))
    fireEvent.changeText(screen.getByLabelText('USERNAME'), 'newuser1')
    fireEvent.changeText(screen.getByLabelText('EMAIL'), 'new@example.com')
    fireEvent.changeText(screen.getByLabelText('PASSWORD'), 'weakpass')
    fireEvent.press(screen.getAllByText('Create account').pop()!)
    await screen.findByText(/Password needs 8\+ characters/)
  })

  test('Record tab loads lab tests, prescriptions and documents', async () => {
    await signIn()
    await openTab('Records')
    await screen.findByText('Medical Records', {}, LONG)
    await waitFor(() => expect(screen.queryByText('loading records…')).toBeNull(), LONG)
    expect(screen.queryByText(/server had a problem|Please sign in/i)).toBeNull()
  })

  test('Upload: a real PDF is accepted by the server', async () => {
    fs.writeFileSync('/tmp/pal-test.pdf', '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
    ;(global as any).__PICKED_FILE__ = { uri: 'file:///tmp/pal-test.pdf', name: 'pal-test.pdf', type: 'application/pdf', size: 60 }
    await signIn()
    await openTab('Upload')
    fireEvent.press(await screen.findByText(/Choose file/))
    await screen.findByText(/Saved "pal-test.pdf"/, {}, LONG)
  })

  test('Upload: review → correct a value → save creates a lab report (extraction faked, save is real)', async () => {
    fs.writeFileSync('/tmp/pal-test2.pdf', '%PDF-1.4\n%%EOF\n')
    ;(global as any).__PICKED_FILE__ = { uri: 'file:///tmp/pal-test2.pdf', name: 'lipid.pdf', type: 'application/pdf', size: 20 }
    const orig = (globalThis as any).fetch
    ;(globalThis as any).fetch = async (url: string, init: any) => {
      const res: Response = await orig(url, init)
      if (String(url).endsWith('/medical/upload')) {
        const real = await res.json()
        const fake = {
          type: 'pending_verification', raw_source_id: real.raw_source_id, extraction_id: null,
          filename: 'lipid.pdf', patient_name_on_doc: 'PAL Test User', patient_name_on_profile: null,
          name_match_status: 'no_match', report_title: 'Lipid profile', report_date: '2026-10-01T00:00:00',
          observations: [
            { display: 'LDL cholesterol', value: '162', unit: 'mg/dL', reference_range: '<100', legible: true },
            { display: 'HDL cholesterol', value: '41', unit: 'mg/dL', reference_range: '>40', legible: true },
          ],
          doc_kind: 'lab_report', source_modality: 'printed', extraction_method: 'mdt_direct', needs_review: false,
          transcription_model: null, transcription_text: null, warnings: [], confidence: 0.9,
        }
        return new Response(JSON.stringify(fake), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return res
    }
    await signIn()
    await openTab('Upload')
    fireEvent.press(await screen.findByText(/Choose file/))
    await screen.findByText('Check what PAL read', {}, LONG)
    expect(screen.getByText('Check that this report is yours before saving.')).toBeTruthy()
    fireEvent.changeText(screen.getByDisplayValue('162'), '160')
    fireEvent.press(screen.getByText('Save to my record'))
    // (the server's edits_applied counts renamed tests only, not changed values)
    await screen.findByText(/Saved 2 values/, {}, LONG)
    ;(globalThis as any).fetch = orig
    fireEvent.press(screen.getByText('View record'))
    await screen.findByText('Medical Records', {}, LONG)
    for (const el of await screen.findAllByText('Lipid profile', {}, LONG)) fireEvent.press(el)
    await waitFor(() => expect(screen.queryAllByText(/^160/).length).toBeGreaterThan(0), LONG)
  })

  test('Medicines (from Settings): add, pause, delete', async () => {
    await signIn()
    await openSettings()
    fireEvent.press(await screen.findByText('Medication reminders'))
    await screen.findByText('Add medicines to get reminders at the right time', {}, LONG)
    if (!screen.queryByText('✶ ADD A MEDICINE')) fireEvent.press(screen.getByLabelText('+ Add'))
    fireEvent.changeText(await screen.findByLabelText('Medicine name'), 'Atorvastatin TEST')
    fireEvent.changeText(screen.getByLabelText('Dosage'), '10 mg')
    fireEvent.changeText(screen.getByLabelText('Time 1'), '9:00')
    fireEvent.press(screen.getByText('+ add another time'))
    fireEvent.changeText(screen.getByLabelText('Time 2'), '21:30')
    fireEvent.press(screen.getByText('＋ Add reminder'))
    await screen.findByText('Atorvastatin TEST', {}, LONG)
    expect(screen.getByText(/09:00, 21:30 · every day/)).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Reminders for Atorvastatin TEST'))
    await screen.findByText('Paused', {}, LONG)
    expect(alerts.find(a => a.title === 'Could not update')).toBeUndefined()
    fireEvent.press(screen.getByLabelText('Delete Atorvastatin TEST'))
    await waitFor(() => expect(screen.queryByText('Atorvastatin TEST')).toBeNull(), LONG)
  })

  test('Medicines: invalid time is rejected on the phone', async () => {
    await signIn()
    await openSettings()
    fireEvent.press(await screen.findByText('Medication reminders'))
    await screen.findByText('Add medicines to get reminders at the right time', {}, LONG)
    if (!screen.queryByText('✶ ADD A MEDICINE')) fireEvent.press(screen.getByLabelText('+ Add'))
    fireEvent.changeText(await screen.findByLabelText('Medicine name'), 'X')
    fireEvent.changeText(screen.getByLabelText('Time 1'), '25:00')
    fireEvent.press(screen.getByText('＋ Add reminder'))
    await screen.findByText(/Times must be 24-hour/)
  })

  test('Family: group exists or is created, invite shows a one-time code, member removed', async () => {
    await signIn()
    await openFamily()
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull(), LONG)
    if (screen.queryByText('No groups yet')) {
      fireEvent.press(screen.getAllByLabelText('Create group')[0])
      fireEvent.changeText(screen.getByLabelText('YOUR NAME IN THE GROUP'), 'Paulson')
      fireEvent.press(screen.getAllByText('Create group').pop()!)
    }
    fireEvent.press((await screen.findAllByLabelText('Invite a family member', {}, LONG))[0])
    fireEvent.changeText(screen.getByLabelText('NAME'), 'Amma TEST')
    fireEvent.changeText(screen.getByLabelText('MOBILE NUMBER'), '098765 22222')
    fireEvent.press(screen.getByText('Create invite'))
    await waitFor(() => expect(alerts.find(a => a.title === 'Share this invite code')).toBeDefined(), LONG)
    expect(alerts.find(a => a.title === 'Share this invite code')!.message).toMatch(/Code: \d{6}/)
    await screen.findByText('Amma TEST', {}, LONG)
    const removeButtons = screen.getAllByText('Remove from family')
    fireEvent.press(removeButtons[removeButtons.length - 1])
    await waitFor(() => expect(screen.queryByText('Amma TEST')).toBeNull(), LONG)
  })

  test('Family: a wrong invite code shows the server message', async () => {
    await signIn()
    await openFamily()
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull(), LONG)
    fireEvent.press(screen.getAllByLabelText('Join with code')[0])
    fireEvent.changeText(screen.getByLabelText('YOUR MOBILE NUMBER (THE ONE THAT WAS INVITED)'), '9000000001')
    fireEvent.changeText(screen.getByLabelText('INVITE CODE'), '111111')
    fireEvent.press(screen.getByText('Join family'))
    await screen.findByText(/No pending invitation|Incorrect code/, {}, LONG)
  })

  test('Profile (avatar), notification shade and notifications page', async () => {
    await signIn()
    fireEvent.press(screen.getAllByLabelText('View profile')[0])
    await screen.findByText('Your Profile', {}, LONG)
    await screen.findAllByText('PAL Test User', {}, LONG)
    expect(screen.getByText(/credits left/)).toBeTruthy()
    fireEvent.press(screen.getByLabelText('Back'))
    fireEvent.press(screen.getAllByLabelText('Notifications')[0])
    await screen.findByText(/all caught up|to review/, {}, LONG)
    fireEvent.press(screen.getByText('All notifications'))
    await screen.findByText('Family requests and updates about your care.', {}, LONG)
    expect(screen.queryByText(/server had a problem/i)).toBeNull()
  })

  test('Settings → Server & app info shows the live server feature flags', async () => {
    await signIn()
    await openSettings()
    fireEvent.press(await screen.findByText('Server & app info'))
    await screen.findByText('Medicine reminders', {}, LONG)
    expect(screen.getAllByText('on').length).toBeGreaterThan(0)
  })

  test('Visits tab loads', async () => {
    await signIn()
    await openTab('Visits')
    await screen.findByText('Your visits', {}, LONG)
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull(), LONG)
    expect(screen.getByText('Prepare with PAL')).toBeTruthy()
    expect(screen.queryByText(/server had a problem/i)).toBeNull()
  })

  test('Ask: an answer with a citation renders (LLM reply faked, route real)', async () => {
    overrides.push(url =>
      url.endsWith('/search')
        ? {
            type: 'answer',
            answer: {
              answer_text: 'HbA1c reflects your average blood sugar over about three months.',
              citations: [{ title: 'Glycated haemoglobin review', source: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/' }],
              pending_actions: [], provenance_summary: '',
            },
            conversation_id: null,
          }
        : undefined,
    )
    await signIn()
    fireEvent.press(screen.getByText('What is type 2 diabetes?'))
    await screen.findByText(/average blood sugar/, {}, LONG)
    expect(screen.getByText(/Glycated haemoglobin review/)).toBeTruthy()
  })

  test('Ask: Markdown answers are formatted, copyable, and New chat (top) clears the thread', async () => {
    const md =
      '### 1. Symptom Log\nSince this is a general consultation, be prepared to discuss:\n\n' +
      '* **Current Symptoms:** What are you feeling?\n* **Onset & Duration:** When did these start?\n\n' +
      '***Triggers:** Does anything make it better or worse?\n\n---\n**Disclaimer:** I am an AI assistant, not a doctor.\n\n' +
      'Read more at https://pubmed.ncbi.nlm.nih.gov/1/'
    overrides.push(url =>
      url.endsWith('/search')
        ? { type: 'answer', answer: { answer_text: md, citations: [], pending_actions: [] }, conversation_id: null }
        : undefined,
    )
    const { Clipboard } = require('react-native')
    const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {})
    await signIn()
    expect(screen.queryByLabelText('New chat')).toBeNull() // only shown once a conversation exists
    fireEvent.press(screen.getByText('What is type 2 diabetes?'))
    await screen.findByText('1. Symptom Log', {}, LONG) // heading, no "###"
    expect(screen.getByText('Current Symptoms:')).toBeTruthy() // bold label, no "**"
    expect(screen.getByText('Triggers:')).toBeTruthy()
    expect(screen.getByText('Disclaimer:')).toBeTruthy()
    expect(screen.queryByText(/###|\*\*/)).toBeNull()
    expect(screen.getByText('https://pubmed.ncbi.nlm.nih.gov/1/')).toBeTruthy() // tappable link
    fireEvent.press(screen.getByLabelText('Copy answer'))
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('• Current Symptoms: What are you feeling?'))
    expect(copy.mock.calls[0][0]).not.toMatch(/\*\*|###/)
    await screen.findByText('Copied')
    fireEvent.press(screen.getByLabelText('New chat'))
    await screen.findByText("What's on your mind?", {}, LONG)
    expect(screen.queryByText('1. Symptom Log')).toBeNull()
    copy.mockRestore()
  })

  test('bottom bar has exactly the five tabs; Family is in the top bar', async () => {
    await signIn()
    for (const t of ['Ask', 'History', 'Records', 'Upload', 'Visits']) expect(screen.getByLabelText(t)).toBeTruthy()
    expect(screen.queryByLabelText('Family')).toBeNull()
    expect(screen.queryByLabelText('Record')).toBeNull()
    await openFamily()
    await screen.findByLabelText('Back', {}, LONG) // Family opens as its own screen with a back button
  })

  test('Ask: disambiguation shows the consent card (general vs my record)', async () => {
    overrides.push((url, init) => {
      if (!url.endsWith('/search')) return undefined
      const q = JSON.parse(init.body).query as string
      return q.startsWith('About my own records')
        ? { type: 'answer', answer: { answer_text: 'Using your records: your last LDL was 160.', citations: [] } }
        : { type: 'disambiguation_required', question: 'General information, or use your records?' }
    })
    await signIn()
    fireEvent.press(screen.getByText('What do my latest lab results show?'))
    await screen.findByText('General information, or use your records?', {}, LONG)
    fireEvent.press(screen.getByText('Use my record'))
    await screen.findByText(/your last LDL was 160/, {}, LONG)
  })

  test('Ask: emergency words trigger the on-device safety banner without calling the server', async () => {
    let searched = false
    overrides.push(url => {
      if (url.endsWith('/search')) searched = true
      return undefined
    })
    await signIn()
    const input = screen.getByPlaceholderText('Ask about your health…')
    fireEvent.changeText(input, 'I have severe chest pain and cannot breathe')
    fireEvent(input, 'submitEditing')
    await waitFor(() => expect(screen.queryAllByText(/emergency/i).length).toBeGreaterThan(0), LONG)
    expect(searched).toBe(false)
  })

  test("Ask: a prescribing question gets the server's safe refusal (real pipeline, no AI needed)", async () => {
    await signIn()
    const input = screen.getByPlaceholderText('Ask about your health…')
    fireEvent.changeText(input, 'When should I take metformin?')
    fireEvent(input, 'submitEditing')
    await screen.findByText(/decision for your doctor/i, {}, LONG)
  })

  test('Ask: when the AI is unavailable the user sees a friendly error, not a crash', async () => {
    await signIn()
    const input = screen.getByPlaceholderText('Ask about your health…')
    fireEvent.changeText(input, 'What is HbA1c?')
    fireEvent(input, 'submitEditing')
    await screen.findByText(/server had a problem|not available/i, {}, LONG)
  })

  test('History tab loads', async () => {
    await signIn()
    await openTab('History')
    await screen.findByText('Your conversations', {}, LONG)
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull(), LONG)
    expect(screen.queryByText(/server had a problem/i)).toBeNull()
  })

  test('sign out (Settings → Sign out → confirm) returns to the login screen', async () => {
    await signIn()
    await openSettings()
    fireEvent.press(await screen.findByText('Sign out'))
    await screen.findByText('Before you go…', {}, LONG)
    fireEvent.press(screen.getAllByText('Sign out').pop()!)
    await screen.findByText('Login with Email', {}, LONG)
  })

  test('an expired session sends the user back to login with a notice', async () => {
    await signIn()
    const cur = (await loadSession())!
    cleanup()
    await saveSession({ ...cur, expiresAt: Date.now() - 1000 })
    await renderApp()
    await screen.findByText('Your session has expired. Please sign in again.', {}, LONG)
  })
})
