/**
 * The website's app chrome, shared by every tab:
 *   [avatar] Title / mono subtitle          [family-chat] [⚙] [bell•]
 * plus the settings bottom sheet and the notification shade.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { useNavigation, useIsFocused } from '@react-navigation/native'
import { C, F, T } from '../theme'
import { AppBar, Avatar, Button, IconButton, Sheet, Shade, ui } from './ui'
import { LineIcon, SignOutIcon } from './icons'
import { useAuth } from '../context/AuthContext'
import * as api from '../lib/api'

const ACK = [
  { value: 'yes' as const, label: 'Yes', primary: true },
  { value: 'take_now' as const, label: 'Will take now', primary: true },
  { value: 'snooze_10' as const, label: 'In 10 mins', primary: false },
  { value: 'no' as const, label: 'No', primary: false },
]

export function TabChrome({ title, sub, onBack }: { title: string; sub: string; onBack?: () => void }) {
  const nav = useNavigation<any>()
  const focused = useIsFocused()
  const { session } = useAuth()
  const [settings, setSettings] = useState(false)
  const [shade, setShade] = useState(false)
  const [doses, setDoses] = useState<api.DoseEvent[]>([])
  const [schedules, setSchedules] = useState<api.MedicationSchedule[]>([])
  const [notes, setNotes] = useState<api.AppNotification[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [d, sc, n] = await Promise.all([
      api.pendingDoses().catch(() => [] as api.DoseEvent[]),
      api.listSchedules().catch(() => [] as api.MedicationSchedule[]),
      api.listNotifications(10).catch(() => [] as api.AppNotification[]),
    ])
    setDoses(d)
    setSchedules(sc)
    setNotes(n.filter(x => !x.is_read))
  }, [])

  useEffect(() => {
    if (focused && session?.patientId) refresh()
  }, [focused, session?.patientId, refresh])

  const count = doses.length + notes.length
  const name = session?.displayName?.startsWith('+') ? '' : session?.displayName

  const answer = async (d: api.DoseEvent, r: api.DoseResponse) => {
    setBusy(d.id)
    try {
      await api.respondToDose(d.id, r)
      setDoses(x => x.filter(y => y.id !== d.id))
    } catch (e: any) {
      Alert.alert('Could not record', e?.message ?? '')
    } finally {
      setBusy(null)
    }
  }

  const go = (screen: string, params?: object) => {
    // Navigate first, then close the sheet: closing a Modal and pushing a
    // screen in the same tick can drop the navigation on some devices.
    nav.navigate(screen, params)
    setSettings(false)
    setShade(false)
  }

  return (
    <>
      <AppBar
        title={title}
        sub={sub}
        name={name || 'PAL'}
        onAvatar={() => go('Profile')}
        onBack={onBack}
        right={
          <>
            <IconButton label="Family chat" onPress={() => go('Family')}>
              <LineIcon name="messages-square" size={22} />
            </IconButton>
            <IconButton label="Settings" onPress={() => setSettings(true)}>
              <LineIcon name="settings" size={22} />
            </IconButton>
            <IconButton
              label="Notifications"
              badge={count}
              onPress={() => {
                setShade(true)
                refresh()
              }}
            >
              <LineIcon name="bell" size={22} />
            </IconButton>
          </>
        }
      />

      {/* ── Notification shade ───────────────────────────────────────── */}
      <Shade visible={shade} onClose={() => setShade(false)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Text style={{ fontFamily: F.sansSemi, fontSize: 16.5, color: C.ink }}>Notifications</Text>
            <Text style={T.meta}>{count === 0 ? 'all caught up' : `${count} to review`}</Text>
          </View>
          <Pressable
            onPress={() => setShade(false)}
            accessibilityLabel="Close notifications"
            style={{
              width: 28,
              height: 28,
              borderRadius: 9,
              backgroundColor: 'rgba(13,31,36,0.06)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 17, color: C.ink }}>×</Text>
          </Pressable>
        </View>

        {count === 0 && (
          <View style={{ alignItems: 'center', paddingTop: 18, paddingBottom: 12 }}>
            <View style={{ marginBottom: 6 }}><LineIcon name="bell" size={28} /></View>
            <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.ink }}>No reminders right now</Text>
            <Text style={[ui.muted, { textAlign: 'center', marginTop: 3 }]}>Medicine reminders appear here at their scheduled times.</Text>
          </View>
        )}

        {doses.map(d => {
          const sch = schedules.find(s => s.id === d.schedule_id)
          const ack = d.status === 'awaiting_ack'
          return (
            <View
              key={d.id}
              style={{
                backgroundColor: '#fff',
                borderWidth: 1,
                borderColor: ack ? 'rgba(55,181,155,0.5)' : C.line,
                borderRadius: 13,
                padding: 12,
                marginBottom: 9,
                flexDirection: 'row',
                gap: 11,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: C.jadeTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LineIcon name="pill" size={18} color={C.jadeD} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.ink }}>
                  {ack ? 'Did you take your medicine?' : 'Time to take your medicine'}
                </Text>
                <Text style={[ui.muted, { marginTop: 2 }]}>
                  {sch?.medicine_name || 'Medicine'}
                  {sch?.dosage ? ` · ${sch.dosage}` : ''}
                </Text>
                <Text style={[T.meta, { marginTop: 5 }]}>
                  {d.scheduled_time?.slice(0, 5)} · {d.scheduled_date}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 }}>
                  {ACK.map(o => (
                    <Pressable
                      key={o.value}
                      disabled={busy === d.id}
                      onPress={() => answer(d, o.value)}
                      style={{
                        paddingHorizontal: 11,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: o.primary ? C.jade : 'transparent',
                        borderWidth: o.primary ? 0 : 1,
                        borderColor: C.line2,
                        opacity: busy === d.id ? 0.6 : 1,
                      }}
                    >
                      <Text style={{ fontFamily: F.sansSemi, fontSize: 12.5, color: o.primary ? C.deep2 : C.ink }}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>
          )
        })}

        {notes.map(n => (
          <Pressable
            key={n.id}
            onPress={() => {
              api.markNotificationRead(n.id).catch(() => {})
              setNotes(x => x.filter(y => y.id !== n.id))
              if (n.notification_type.startsWith('family')) go('Family')
            }}
            style={{
              backgroundColor: '#fff',
              borderWidth: 1,
              borderColor: C.line,
              borderRadius: 13,
              padding: 12,
              marginBottom: 9,
              flexDirection: 'row',
              gap: 11,
            }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                backgroundColor: 'rgba(90,143,168,0.14)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <LineIcon name={n.notification_type.startsWith('family') ? 'users' : 'bell'} size={18} color={C.jadeD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.ink }}>{n.title}</Text>
              {n.body ? <Text style={[ui.muted, { marginTop: 2 }]}>{n.body}</Text> : null}
            </View>
          </Pressable>
        ))}

        <Button title="Manage medication reminders" kind="outline" small onPress={() => go('Medicines')} style={{ marginTop: 4 }} />
        <Button title="All notifications" kind="ghost" small onPress={() => go('Notifications')} style={{ marginTop: 2 }} />
      </Shade>

      {/* ── Settings sheet ───────────────────────────────────────────── */}
      <SettingsSheet visible={settings} onClose={() => setSettings(false)} go={go} />
    </>
  )
}

/** Settings list row — module scope so it is not re-created (and remounted) on every render. */
function Row({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#fff',
        borderRadius: 11,
        paddingHorizontal: 12,
        paddingVertical: 11,
        marginBottom: 7,
        borderWidth: 1,
        borderColor: 'rgba(13,31,36,0.08)',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <LineIcon name={icon} size={22} />
      <Text style={{ flex: 1, fontFamily: F.sans, fontSize: 15, color: C.ink }}>{label}</Text>
      <LineIcon name="chevron-right" size={20} color={C.muted} />
    </Pressable>
  )
}

function SettingsSheet({ visible, onClose, go }: { visible: boolean; onClose: () => void; go: (s: string) => void }) {
  const { session, signOut } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const who = session?.authType === 'phone' ? `+91 ${session.phone}` : (session?.email ?? session?.username ?? '')

  return (
    <>
      <Sheet visible={visible && !confirm} onClose={onClose}>
        <Text style={{ fontFamily: F.serifLight, fontSize: 20, color: C.ink, marginBottom: 16 }}>Settings</Text>

        <Text style={[T.slab, { fontSize: 12, marginBottom: 10 }]}>Profile</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <Avatar name={session?.displayName} size={52} radius={16} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.sansSemi, fontSize: 16.5, color: C.ink }}>{session?.displayName}</Text>
            <Text style={[T.meta, { marginTop: 3 }]}>{who}</Text>
          </View>
        </View>

        <Text style={[T.slab, { fontSize: 12, marginBottom: 10 }]}>Your health</Text>
        <Row icon="user" label="Your profile" onPress={() => go('Profile')} />
        <Row icon="pill" label="Medication reminders" onPress={() => go('Medicines')} />
        <Row icon="bell" label="Notifications" onPress={() => go('Notifications')} />

        <Text style={[T.slab, { fontSize: 12, marginTop: 8, marginBottom: 10 }]}>App</Text>
        <Row icon="info" label="Server & app info" onPress={() => go('Settings')} />

        <Text style={[T.slab, { fontSize: 12, marginTop: 8, marginBottom: 8 }]}>Account</Text>
        <Pressable
          onPress={() => setConfirm(true)}
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: C.amberTint,
            borderWidth: 1,
            borderColor: C.amberLine,
            borderRadius: 11,
            paddingHorizontal: 13,
            paddingVertical: 12,
            marginBottom: 14,
          }}
        >
          <SignOutIcon />
          <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.amberD }}>Sign out</Text>
        </Pressable>

        <Text style={[T.meta, { textAlign: 'center', lineHeight: 15 }]}>
          PAL v1.0.0 · Not a medical device · For informational use only
        </Text>
      </Sheet>

      <Sheet visible={visible && confirm} onClose={() => setConfirm(false)}>
        <Text style={{ fontFamily: F.serifLight, fontSize: 18, color: C.ink, marginBottom: 3 }}>Before you go…</Text>
        <Text style={[T.meta, { marginBottom: 16 }]}>Help us improve PAL</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Why are you signing out? (optional)"
          placeholderTextColor="rgba(13,31,36,0.38)"
          multiline
          style={{
            borderWidth: 1,
            borderColor: C.line2,
            borderRadius: 11,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontFamily: F.sans,
            fontSize: 15,
            backgroundColor: '#fff',
            color: C.ink,
            height: 86,
            textAlignVertical: 'top',
          }}
        />
        <Button
          title="Sign out"
          kind="primary"
          style={{ backgroundColor: C.amber, marginTop: 12, marginBottom: 8 }}
          icon={<SignOutIcon size={16} color={C.deep2} />}
          onPress={async () => {
            setConfirm(false)
            onClose()
            await signOut()
          }}
        />
        <Button
          title="Stay signed in"
          kind="outline"
          onPress={() => {
            setConfirm(false)
            setReason('')
          }}
        />
      </Sheet>
    </>
  )
}
