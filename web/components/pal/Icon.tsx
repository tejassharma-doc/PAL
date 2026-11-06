/**
 * PAL redesign icon set — ported verbatim from the pal-app.html prototype's `P`
 * map. Usage: <Icon name="check" />. Inherits color/size via the `.ico` class
 * (from pal-ui.css), overridable with className/style.
 */
import React from 'react'

export const ICON_PATHS: Record<string, string> = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  ask: '<path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.4-5.4A8.5 8.5 0 1 1 21 12z"/><path d="M8.5 10.5h7M8.5 14h4.5"/>',
  pill: '<path d="M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7z"/><path d="M7 10l7 7"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  rec: '<path d="M14 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  fam: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.6a6.5 6.5 0 0 1 3.5 5.9"/>',
  set: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  bell: '<path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15 6 8.5"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 10.5v.5a7 7 0 0 0 14 0v-.5M12 18v3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  up: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  phone: '<path d="M21.5 16.4v3a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19 19 0 0 1-5.9-5.9 19.5 19.5 0 0 1-3-8.5A2 2 0 0 1 3.9 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L7.9 9.8a15 15 0 0 0 6.3 6.3l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  cam: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  speak: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6M12 16.8v.3"/>',
  dl: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  search2: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16 16"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  idc: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  micoff: '<path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 10V5.5a3 3 0 0 0-5.8-1"/><path d="M5 10.5v.5a7 7 0 0 0 11.5 5.4M19 10.5v.5c0 .8-.1 1.5-.4 2.2M12 18v3.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  rupee: '<path d="M7 4h10M7 8.5h10M13 4c3.5 0 3.5 9-3 9H7l7.5 7"/>',
}

export function Icon({ name, className = 'ico', style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] || '' }}
      style={style}
    />
  )
}
