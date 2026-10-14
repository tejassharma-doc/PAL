/**
 * Icons and gradients drawn exactly as on the website (same SVG paths).
 */
import React from 'react'
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native'
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Polyline, Line } from 'react-native-svg'
import { C } from '../theme'

type P = { size?: number; color?: string }

export function BellIcon({ size = 18, color = C.ink }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M8.5 17.5h3M10 3C7 3 4.5 5.5 4.5 8.5V13l-1.5 2.5h14L15.5 13V8.5C15.5 5.5 13 3 10 3z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/** web: components/family/FamilyHubButton.tsx ChatBubblesIcon */
export function ChatBubblesIcon({ size = 19, color = C.ink }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M3.7 2.6h8.3a2.35 2.35 0 0 1 2.35 2.35v4.6A2.35 2.35 0 0 1 12 11.9H7.6l-2.45 2.2a.42.42 0 0 1-.7-.31V11.9H3.7A2.35 2.35 0 0 1 1.35 9.55v-4.6A2.35 2.35 0 0 1 3.7 2.6Z"
        fill={color}
      />
      <Path
        d="M9.9 7.35h6.5a2.3 2.3 0 0 1 2.3 2.3v3.6a2.3 2.3 0 0 1-2.3 2.3h-.35v1.75a.42.42 0 0 1-.7.31l-2.3-2.06H9.9a2.3 2.3 0 0 1-2.3-2.3v-3.6a2.3 2.3 0 0 1 2.3-2.3Z"
        fill={color}
        stroke="#fff"
        strokeWidth={1.5}
      />
      <G fill="#fff">
        <Circle cx={10.95} cy={11.45} r={0.88} />
        <Circle cx={13.15} cy={11.45} r={0.88} />
        <Circle cx={15.35} cy={11.45} r={0.88} />
      </G>
    </Svg>
  )
}

export function SignOutIcon({ size = 18, color = C.amberD }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M10 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h5" />
      <Polyline points="17 8 21 12 17 16" />
      <Line x1={21} y1={12} x2={9} y2={12} />
    </Svg>
  )
}

export function KeyIcon({ size = 16, color = C.blueD }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Circle cx={6} cy={7} r={3.2} stroke={color} strokeWidth={1.4} />
      <Path d="M8.5 9l5 4.5" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
      <Path d="M11.5 11l1-1" stroke={color} strokeWidth={1.4} strokeLinecap="round" />
    </Svg>
  )
}

export function PlusIcon({ size = 15, color = C.jade }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 15 15" fill="none">
      <Path d="M7.5 3v9M3 7.5h9" stroke={color} strokeWidth={1.7} strokeLinecap="round" />
    </Svg>
  )
}

export function ChevronIcon({ size = 12, color = C.ink }: P) {
  return (
    <Svg width={size * 0.6} height={size} viewBox="0 0 7 12" fill="none">
      <Path d="M1 1l5 5-5 5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export function TrashIcon({ size = 14, color = C.rose }: P) {
  return (
    <Svg width={size} height={size} viewBox="0 0 13 14" fill="none">
      <Path
        d="M1 3.5h11M4.5 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M10.5 3.5l-.5 8a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1l-.5-8"
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/** Fills its parent with a linear gradient (angle in CSS degrees: 150deg, 160deg, …). */
export function Gradient({
  colors,
  angle = 160,
  style,
  radius = 0,
}: {
  colors: readonly string[]
  angle?: number
  style?: StyleProp<ViewStyle>
  radius?: number
}) {
  const id = React.useId().replace(/:/g, '')
  // CSS angle → SVG vector (0deg = to top, 90deg = to right)
  const a = ((angle - 90) * Math.PI) / 180
  const x = Math.cos(a) / 2
  const y = Math.sin(a) / 2
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1={0.5 - x} y1={0.5 - y} x2={0.5 + x} y2={0.5 + y}>
            {colors.map((c, i) => (
              <Stop key={i} offset={colors.length === 1 ? 0 : i / (colors.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/** The website's page backdrop: radial-gradient(120% 80% at 50% -10%, #18454e, #13343b 38%, #0c2429). */
export function DeepBackdrop() {
  const id = React.useId().replace(/:/g, '')
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="-10%" rx="120%" ry="80%" fx="50%" fy="-10%">
            <Stop offset={0} stopColor="#18454e" />
            <Stop offset={0.38} stopColor="#13343b" />
            <Stop offset={1} stopColor="#0c2429" />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

// ── Line icons (Lucide, ISC licence) — the same set the website uses via lucide-react. ──
type Node = [string, Record<string, string>]
const LUCIDE: Record<string, Node[]> = {"message-circle":[["path",{"d":"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"}]],"history":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}],["path",{"d":"M12 7v5l4 2"}]],"file-text":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M10 9H8"}],["path",{"d":"M16 13H8"}],["path",{"d":"M16 17H8"}]],"upload":[["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{"points":"17 8 12 3 7 8"}],["line",{"x1":"12","x2":"12","y1":"3","y2":"15"}]],"calendar-days":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}],["path",{"d":"M8 14h.01"}],["path",{"d":"M12 14h.01"}],["path",{"d":"M16 14h.01"}],["path",{"d":"M8 18h.01"}],["path",{"d":"M12 18h.01"}],["path",{"d":"M16 18h.01"}]],"messages-square":[["path",{"d":"M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"}],["path",{"d":"M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"}]],"settings":[["path",{"d":"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"bell":[["path",{"d":"M10.268 21a2 2 0 0 0 3.464 0"}],["path",{"d":"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"}]],"square-pen":[["path",{"d":"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}],["path",{"d":"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"}]],"copy":[["rect",{"width":"14","height":"14","x":"8","y":"8","rx":"2","ry":"2"}],["path",{"d":"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"arrow-up":[["path",{"d":"m5 12 7-7 7 7"}],["path",{"d":"M12 19V5"}]],"mic":[["path",{"d":"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"}],["path",{"d":"M19 10v2a7 7 0 0 1-14 0v-2"}],["line",{"x1":"12","x2":"12","y1":"19","y2":"22"}]],"paperclip":[["path",{"d":"M13.234 20.252 21 12.3"}],["path",{"d":"m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486"}]],"users":[["path",{"d":"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"}],["circle",{"cx":"9","cy":"7","r":"4"}],["path",{"d":"M22 21v-2a4 4 0 0 0-3-3.87"}],["path",{"d":"M16 3.13a4 4 0 0 1 0 7.75"}]],"log-out":[["path",{"d":"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"}],["polyline",{"points":"16 17 21 12 16 7"}],["line",{"x1":"21","x2":"9","y1":"12","y2":"12"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"search":[["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"trash-2":[["path",{"d":"M3 6h18"}],["path",{"d":"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"}],["path",{"d":"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"}],["line",{"x1":"10","x2":"10","y1":"11","y2":"17"}],["line",{"x1":"14","x2":"14","y1":"11","y2":"17"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"key-round":[["path",{"d":"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"}],["circle",{"cx":"16.5","cy":"7.5","r":".5","fill":"currentColor"}]],"stethoscope":[["path",{"d":"M11 2v2"}],["path",{"d":"M5 2v2"}],["path",{"d":"M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"}],["path",{"d":"M8 15a6 6 0 0 0 12 0v-3"}],["circle",{"cx":"20","cy":"10","r":"2"}]],"clipboard-list":[["rect",{"width":"8","height":"4","x":"8","y":"2","rx":"1","ry":"1"}],["path",{"d":"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"}],["path",{"d":"M12 11h4"}],["path",{"d":"M12 16h4"}],["path",{"d":"M8 11h.01"}],["path",{"d":"M8 16h.01"}]],"folder-heart":[["path",{"d":"M11 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v1.5"}],["path",{"d":"M13.9 17.45c-1.2-1.2-1.14-2.8-.2-3.73a2.43 2.43 0 0 1 3.44 0l.36.34.34-.34a2.43 2.43 0 0 1 3.45-.01c.95.95 1 2.53-.2 3.74L17.5 21Z"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"user":[["path",{"d":"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"}],["circle",{"cx":"12","cy":"7","r":"4"}]],"pill":[["path",{"d":"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"}],["path",{"d":"m8.5 8.5 7 7"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"scan-eye":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}],["circle",{"cx":"12","cy":"12","r":"1"}],["path",{"d":"M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"}]],"folder-open":[["path",{"d":"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"}]],"ban":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"m4.9 4.9 14.2 14.2"}]],"users-round":[["path",{"d":"M18 21a8 8 0 0 0-16 0"}],["circle",{"cx":"10","cy":"8","r":"5"}],["path",{"d":"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"}]],"sparkles":[["path",{"d":"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"}],["path",{"d":"M20 3v4"}],["path",{"d":"M22 5h-4"}],["path",{"d":"M4 17v2"}],["path",{"d":"M5 18H3"}]]}

export const hasLineIcon = (name?: string) => !!name && name in LUCIDE

/** A 24×24 Lucide line icon. Default colour is the shared icon grey. */
export function LineIcon({ name, size = 24, color = C.icon, strokeWidth = 2 }: { name: string; size?: number; color?: string; strokeWidth?: number }) {
  const nodes = LUCIDE[name]
  if (!nodes) return null
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {nodes.map(([tag, a], i) => {
        const p: any = { key: i }
        for (const [k, v] of Object.entries(a)) p[k] = isNaN(Number(v)) ? v : Number(v)
        if (tag === 'path') return <Path {...p} />
        if (tag === 'circle') return <Circle {...p} />
        if (tag === 'rect') return <Rect {...p} />
        if (tag === 'line') return <Line {...p} />
        if (tag === 'polyline') return <Polyline {...p} />
        return null
      })}
    </Svg>
  )
}
