/**
 * PAL UI kit — the website's visual language (palcare.life) in React Native.
 * Every size/colour below is copied from web/app/page.tsx and globals.css.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  StyleProp,
  TextStyle,
  RefreshControlProps,
} from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { C, F, R, S, T, AVATAR_GRAD } from '../theme'
import { Gradient, LineIcon, hasLineIcon } from './icons'

// ─── Typography ──────────────────────────────────────────────────────────────

/** Mono, uppercase, letter-spaced section label ("TRY ASKING", "LAB TESTS & RESULTS"). */
export function Slab({ children, style, color }: { children: React.ReactNode; style?: StyleProp<TextStyle>; color?: string }) {
  return (
    <Text style={[T.slab, { marginTop: 16, marginBottom: 10, marginHorizontal: 2 }, color ? { color, opacity: 1 } : null, style]}>
      {children}
    </Text>
  )
}
/** Back-compat name used by the screens. */
export const SectionTitle = Slab

/** Serif page title + sans lead line, as on every website tab. */
export function PageTitle({ title, lead, italic }: { title: string; lead?: string; italic?: string }) {
  return (
    <View style={{ marginTop: 12, marginBottom: 16 }}>
      <Text style={T.h1} accessibilityRole="header">
        {title}
        {italic ? (
          <Text style={{ fontFamily: F.serifLightItalic, color: C.jadeD }}>
            {'\n'}
            {italic}
          </Text>
        ) : null}
      </Text>
      {lead ? <Text style={[T.lead, { marginTop: 4 }]}>{lead}</Text> : null}
    </View>
  )
}

// ─── Surfaces ────────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>
}

/** Scrollable tab body with the website's 18px side padding. */
export function Body({
  children,
  refreshControl,
  bottomPad = 24,
  contentStyle,
}: {
  children: React.ReactNode
  refreshControl?: React.ReactElement<RefreshControlProps>
  bottomPad?: number
  contentStyle?: StyleProp<ViewStyle>
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.soft }}
      contentContainerStyle={[{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: bottomPad }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  )
}

// ─── App bar (same on every tab) ─────────────────────────────────────────────

export function Avatar({ name, size = 34, radius = 11, onPress }: { name?: string; size?: number; radius?: number; onPress?: () => void }) {
  const initial = (name || 'P').trim().charAt(0).toUpperCase() || 'P'
  const inner = (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <Gradient colors={AVATAR_GRAD} angle={150} />
      <Text style={{ color: '#fff', fontFamily: F.sansBold, fontSize: size * 0.42 }}>{initial}</Text>
    </View>
  )
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="View profile" hitSlop={6}>
      {inner}
    </Pressable>
  ) : (
    inner
  )
}

export function IconButton({
  children,
  onPress,
  label,
  badge,
  tone = 'plain',
  size = 42,
}: {
  children: React.ReactNode
  onPress: () => void
  label: string
  badge?: number
  tone?: 'plain' | 'jade' | 'blue' | 'rose'
  size?: number
}) {
  const tones = {
    plain: { backgroundColor: '#fff', borderColor: C.line2 },
    jade: { backgroundColor: 'rgba(55,181,155,0.10)', borderColor: C.jade },
    blue: { backgroundColor: 'rgba(90,143,168,0.10)', borderColor: 'rgba(90,143,168,0.55)' },
    rose: { backgroundColor: '#fff', borderColor: 'rgba(194,103,94,0.35)' },
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
        tones[tone],
        pressed && { opacity: 0.7 },
      ]}
    >
      {children}
      {badge ? (
        <View style={s.badgeDot}>
          <Text style={s.badgeDotText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function AppBar({
  title,
  sub,
  name,
  onAvatar,
  onBack,
  right,
}: {
  title: string
  sub?: string
  name?: string
  onAvatar?: () => void
  onBack?: () => void
  right?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <View style={[s.appbar, { paddingTop: Math.max(insets.top, 12) + 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 }}>
        {onBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} style={{ paddingRight: 4 }}>
            <LineIcon name="chevron-left" size={28} color={C.ink} />
          </Pressable>
        ) : null}
        {name !== undefined ? <Avatar name={name} onPress={onAvatar} /> : null}
        <View style={{ flexShrink: 1 }}>
          <Text style={s.appTitle} numberOfLines={1}>
            {title}
          </Text>
          {sub ? (
            <Text style={s.appSub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>{right}</View> : null}
    </View>
  )
}

/** Simple stack header used by pushed screens (Profile, Medicines, …). */
export function Header({ title, right, subtitle, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  return <AppBar title={title} sub={subtitle} right={right} onBack={onBack} />
}

// ─── Controls ────────────────────────────────────────────────────────────────

type BtnKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark' | 'amber' | 'outline'

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
  small,
  style,
  icon,
}: {
  title: string
  onPress: () => void
  kind?: BtnKind
  loading?: boolean
  disabled?: boolean
  small?: boolean
  style?: StyleProp<ViewStyle>
  icon?: React.ReactNode
}) {
  const off = disabled || loading
  const bg: Record<BtnKind, ViewStyle> = {
    primary: { backgroundColor: off && !loading ? '#cccccc' : C.jade },
    secondary: { backgroundColor: C.jadeTint, borderWidth: 1, borderColor: 'rgba(55,181,155,0.35)' },
    danger: { backgroundColor: C.rose },
    ghost: { backgroundColor: 'transparent' },
    dark: { backgroundColor: 'rgba(55,181,155,0.15)', borderWidth: 1, borderColor: 'rgba(55,181,155,0.25)' },
    amber: { backgroundColor: C.amberTint, borderWidth: 1, borderColor: C.amberLine },
    outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line2 },
  }
  const fg: Record<BtnKind, string> = {
    primary: off && !loading ? '#ffffff' : C.deep2,
    secondary: C.jadeD,
    danger: '#ffffff',
    ghost: C.ink,
    dark: C.jade,
    amber: C.amberD,
    outline: C.ink,
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        bg[kind],
        pressed && !off && { opacity: 0.85 },
        kind !== 'primary' && off && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? C.deep2 : C.jade} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icon}
          <Text
            style={[
              s.btnText,
              small && { fontSize: 13.5 },
              { color: fg[kind] },
              kind === 'ghost' && { fontFamily: F.mono, fontSize: 12.5, textDecorationLine: 'underline', color: C.ink },
            ]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  )
}

/** Mono uppercase label + white rounded input (website login / medicines forms). */
export function Field({
  label,
  hint,
  right,
  ...props
}: TextInputProps & { label: string; hint?: string; right?: React.ReactNode }) {
  const [focus, setFocus] = useState(false)
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[T.slab, { fontSize: 12, marginBottom: 7 }]}>{label}</Text>
      <View style={[s.inputWrap, focus && { borderColor: C.jade, borderWidth: 2 }, props.multiline && { alignItems: 'flex-start' }]}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor="rgba(13,31,36,0.38)"
          {...props}
          onFocus={e => {
            setFocus(true)
            props.onFocus?.(e)
          }}
          onBlur={e => {
            setFocus(false)
            props.onBlur?.(e)
          }}
          style={[s.input, props.multiline && { minHeight: 70, textAlignVertical: 'top' }, props.style]}
        />
        {right}
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[s.seg, style]} accessibilityRole="tablist">
      {options.map(o => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[s.segItem, on && s.segOn]}
          >
            <Text style={[s.segText, on && s.segTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Wrap-around option chips (language grid / role pickers on the website). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={[T.slab, { fontSize: 12, marginBottom: 7 }]}>{label}</Text> : null}
      <View style={s.chips}>
        {options.map(o => {
          const on = o === value
          return (
            <Pressable
              key={o}
              onPress={() => onChange(o)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[s.chip, on && s.chipOn]}
            >
              <Text style={[s.chipText, on && { color: C.jadeD, fontFamily: F.sansBold }]}>{o.replace(/_/g, ' ')}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Pill switch (web settings sheet). */
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
      style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: value ? C.jade : 'rgba(13,31,36,0.15)', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          left: value ? 19 : 3,
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: '#fff',
          elevation: 2,
        }}
      />
    </Pressable>
  )
}

// ─── Status ──────────────────────────────────────────────────────────────────

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={s.center}>
      <BreathDot />
      <Text style={[T.meta, { color: C.jadeD, opacity: 1, letterSpacing: 0.8 }]}>{label}</Text>
    </View>
  )
}

/** The website's breathing "thinking…" dot. */
export function BreathDot() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setOn(v => !v), 500)
    return () => clearInterval(t)
  }, [])
  return <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.jade, opacity: on ? 0.3 : 1, transform: [{ scale: on ? 1.35 : 1 }] }} />
}

export function Empty({ title, body, action, icon }: { title: string; body?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <View style={s.empty}>
      {icon ? hasLineIcon(icon) ? <View style={{ marginBottom: 6 }}><LineIcon name={icon} size={34} /></View> : <Text style={{ fontSize: 30, marginBottom: 4 }}>{icon}</Text> : null}
      <Text style={s.emptyTitle}>{title}</Text>
      {body ? <Text style={s.emptyBody}>{body}</Text> : null}
      {action}
    </View>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={s.error} accessibilityRole="alert">
      <Text style={s.errorText}>{message}</Text>
      {onRetry ? <Button title="Try again" kind="ghost" small onPress={onRetry} style={{ alignSelf: 'flex-start' }} /> : null}
    </View>
  )
}

/** Small rounded label ("used your record", "general", status chips). */
export function Badge({ text, tone = 'jade', dot }: { text: string; tone?: 'jade' | 'rose' | 'grey' | 'amber' | 'blue'; dot?: boolean }) {
  const t = {
    jade: { bg: 'rgba(55,181,155,0.12)', fg: C.jadeD, dot: C.jade },
    rose: { bg: 'rgba(194,103,94,0.10)', fg: C.rose, dot: C.rose },
    grey: { bg: 'rgba(13,31,36,0.06)', fg: 'rgba(13,31,36,0.6)', dot: 'rgba(13,31,36,0.25)' },
    amber: { bg: 'rgba(216,162,74,0.12)', fg: C.amberD, dot: C.amber },
    blue: { bg: 'rgba(90,143,168,0.12)', fg: C.blueD, dot: C.blue },
  }[tone]
  return (
    <View style={[s.badge, { backgroundColor: t.bg }]}>
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.dot }} /> : null}
      <Text style={[s.badgeText, { color: t.fg }]}>{text}</Text>
    </View>
  )
}
/** Alias matching the website's naming. */
export const Pill = Badge

/** Label / value pair (website profile cards). */
export function KV({ k, v }: { k: string; v?: string | number | null }) {
  if (v === undefined || v === null || v === '') return null
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ fontFamily: F.sans, fontSize: 13.5, color: C.muted, marginBottom: 3 }}>{k}</Text>
      <Text style={{ fontFamily: F.sans, fontSize: 16.5, color: C.ink }}>{String(v)}</Text>
    </View>
  )
}

// ─── Sheets ──────────────────────────────────────────────────────────────────

/** Bottom sheet with grab handle (web: settings / delete sheets). */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: C.scrim }} onPress={onClose} accessibilityLabel="Close">
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => {}} style={[s.sheet, { paddingBottom: 28 + insets.bottom }]}>
          <View style={s.grab} />
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/** Drop-down shade from the top (web: notification shade). */
export function Shade({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(13,31,36,0.35)' }} onPress={onClose} accessibilityLabel="Close">
        <Pressable onPress={() => {}} style={[s.shade, { paddingTop: insets.top + 14 }]}>
          <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ─── Data loading ────────────────────────────────────────────────────────────

export function useFocusLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const focused = useIsFocused()
  const [data, setData] = useState<T | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const hasData = useRef(false)
  const key = deps.map(String).join('|')

  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )

  const run = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const d = await loaderRef.current()
      if (alive.current) {
        hasData.current = true
        setData(d)
      }
    } catch (e: any) {
      if (alive.current) setError(e?.message ?? 'Something went wrong.')
    } finally {
      if (alive.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    if (focused) run(hasData.current ? 'refresh' : 'initial')
  }, [focused, key, run])

  const reload = useCallback(() => run('refresh'), [run])
  return { data, setData, error, loading: loading && data === undefined, refreshing, reload }
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${fmtDate(iso)} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
}


export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.soft },
  scroll: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: T.title,
  body: T.body,
  serif: T.bodySerif,
  muted: { fontFamily: F.sans, fontSize: 13.5, color: C.muted, lineHeight: 19 },
  mono: T.meta,
  gap: { gap: 10 },
})

const s = StyleSheet.create({
  appbar: {
    paddingHorizontal: 18,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.soft,
    gap: 8,
  },
  appTitle: { fontFamily: F.sansSemi, fontSize: 16.5, letterSpacing: -0.15, color: C.ink },
  appSub: { fontFamily: F.mono, fontSize: 12, color: C.muted },
  card: {
    backgroundColor: '#fff',
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
  },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnSmall: { minHeight: 34, borderRadius: 9, paddingHorizontal: 12 },
  btnText: { fontFamily: F.sansBold, fontSize: 16 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(13,31,36,0.16)',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  input: { flex: 1, fontFamily: F.sans, fontSize: 16.5, color: C.ink, paddingVertical: 10 },
  hint: { fontFamily: F.mono, fontSize: 12, color: C.muted, marginTop: 5 },
  seg: {
    flexDirection: 'row',
    backgroundColor: 'rgba(13,31,36,0.05)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 9 },
  segOn: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.line },
  segText: { fontFamily: F.sansSemi, fontSize: 13.5, color: C.muted },
  segTextOn: { color: C.jadeD, opacity: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(13,31,36,0.12)', backgroundColor: '#fff' },
  chipOn: { borderColor: C.jade, borderWidth: 1.5, backgroundColor: 'rgba(55,181,155,0.10)' },
  chipText: { fontFamily: F.sans, fontSize: 13.5, color: C.ink, textTransform: 'capitalize' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: S.xl, backgroundColor: C.soft },
  empty: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 12, gap: 6 },
  emptyTitle: { fontFamily: F.sansSemi, fontSize: 16.5, color: C.ink, opacity: 0.7, textAlign: 'center' },
  emptyBody: { fontFamily: F.sans, fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 6 },
  error: {
    backgroundColor: '#fff',
    borderLeftWidth: 3,
    borderLeftColor: C.rose,
    borderRadius: 12,
    padding: 11,
    gap: 2,
    marginBottom: 10,
  },
  errorText: { color: C.rose, fontFamily: F.sans, fontSize: 15, lineHeight: 22 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill },
  badgeText: { fontFamily: F.mono, fontSize: 12 },
  badgeDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: C.rose,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDotText: { color: '#fff', fontFamily: F.monoBold, fontSize: 12 },
  sheet: {
    backgroundColor: C.soft,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 20,
    maxHeight: '88%',
  },
  grab: { width: 36, height: 4, borderRadius: 3, backgroundColor: 'rgba(13,31,36,0.16)', alignSelf: 'center', marginBottom: 16 },
  shade: {
    backgroundColor: C.soft,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: 14,
    paddingBottom: 16,
    elevation: 12,
  },
})
