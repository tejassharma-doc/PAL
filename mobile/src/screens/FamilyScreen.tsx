/**
 * Family — the website's /family "Groups" page: mono "FAMILY" kicker + serif
 * title, key / plus icon buttons, the group card with a dark initials tile,
 * dashed "Create group" / "Join with code" tiles, then members, approvals
 * and who-can-see-what.
 */
import React, { useState } from 'react'
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { C, DEEP_GRAD, F, T } from '../theme'
import { Avatar, Badge, Body, Button, Chips, Empty, ErrorBox, Field, IconButton, Loading, Sheet, Slab, useFocusLoad } from '../components/ui'
import { Gradient, LineIcon } from '../components/icons'
import { TabChrome } from '../components/Chrome'
import { useNavigation } from '@react-navigation/native'
import { useAuth } from '../context/AuthContext'
import * as api from '../lib/api'
import { ApiError } from '../lib/http'

type Loaded =
  | { state: 'phone' }
  | { state: 'disabled' }
  | { state: 'none'; plans: api.FamilyPlans }
  | {
      state: 'ready'
      plans: api.FamilyPlans
      plan: api.FamilyPlan
      members: api.FamilyMember[]
      requests: api.AccessRequest[]
      grants: { i_can_see: api.AccessGrant[]; can_see_me: api.AccessGrant[] }
    }

async function load(): Promise<Loaded> {
  let plans: api.FamilyPlans
  try {
    plans = await api.listFamilyPlans()
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { state: 'disabled' }
    throw e
  }
  if (!plans.has_family_plan || plans.plans.length === 0) return { state: 'none', plans }
  // Only the first plan: the backend's write endpoints (invite, remove, access
  // requests, grants) always act on the caller's first plan and take no plan_id.
  const id = plans.plans[0].plan_id
  const [plan, members, requests, grants] = await Promise.all([
    api.getFamilyPlan(id),
    api.listFamilyMembers(id),
    api.listAccessRequests(),
    api.listGrants(),
  ])
  return { state: 'ready', plans, plan, members, requests, grants }
}

const SCOPE: Record<string, string> = { appointments: 'appointments', medications: 'medicines', summary: 'health summary', full: 'full record' }
const scopeLabel = (s: string) => SCOPE[s] ?? s
const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('') || 'F'

export default function FamilyScreen() {
  const nav = useNavigation<any>()
  const { session } = useAuth()
  const phoneUser = session?.authType === 'phone'
  const { data, error, loading, refreshing, reload } = useFocusLoad(
    () => (phoneUser ? Promise.resolve({ state: 'phone' } as const) : load()),
    [phoneUser],
  )
  const [sheet, setSheet] = useState<null | 'create' | 'join' | 'invite'>(null)

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      reload()
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message ?? '')
    }
  }

  const ready = data?.state === 'ready' ? data : null

  return (
    <View style={{ flex: 1, backgroundColor: C.soft }}>
      <TabChrome title="Family" sub="group chat" onBack={nav.canGoBack() ? () => nav.goBack() : undefined} />
      {loading ? (
        <Loading />
      ) : (
        <Body refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} colors={[C.jade]} />}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={[T.slab, { marginTop: 0, marginBottom: 2 }]}>Family</Text>
              <Text style={s.h}>{ready ? 'Your group' : 'Groups'}</Text>
            </View>
            {data?.state === 'none' || data?.state === 'ready' ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <IconButton label="Join with code" tone="blue" size={44} onPress={() => setSheet('join')}>
                  <LineIcon name="key-round" size={20} />
                </IconButton>
                {(data.state === 'none' || ready?.plan.is_admin) && (
                  <IconButton
                    label={data.state === 'none' ? 'Create group' : 'Invite a family member'}
                    tone="jade"
                    size={44}
                    onPress={() => setSheet(data.state === 'none' ? 'create' : 'invite')}
                  >
                    <LineIcon name="plus" size={20} color={C.jadeD} />
                  </IconButton>
                )}
              </View>
            ) : null}
          </View>

          {error ? <ErrorBox message={error} onRetry={reload} /> : null}

          {data?.state === 'phone' && (
            <Empty
              icon="users"
              title="Family needs an email account for now"
              body="Family groups are tied to email sign-in on this server. Sign in with email and password to create or join a family. Mobile sign-in support is coming."
            />
          )}
          {data?.state === 'disabled' && <Empty icon="users" title="Family sharing is off" body="Family plans are not enabled on this PAL server." />}

          {data?.state === 'none' && (
            <>
              <View style={{ alignItems: 'center', paddingTop: 30, paddingBottom: 20 }}>
                <Text style={{ fontFamily: F.serifLight, fontSize: 18, color: C.ink, marginBottom: 8 }}>No groups yet</Text>
                <Text style={[T.meta, { textAlign: 'center', lineHeight: 16 }]}>Create a group to coordinate care{'\n'}with your family.</Text>
              </View>
              <Tiles onCreate={() => setSheet('create')} onJoin={() => setSheet('join')} />
            </>
          )}

          {ready && (
            <>
              <View style={s.group}>
                <View style={s.tile}>
                  <Gradient colors={DEEP_GRAD} angle={160} radius={14} />
                  <Text style={s.tileText}>{initials(ready.plan.name)}</Text>
                  {ready.plan.is_admin ? (
                    <View style={s.adminDot}>
                      <Text style={{ color: '#fff', fontFamily: F.serifMedium, fontSize: 12 }}>A</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.sansSemi, fontSize: 16.5, color: C.ink }}>{ready.plan.name}</Text>
                  <Text style={[T.meta, { marginTop: 3 }]}>
                    {ready.members.length} member{ready.members.length === 1 ? '' : 's'}
                    {ready.plan.is_admin ? ' · admin' : ''}
                  </Text>
                </View>
              </View>
              <Tiles
                onCreate={ready.plan.is_admin ? () => setSheet('invite') : undefined}
                createLabel="Invite member"
                createSub="Send a one-time code"
                onJoin={() => setSheet('join')}
              />

              {ready.requests.length > 0 && (
                <>
                  <Slab>Waiting for your approval</Slab>
                  {ready.requests.map(r => (
                    <View key={r.id} style={[s.card, { borderColor: 'rgba(55,181,155,0.5)' }]}>
                      <Text style={{ fontFamily: F.sans, fontSize: 16, color: C.ink, lineHeight: 23 }}>
                        <Text style={{ fontFamily: F.sansSemi }}>{r.grantee_name}</Text> wants to see{' '}
                        <Text style={{ fontFamily: F.sansSemi }}>{r.subject_name}</Text>'s {scopeLabel(r.scope)}.
                      </Text>
                      {r.message ? <Text style={[T.lead, { marginTop: 4, fontStyle: 'italic' }]}>“{r.message}”</Text> : null}
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                        <Button title="Approve" small onPress={() => act(() => api.approveAccess(r.id))} style={{ flex: 1 }} />
                        <Button title="Deny" small kind="outline" onPress={() => act(() => api.denyAccess(r.id))} style={{ flex: 1 }} />
                      </View>
                    </View>
                  ))}
                </>
              )}

              <Slab>Members</Slab>
              {ready.members.map(m => (
                <Member key={m.id} m={m} isAdmin={ready.plan.is_admin} onChanged={reload} />
              ))}

              <Grants title="Records you can see" grants={ready.grants.i_can_see} onRevoke={g => act(() => api.revokeGrant(g.id))} />
              <Grants title="Who can see your records" grants={ready.grants.can_see_me} onRevoke={g => act(() => api.revokeGrant(g.id))} />
            </>
          )}
        </Body>
      )}

      <Sheet visible={sheet === 'create'} onClose={() => setSheet(null)}>
        <CreateForm
          onDone={() => {
            setSheet(null)
            reload()
          }}
        />
      </Sheet>
      <Sheet visible={sheet === 'join'} onClose={() => setSheet(null)}>
        <JoinForm
          onDone={() => {
            setSheet(null)
            reload()
          }}
        />
      </Sheet>
      <Sheet visible={sheet === 'invite'} onClose={() => setSheet(null)}>
        <InviteForm
          onDone={() => {
            setSheet(null)
            reload()
          }}
        />
      </Sheet>
    </View>
  )
}

function Tiles({ onCreate, onJoin, createLabel = 'Create group', createSub = 'Start a new family group' }: { onCreate?: () => void; onJoin: () => void; createLabel?: string; createSub?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
      {onCreate ? (
        <Pressable onPress={onCreate} style={[s.dash, { backgroundColor: 'rgba(55,181,155,0.07)', borderColor: 'rgba(55,181,155,0.5)' }]} accessibilityRole="button">
          <View style={[s.dashIcon, { backgroundColor: 'rgba(55,181,155,0.12)' }]}>
            <LineIcon name="plus" size={20} color={C.jadeD} />
          </View>
          <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.jadeD }}>{createLabel}</Text>
          <Text style={s.dashSub}>{createSub}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onJoin} style={[s.dash, { backgroundColor: 'rgba(90,143,168,0.07)', borderColor: 'rgba(90,143,168,0.5)' }]} accessibilityRole="button">
        <View style={[s.dashIcon, { backgroundColor: 'rgba(90,143,168,0.12)' }]}>
          <LineIcon name="key-round" size={20} color={C.blueD} />
        </View>
        <Text style={{ fontFamily: F.sansSemi, fontSize: 15, color: C.blueD }}>Join with code</Text>
        <Text style={s.dashSub}>Use an invite code</Text>
      </Pressable>
    </View>
  )
}

function Member({ m, isAdmin, onChanged }: { m: api.FamilyMember; isAdmin: boolean; onChanged: () => void }) {
  const [asking, setAsking] = useState(false)
  const [scope, setScope] = useState<api.AccessScope>('appointments')
  const [busy, setBusy] = useState(false)
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={m.display_name} size={40} radius={12} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.sansSemi, fontSize: 16, color: C.ink }}>
            {m.display_name}
            {m.is_self ? ' (you)' : ''}
          </Text>
          <Text style={[T.meta, { marginTop: 2 }]}>
            {m.relationship_type} · {m.role.replace(/_/g, ' ')}
            {m.my_access_scope ? ` · you see ${scopeLabel(m.my_access_scope)}` : ''}
          </Text>
        </View>
        <Badge text={m.status} tone={m.status === 'active' ? 'jade' : 'grey'} />
      </View>
      {!m.is_self && m.status === 'active' && !asking && (
        <Pressable onPress={() => setAsking(true)} style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: F.sansSemi, fontSize: 13.5, color: C.jadeD }}>Ask to see their records →</Text>
        </Pressable>
      )}
      {asking && (
        <View style={{ marginTop: 12 }}>
          <Chips label="What do you need to see?" options={api.ACCESS_SCOPES} value={scope} onChange={setScope} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              title="Send request"
              small
              loading={busy}
              style={{ flex: 1 }}
              onPress={async () => {
                setBusy(true)
                try {
                  await api.requestAccess(m.id, scope)
                  Alert.alert('Request sent', `${m.display_name} will be asked to approve.`)
                  setAsking(false)
                  onChanged()
                } catch (e: any) {
                  Alert.alert('Could not send', e?.message ?? '')
                } finally {
                  setBusy(false)
                }
              }}
            />
            <Button title="Cancel" small kind="outline" onPress={() => setAsking(false)} />
          </View>
        </View>
      )}
      {!m.is_self && isAdmin && (
        <Pressable
          style={{ alignSelf: 'flex-end', marginTop: 8 }}
          hitSlop={8}
          onPress={() =>
            Alert.alert(`Remove ${m.display_name}?`, 'Their access grants are revoked too.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await api.removeFamilyMember(m.id)
                    onChanged()
                  } catch (e: any) {
                    Alert.alert('Could not remove', e?.message ?? '')
                  }
                },
              },
            ])
          }
        >
          <Text style={{ fontFamily: F.mono, fontSize: 12, color: C.rose }}>Remove from family</Text>
        </Pressable>
      )}
    </View>
  )
}

function Grants({ title, grants, onRevoke }: { title: string; grants: api.AccessGrant[]; onRevoke: (g: api.AccessGrant) => void }) {
  if (grants.length === 0) return null
  return (
    <>
      <Slab>{title}</Slab>
      {grants.map(g => (
        <View key={g.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.sansSemi, fontSize: 16, color: C.ink }}>{g.subject_name}</Text>
            <Text style={[T.meta, { marginTop: 2 }]}>
              {scopeLabel(g.scope)} · {g.expires_at ? `until ${g.expires_at.slice(0, 10)}` : 'no expiry'}
            </Text>
          </View>
          <Button title="Revoke" small kind="outline" onPress={() => onRevoke(g)} />
        </View>
      ))}
    </>
  )
}

function SheetTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <>
      <Text style={[T.slab, { marginTop: 0, marginBottom: 2 }]}>{kicker}</Text>
      <Text style={{ fontFamily: F.serifLight, fontSize: 22, color: C.ink, marginBottom: 16 }}>{title}</Text>
    </>
  )
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { session } = useAuth()
  const [name, setName] = useState('My Family')
  const [me, setMe] = useState(session?.displayName?.startsWith('+') ? '' : session?.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <SheetTitle kicker="Family" title="Create a group" />
      {error ? <ErrorBox message={error} /> : null}
      <Field label="GROUP NAME" value={name} onChangeText={setName} />
      <Field label="YOUR NAME IN THE GROUP" value={me} onChangeText={setMe} />
      <Button
        title="Create group"
        loading={busy}
        disabled={!name.trim() || !me.trim()}
        onPress={async () => {
          setBusy(true)
          setError(null)
          try {
            await api.createFamilyPlan(name.trim(), me.trim())
            onDone()
          } catch (e: any) {
            setError(e?.message ?? 'Could not create the group.')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

function JoinForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <SheetTitle kicker="Family" title="Join with a code" />
      {error ? <ErrorBox message={error} /> : null}
      <Field label="YOUR MOBILE NUMBER (THE ONE THAT WAS INVITED)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" />
      <Field label="INVITE CODE" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={10} placeholder="6-digit code" />
      <Button
        title="Join family"
        loading={busy}
        disabled={!phone || !code}
        onPress={async () => {
          setBusy(true)
          setError(null)
          try {
            await api.acceptFamilyInvite(phone, code)
            Alert.alert('Joined', 'You are now part of the family group.')
            onDone()
          } catch (e: any) {
            setError(e?.message ?? 'Could not join.')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [rel, setRel] = useState<(typeof api.RELATIONSHIPS)[number]>('parent')
  const [role, setRole] = useState<(typeof api.INVITE_ROLES)[number]>('adult')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <SheetTitle kicker="Family" title="Invite a family member" />
      {error ? <ErrorBox message={error} /> : null}
      <Field label="NAME" value={name} onChangeText={setName} placeholder="e.g. Amma" />
      <Field label="MOBILE NUMBER" value={phone} onChangeText={setPhone} keyboardType="phone-pad" hint="Indian numbers get +91 automatically." />
      <Chips label="RELATIONSHIP" options={api.RELATIONSHIPS} value={rel} onChange={setRel} />
      <Chips label="ROLE" options={api.INVITE_ROLES} value={role} onChange={setRole} />
      <Button
        title="Create invite"
        loading={busy}
        disabled={!name.trim() || api.normalisePhone(phone).length < 10}
        onPress={async () => {
          setBusy(true)
          setError(null)
          try {
            const r = await api.inviteFamilyMember({ display_name: name.trim(), phone, relationship_type: rel, role })
            const days = Math.round(r.expires_in_minutes / 1440)
            Alert.alert(
              'Share this invite code',
              `Code: ${r.invite_code}\n\nGive it to ${name.trim()}. They enter it with their mobile number under Family → Join with code. ` +
                `It is shown only once and expires in ${days > 0 ? `${days} day${days === 1 ? '' : 's'}` : `${r.expires_in_minutes} minutes`}.`,
            )
            onDone()
          } catch (e: any) {
            setError(e?.message ?? 'Could not create the invite.')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 14 },
  h: { fontFamily: F.serif, fontSize: 28, color: C.ink, letterSpacing: -0.3 },
  group: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  tile: { width: 48, height: 48, borderRadius: 14, overflow: 'visible', alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: F.serifMedium, fontSize: 17, color: C.paper },
  adminDot: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.jade,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dash: { flex: 1, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, paddingVertical: 18, paddingHorizontal: 10, alignItems: 'center', gap: 8 },
  dashIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dashSub: { fontFamily: F.mono, fontSize: 12, color: C.muted, textAlign: 'center', lineHeight: 17 },
  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginBottom: 9 },
})
