'use client'

import {
  PiggyBank,
  TrendingUp,
  Shield,
  Landmark,
  Bitcoin,
  Home,
  Package,
  GraduationCap,
  CreditCard,
  Banknote,
  Car,
  ShoppingBag,
  AlertCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const ICON_MAP: Record<string, LucideIcon> = {
  'piggy-bank': PiggyBank,
  'trending-up': TrendingUp,
  shield: Shield,
  landmark: Landmark,
  bitcoin: Bitcoin,
  home: Home,
  package: Package,
  'graduation-cap': GraduationCap,
  'credit-card': CreditCard,
  banknote: Banknote,
  car: Car,
  'shopping-bag': ShoppingBag,
  'alert-circle': AlertCircle,
}

type Props = {
  name: string
  className?: string
}

export function GroupIcon({ name, className }: Props) {
  const Icon = ICON_MAP[name] || Package
  return <Icon className={className} aria-hidden="true" />
}
