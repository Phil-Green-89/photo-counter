import type { ComponentChildren } from 'preact'
import type { ItemId } from '../feedback/store'

const S = { fill: 'none', stroke: 'currentColor', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const

function Svg({ size, stroke = 2, vb, children }: { size: number; stroke?: number; vb: number; children: ComponentChildren }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} aria-hidden="true" {...S} stroke-width={stroke}>
      {children}
    </svg>
  )
}

/** Small UI glyphs (24px grid, 2px stroke). */
export type UiIcon =
  | 'camera' | 'home' | 'undo' | 'up' | 'down' | 'share' | 'plus' | 'minus' | 'cloud' | 'lock'
  | 'check' | 'x' | 'moon' | 'tap' | 'draw' | 'grid'

export function Icon({ name, size = 28 }: { name: UiIcon; size?: number }) {
  return (
    <Svg size={size} vb={24}>
      {name === 'camera' && <>
        <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
        <circle cx="12" cy="13.2" r="3.6" />
      </>}
      {name === 'home' && <path d="M3.5 11 12 3.5 20.5 11V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z" />}
      {name === 'undo' && <><path d="M8.5 4.5 4 9l4.5 4.5" /><path d="M4 9h10.5a5 5 0 0 1 0 10H9" /></>}
      {name === 'up' && <>
        <path d="M7.5 11v9.5h-4V11z" />
        <path d="M7.5 11 11 3.8a2 2 0 0 1 3.6 1.7L13.6 9H19a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7.5" />
      </>}
      {name === 'down' && <g transform="rotate(180 12 12)">
        <path d="M7.5 11v9.5h-4V11z" />
        <path d="M7.5 11 11 3.8a2 2 0 0 1 3.6 1.7L13.6 9H19a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7.5" />
      </g>}
      {name === 'share' && <><path d="M12 15V3.5" /><path d="m7.5 8 4.5-4.5L16.5 8" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></>}
      {name === 'plus' && <path d="M12 5v14M5 12h14" />}
      {name === 'minus' && <path d="M5 12h14" />}
      {name === 'cloud' && <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a4 4 0 0 1 0 8z" />}
      {name === 'lock' && <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>}
      {name === 'check' && <path d="m5 12.5 4.6 4.6L19 7.5" />}
      {name === 'x' && <path d="m6 6 12 12M18 6 6 18" />}
      {name === 'moon' && <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />}
      {name === 'tap' && <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></>}
      {name === 'grid' && <><path d="M7 4h10l4 16H3z" /><path d="M5 12h14M9 4 7 20M15 4l2 16" /></>}
      {name === 'draw' && <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="12" r="2.2" /></>}
    </Svg>
  )
}

/** Illustrated item icons (64px grid), drawn as the thing looks when you count it. */
export function ItemIcon({ id, size = 56 }: { id: ItemId; size?: number }) {
  const soft = { fill: 'currentColor', 'fill-opacity': 0.16 }
  return (
    <Svg size={size} vb={64} stroke={3}>
      {id === 'pipes' && [[21, 23], [43, 23], [32, 42]].map(([x, y]) => (
        <g key={x + '-' + y}><circle cx={x} cy={y} r="11.5" {...soft} /><circle cx={x} cy={y} r="5.2" /></g>
      ))}
      {id === 'rebar' && [[32, 32], [32, 16.5], [45.4, 24.2], [45.4, 39.8], [32, 47.5], [18.6, 39.8], [18.6, 24.2]].map(([x, y]) => (
        <g key={x + '-' + y}><circle cx={x} cy={y} r="7" fill="currentColor" fill-opacity="0.9" stroke-width="2" /><circle cx={x} cy={y} r="2.2" stroke-width="2" style="stroke:var(--surface)" /></g>
      ))}
      {id === 'lumber' && <>
        {[[8, 10], [34, 10], [8, 34], [34, 34]].map(([x, y]) => (
          <g key={x + '-' + y}><rect x={x} y={y} width="22" height="20" rx="3" {...soft} /><path d={`M${x + 6} ${y + 12}a5 4 0 0 1 10 0`} stroke-width="2.2" /><path d={`M${x + 9} ${y + 12}a2 1.6 0 0 1 4 0`} stroke-width="2" /></g>
        ))}
      </>}
      {id === 'boxes' && <>
        <path d="M32 8 54 19.5v25L32 56 10 44.5v-25z" {...soft} />
        <path d="M10 19.5 32 31l22-11.5M32 31v25" />
        <path d="m21 14 22 11.5v8" stroke-width="2.4" />
      </>}
      {id === 'bottles' && <>
        <path d="M27 7h10v10c0 4 8 7 8 16v19a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V33c0-9 8-12 8-16z" {...soft} />
        <path d="M27 7h10M24 36h16M24 46h16" stroke-width="2.4" />
      </>}
      {id === 'bags' && <>
        <path d="M22 10h20l7 11v29a6 6 0 0 1-6 6H21a6 6 0 0 1-6-6V21z" {...soft} />
        <path d="M22 10c3 5 17 5 20 0M15 21h34" />
        <path d="M26 33c3 3 9 3 12 0" stroke-width="2.4" />
      </>}
      {id === 'pallets' && <>
        <rect x="6" y="14" width="52" height="9" rx="2" {...soft} />
        <rect x="6" y="41" width="52" height="9" rx="2" {...soft} />
        <rect x="9" y="23" width="9" height="18" {...soft} /><rect x="27.5" y="23" width="9" height="18" {...soft} /><rect x="46" y="23" width="9" height="18" {...soft} />
      </>}
      {id === 'other' && <>
        <path d="M10 22v-8a4 4 0 0 1 4-4h8M42 10h8a4 4 0 0 1 4 4v8M54 42v8a4 4 0 0 1-4 4h-8M22 54h-8a4 4 0 0 1-4-4v-8" />
        <circle cx="32" cy="32" r="9" {...soft} /><circle cx="32" cy="32" r="2.6" fill="currentColor" />
      </>}
    </Svg>
  )
}

/** Brand mark: three pipe ends. */
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      {[[21, 24], [43, 24], [32, 43]].map(([x, y]) => (
        <g key={x + '-' + y}><circle cx={x} cy={y} r="10.5" fill="none" stroke="#111" stroke-width="5" /></g>
      ))}
    </svg>
  )
}
