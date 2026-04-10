interface CFOAvatarProps {
  size: number
  withOnlineDot?: boolean
  className?: string
}

export function CFOAvatar({ size, withOnlineDot, className }: CFOAvatarProps) {
  const dotSize = Math.max(6, Math.round(size * 0.22))
  const borderWidth = Math.max(1.5, Math.round(size * 0.05))

  return (
    <span className={`relative inline-flex shrink-0 ${className ?? ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 46 46"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Face shape — rounded rectangle */}
        <rect x="3" y="3" width="40" height="40" rx="12" fill="#252521" />

        {/* Left lens */}
        <path
          d="M8 18c0-2 1.5-4 4-4h3.5c2 0 3.5 1.5 3.5 3.5v4c0 2.5-1.2 4.5-3.5 5-1.5.3-3.2.2-4.5-.5C9.2 25 8 23 8 21v-3z"
          fill="#1A1A17"
          stroke="#E8A84C"
          strokeWidth="1.8"
        />

        {/* Right lens */}
        <path
          d="M27 18c0-2 1.5-4 4-4h3.5c2 0 3.5 1.5 3.5 3.5v4c0 2.5-1.2 4.5-3.5 5-1.5.3-3.2.2-4.5-.5C28.2 25 27 23 27 21v-3z"
          fill="#1A1A17"
          stroke="#E8A84C"
          strokeWidth="1.8"
        />

        {/* Bridge */}
        <path
          d="M19 18.5c1-1.5 3.2-2 5-2 1.8 0 2.5.5 3 2"
          stroke="#E8A84C"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Left arm */}
        <path
          d="M8 19.5L4.5 18"
          stroke="#E8A84C"
          strokeWidth="1.3"
          strokeLinecap="round"
        />

        {/* Right arm */}
        <path
          d="M38 19.5L41.5 18"
          stroke="#E8A84C"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>

      {withOnlineDot && (
        <span
          className="absolute bottom-0 right-0 rounded-full bg-office-green"
          style={{
            width: dotSize,
            height: dotSize,
            boxShadow: `0 0 0 ${borderWidth}px var(--office-bg)`,
          }}
        />
      )}
    </span>
  )
}

export default CFOAvatar
