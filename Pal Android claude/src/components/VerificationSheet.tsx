/**
 * VerificationSheet — bottom-sheet modal shown after MDT document upload.
 *
 * Flow:
 *   1. User picks PDF/image via paperclip in AskScreen
 *   2. uploadMedicalDocument() returns pending_verification
 *   3. AskScreen sets verifyData → this sheet renders
 *   4. User reviews: patient name badge + extracted lab values
 *   5. Tap "Save to my record" → confirmMedicalDocument() → HealthFact rows saved
 *
 * PHI invariant: all data shown here came from the PAL backend (already behind
 * auth + consent). Nothing here sends PHI to any external endpoint.
 *
 * Safety gate: name_match_status === 'no_match' surfaces a warning but does not
 * block save — users may legitimately upload a family member's document.
 */
import React, {useState} from 'react'
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import {PAL, FONT, RADIUS, SPACE} from '../theme'
import type {MedicalDocVerifyResult, MedicalDocObservation, NameMatchStatus} from '../lib/api'

// ── Match badge config ────────────────────────────────────────────────────────

const MATCH_CONFIG: Record<NameMatchStatus, {bg: string; border: string; text: string; label: string}> = {
  match:    {bg: PAL.jadeFaint,  border: PAL.jadeBorder,  text: PAL.jade,  label: 'Patient match'},
  partial:  {bg: PAL.amberFaint, border: PAL.amberBorder, text: PAL.amber, label: 'Name differs — check before saving'},
  no_match: {bg: PAL.roseFaint,  border: PAL.roseBorder,  text: PAL.rose,  label: 'Name mismatch — wrong patient?'},
}

// ── Observation row ───────────────────────────────────────────────────────────

function ObsRow({obs, last}: {obs: MedicalDocObservation; last: boolean}) {
  return (
    <View style={[styles.obsRow, !last && styles.obsRowBorder]}>
      <View style={styles.obsLeft}>
        <Text style={styles.obsDisplay}>{obs.display}</Text>
        {obs.loinc_code && (
          <Text style={styles.obsLoinc}>LOINC {obs.loinc_code}</Text>
        )}
      </View>
      <View style={styles.obsRight}>
        <Text style={styles.obsValue}>
          {obs.value ?? '—'}{obs.unit ? ` ${obs.unit}` : ''}
        </Text>
        {obs.reference_range && (
          <Text style={styles.obsRef}>ref {obs.reference_range}</Text>
        )}
      </View>
    </View>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  data: MedicalDocVerifyResult & {type: 'pending_verification'}
  onSave: () => Promise<void>
  onCancel: () => void
}

export function VerificationSheet({data, onSave, onCancel}: Props): React.JSX.Element {
  const [saving, setSaving] = useState(false)
  const matchStatus = data.name_match_status ?? 'no_match'
  const mc = MATCH_CONFIG[matchStatus]
  const obs = data.observations ?? []

  async function handleSave() {
    setSaving(true)
    try {
      await onSave()
    } finally {
      setSaving(false)
    }
  }

  const saveLabel = saving
    ? 'Saving…'
    : matchStatus === 'no_match'
      ? 'Save anyway (this is my document)'
      : 'Save to my record'

  return (
    <Modal
      animationType="slide"
      transparent
      visible
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      {/* Dim background */}
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />

      {/* Sheet */}
      <View style={styles.sheet}>
        {/* Drag handle */}
        <View style={styles.handle} />

        {/* Cancel row */}
        <TouchableOpacity style={styles.cancelRow} onPress={onCancel} disabled={saving}>
          <Text style={styles.cancelText}>Cancel upload</Text>
        </TouchableOpacity>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.section}>
            <Text style={styles.reviewLabel}>REVIEW BEFORE SAVING</Text>
            <Text style={styles.reportTitle}>
              {data.report_title ?? data.filename}
            </Text>
            {data.report_date && (
              <Text style={styles.reportDate}>
                Report date:{' '}
                {new Date(data.report_date).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </Text>
            )}
          </View>

          {/* Patient name match badge */}
          <View style={[styles.matchBadge, {backgroundColor: mc.bg, borderColor: mc.border}]}>
            <Text style={[styles.matchLabel, {color: mc.text}]}>{mc.label}</Text>
            <View style={styles.matchNames}>
              <View>
                <Text style={styles.nameRole}>ON DOCUMENT</Text>
                <Text style={styles.nameValue}>{data.patient_name_on_doc ?? 'Not found'}</Text>
              </View>
              <View style={styles.nameRight}>
                <Text style={styles.nameRole}>YOUR PROFILE</Text>
                <Text style={styles.nameValue}>{data.patient_name_on_profile ?? 'Not set'}</Text>
              </View>
            </View>
          </View>

          {/* Extracted observations */}
          {obs.length > 0 ? (
            <View style={styles.obsCard}>
              <View style={styles.obsHeader}>
                <Text style={styles.obsHeaderText}>
                  {obs.length} value{obs.length !== 1 ? 's' : ''} extracted
                </Text>
              </View>
              {obs.map((o, i) => (
                <ObsRow key={i} obs={o} last={i === obs.length - 1} />
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                No structured lab values extracted.{'\n'}
                Document will be saved as a reference file.
              </Text>
            </View>
          )}

          {/* PHI note */}
          <Text style={styles.phiNote}>
            Saved data is encrypted and stays in your account.{'\n'}
            PHI never leaves without your consent.
          </Text>
        </ScrollView>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.saveBtn,
              matchStatus === 'no_match' ? styles.saveBtnMismatch : styles.saveBtnMatch,
              saving && styles.saveBtnDisabled,
            ]}
            onPress={handleSave}
            disabled={saving}
            accessibilityLabel={saveLabel}
          >
            {saving
              ? <ActivityIndicator color={matchStatus === 'no_match' ? PAL.rose : PAL.navyDeep} />
              : <Text style={[styles.saveBtnLabel, matchStatus === 'no_match' && styles.saveBtnLabelMismatch]}>
                  {saveLabel}
                </Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.discardBtn} onPress={onCancel} disabled={saving}>
            <Text style={styles.discardLabel}>Discard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: PAL.surface,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    maxHeight: '85%',
    paddingBottom: 34, // safe area
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: PAL.surfaceBorder,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  cancelRow: {
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
    alignItems: 'flex-start',
  },
  cancelText: {fontFamily: FONT.mono, fontSize: 11, color: PAL.textMuted},
  scroll: {flex: 1},
  scrollContent: {paddingHorizontal: SPACE.lg, paddingBottom: SPACE.lg},

  section: {marginBottom: SPACE.md},
  reviewLabel: {
    fontFamily: FONT.mono, fontSize: 9, letterSpacing: 1.2,
    textTransform: 'uppercase', color: PAL.textFaint, marginBottom: SPACE.xs,
  },
  reportTitle: {
    fontFamily: FONT.serif, fontSize: 17, fontWeight: '600',
    color: PAL.textDark, lineHeight: 24,
  },
  reportDate: {
    fontFamily: FONT.mono, fontSize: 10, color: PAL.textMuted, marginTop: 3,
  },

  matchBadge: {
    borderRadius: RADIUS.md, borderWidth: 1,
    padding: SPACE.md, marginBottom: SPACE.md,
  },
  matchLabel: {fontFamily: FONT.mono, fontSize: 11, fontWeight: '700', marginBottom: SPACE.sm},
  matchNames: {flexDirection: 'row', justifyContent: 'space-between'},
  nameRight: {alignItems: 'flex-end'},
  nameRole:  {fontFamily: FONT.mono, fontSize: 9, color: PAL.textFaint, marginBottom: 2},
  nameValue: {fontSize: 13, fontWeight: '500', color: PAL.textDark},

  obsCard: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
    overflow: 'hidden', marginBottom: SPACE.md,
  },
  obsHeader: {
    padding: SPACE.md,
    borderBottomWidth: 1, borderBottomColor: PAL.surfaceBorder,
  },
  obsHeaderText: {
    fontFamily: FONT.mono, fontSize: 9, letterSpacing: 0.8,
    textTransform: 'uppercase', color: PAL.textFaint,
  },
  obsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACE.md, paddingVertical: 12,
  },
  obsRowBorder: {borderTopWidth: 1, borderTopColor: PAL.surfaceBorder},
  obsLeft: {flex: 1, paddingRight: SPACE.sm},
  obsDisplay: {fontSize: 13, fontWeight: '500', color: PAL.textDark},
  obsLoinc: {fontFamily: FONT.mono, fontSize: 9, color: PAL.textFaint, marginTop: 2},
  obsRight: {alignItems: 'flex-end', flexShrink: 0},
  obsValue: {fontSize: 15, fontWeight: '700', color: PAL.textDark},
  obsRef: {fontFamily: FONT.mono, fontSize: 9, color: PAL.textFaint, marginTop: 2},

  emptyCard: {
    backgroundColor: PAL.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: PAL.surfaceBorder,
    padding: SPACE.lg, alignItems: 'center', marginBottom: SPACE.md,
  },
  emptyText: {
    fontFamily: FONT.mono, fontSize: 11, color: PAL.textFaint,
    textAlign: 'center', lineHeight: 18,
  },

  phiNote: {
    fontFamily: FONT.mono, fontSize: 9, color: PAL.textFaint,
    textAlign: 'center', lineHeight: 15, marginTop: SPACE.sm,
  },

  actions: {
    paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: SPACE.sm,
  },
  saveBtn: {
    borderRadius: RADIUS.md, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnMatch:    {backgroundColor: PAL.jade},
  saveBtnMismatch: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: PAL.roseBorder,
  },
  saveBtnDisabled: {opacity: 0.6},
  saveBtnLabel: {
    fontSize: 14, fontWeight: '700', color: PAL.navyDeep,
  },
  saveBtnLabelMismatch: {color: PAL.rose},
  discardBtn: {
    borderRadius: RADIUS.md, paddingVertical: 11,
    alignItems: 'center', borderWidth: 1, borderColor: PAL.surfaceBorder,
  },
  discardLabel: {fontFamily: FONT.mono, fontSize: 12, color: PAL.textMuted},
})
