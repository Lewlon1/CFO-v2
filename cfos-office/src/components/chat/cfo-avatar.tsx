'use client'

import { cn } from '@/lib/utils'

interface CfoAvatarProps {
  size?: 'sm' | 'md' | 'lg'
  status?: 'idle' | 'thinking'
  className?: string
}

const sizeClasses = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-12 h-12 text-base',
}

export function CfoAvatar({ size = 'md', status = 'idle', className }: CfoAvatarProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-sm font-bold text-primary-foreground flex-shrink-0',
        'bg-primary',
        status === 'thinking' && 'animate-pulse',
        sizeClasses[size],
        className
      )}
      aria-label="CFO avatar"
    >
      £
    </div>
  )
}
