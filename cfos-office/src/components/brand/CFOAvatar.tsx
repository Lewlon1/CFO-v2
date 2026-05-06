interface CFOAvatarProps {
  size: number
  withOnlineDot?: boolean
  className?: string
}

export function CFOAvatar({ size, withOnlineDot, className }: CFOAvatarProps) {
  return (
    <span className={`relative inline-flex shrink-0 ${className ?? ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0, borderRadius: Math.round(size * 0.07) }}
      >
        <rect width="100" height="100" rx="22" fill="#E8A84C" />
        <circle cx="50" cy="38" r="20" fill="#F0E6D4" opacity="0.9" />
        {/* Left glasses lens */}
        <path d="M30 30 Q30 26 36 26 L46 26 Q50 26 50 30 L50 38 Q50 42 46 42 L36 42 Q30 42 30 38 Z" fill="#1A1A18" opacity="0.8" />
        {/* Right glasses lens */}
        <path d="M54 30 Q54 26 60 26 L70 26 Q74 26 74 30 L74 38 Q74 42 70 42 L60 42 Q54 42 54 38 Z" fill="#1A1A18" opacity="0.8" />
        {/* Glasses bridge */}
        <line x1="50" y1="32" x2="54" y2="32" stroke="#1A1A18" strokeWidth="1.5" opacity="0.6" />
        {/* Smile */}
        <path d="M43 50 Q50 54 57 50" fill="none" stroke="#1A1A18" strokeWidth="1.5" strokeLinecap="round" opacity="0.22" />
        {/* Suit/body */}
        <path d="M14 66 Q14 56 50 56 Q86 56 86 66 L86 100 L14 100 Z" fill="#0F0F0D" opacity="0.6" />
      </svg>

      {withOnlineDot && (
        <span
          className="absolute bottom-0 right-0 rounded-full bg-positive"
          style={{
            width: Math.max(10, Math.round(size * 0.26)),
            height: Math.max(10, Math.round(size * 0.26)),
            boxShadow: `0 0 0 2px var(--bg-elevated)`,
          }}
        />
      )}
    </span>
  )
}

export default CFOAvatar
