import { useEffect, useState, type CSSProperties } from 'react'
import type { GulliverPose } from '@shared/brandManual'
import { cx } from './ui'

export interface GulliverMascotProps {
  pose?: GulliverPose
  lipSync?: boolean
  monoclePop?: boolean
  width?: number
  height?: number
  className?: string
  style?: CSSProperties
}

/**
 * 2D Flat Vector Mascot: Gulliver (Cargo Captain Seagull)
 * Compliant with Kurzgesagt style & Master Brand Manual.
 */
export function GulliverMascot({
  pose = 'saluting',
  lipSync = false,
  monoclePop = false,
  width = 150,
  height = 170,
  className,
  style
}: GulliverMascotProps) {
  const [popping, setPopping] = useState(false)

  useEffect(() => {
    if (monoclePop) {
      setPopping(true)
      const t = setTimeout(() => setPopping(false), 2400)
      return () => clearTimeout(t)
    }
    setPopping(false)
    return undefined
  }, [monoclePop])

  return (
    <div
      className={cx('relative select-none pointer-events-none drop-shadow-md', className)}
      style={{ width, height, ...style }}
      aria-label="Gulliver Cargo Captain Seagull"
    >
      <svg viewBox="0 0 200 220" fill="none" xmlns="http://www.w3.org/2000/svg" className="size-full overflow-visible">
        <ellipse cx="100" cy="210" rx="55" ry="9" fill="#1C2B38" opacity="0.16" />

        {/* Navy Jacket & Torso */}
        <path d="M52 140 C52 110, 148 110, 148 140 L158 205 C158 214, 42 214, 42 205 Z" fill="#214154" />
        <path d="M86 125 L100 155 L114 125 Z" fill="#FDF7EC" />
        <circle cx="100" cy="165" r="3.5" fill="#F7BE3B" />
        <circle cx="100" cy="185" r="3.5" fill="#F7BE3B" />

        {/* Wings per pose */}
        <g id="wings">
          {pose === 'saluting' && (
            <>
              <path d="M48 140 C35 155, 38 185, 52 195 Z" fill="#EADFC8" />
              <path d="M148 140 C168 120, 166 95, 140 90 C136 105, 140 125, 148 140 Z" fill="#FDF7EC" />
            </>
          )}
          {pose === 'pointing' && (
            <>
              <path d="M48 140 C35 155, 38 185, 52 195 Z" fill="#EADFC8" />
              <path d="M148 140 C175 130, 205 125, 215 130 C195 145, 170 155, 148 150 Z" fill="#FDF7EC" />
            </>
          )}
          {pose === 'shocked' && (
            <>
              <path d="M45 145 C25 120, 18 95, 30 85 C42 100, 48 125, 45 145 Z" fill="#FDF7EC" />
              <path d="M155 145 C175 120, 182 95, 170 85 C158 100, 152 125, 155 145 Z" fill="#FDF7EC" />
            </>
          )}
          {pose === 'inspecting' && (
            <>
              <path d="M50 140 C42 165, 50 185, 60 190 Z" fill="#EADFC8" />
              <path d="M148 140 C165 155, 155 180, 135 170 Z" fill="#FDF7EC" />
              <circle cx="145" cy="115" r="13" stroke="#F7BE3B" strokeWidth="3" fill="#7CE4F8" fillOpacity="0.35" />
              <line x1="145" y1="128" x2="140" y2="155" stroke="#214154" strokeWidth="4" strokeLinecap="round" />
            </>
          )}
          {pose === 'calculating' && (
            <>
              <path d="M48 140 C35 155, 38 185, 52 195 Z" fill="#EADFC8" />
              <path d="M148 140 C165 130, 140 110, 115 118 Z" fill="#FDF7EC" />
              <circle cx="140" cy="72" r="10" fill="#F7BE3B" />
              <text x="136" y="76" fill="#1C2B38" fontSize="12" fontWeight="bold">$</text>
            </>
          )}
        </g>

        {/* Head */}
        <g id="head">
          <circle cx="100" cy="80" r="42" fill="#FDF7EC" />
          <path d="M70 95 C80 115, 120 115, 130 95 Z" fill="#EADFC8" />

          {/* Eyes */}
          <circle cx="82" cy="74" r={pose === 'shocked' ? 8.5 : 6} fill="#1C2B38" />
          <circle cx="80" cy="72" r="2" fill="#FFFFFF" />
          <circle cx="118" cy="74" r={pose === 'shocked' ? 8.5 : 6} fill="#1C2B38" />
          <circle cx="116" cy="72" r="2" fill="#FFFFFF" />

          {/* Gold Coin Monocle with Spring Pop */}
          <g
            id="monocle"
            style={{
              transformOrigin: '118px 74px',
              transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
              transform: popping ? 'translate(26px, -16px) scale(1.3) rotate(20deg)' : 'none'
            }}
          >
            <circle cx="118" cy="74" r="14" stroke="#F7BE3B" strokeWidth="3" fill="#7CE4F8" fillOpacity="0.25" />
            <path d="M110 86 Q118 108 126 122" stroke="#F7BE3B" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
            {popping && (
              <text x="134" y="60" fill="#F7BE3B" fontSize="12" fontWeight="bold">!</text>
            )}
          </g>

          {/* Beak & Lip-sync */}
          <path d="M88 82 C98 80, 102 80, 112 82 L100 96 Z" fill="#F7BE3B" />
          <path
            d="M90 85 C97 86, 103 86, 110 85 L100 101 Z"
            fill="#E85848"
            style={{
              transformOrigin: '100px 85px',
              animation: lipSync ? 'gulliverBeak 0.22s ease-in-out infinite alternate' : 'none'
            }}
          />

          {/* Navy Captain Hat */}
          <path d="M68 55 C68 45, 132 45, 132 55 L138 62 C138 65, 62 65, 62 62 Z" fill="#1C2B38" />
          <path d="M68 50 C65 24, 135 24, 132 50 Z" fill="#214154" />
          <path d="M67 52 Q100 56 133 52" stroke="#F7BE3B" strokeWidth="3" fill="none" />
          <circle cx="100" cy="38" r="6.5" fill="#F7BE3B" />
          <path d="M100 34 L100 42 M97 39 C97 42, 103 42, 103 39" stroke="#214154" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      </svg>

      <style>{`
        @keyframes gulliverBeak {
          0% { transform: translateY(0px) scaleY(1); }
          100% { transform: translateY(3.5px) scaleY(1.3); }
        }
      `}</style>
    </div>
  )
}
