import { Hero } from '@/components/landing/Hero'
import { Capabilities } from '@/components/landing/Capabilities'
import { Autopilot } from '@/components/landing/Autopilot'
import { Compounding } from '@/components/landing/Compounding'
import { Trust } from '@/components/landing/Trust'
import { JourneyStrip } from '@/components/landing/JourneyStrip'
import { BottomCta } from '@/components/landing/BottomCta'

export default function V4Page() {
  return (
    <main>
      <Hero />
      <Capabilities />
      <Autopilot />
      <Compounding />
      <Trust />
      <JourneyStrip />
      <BottomCta />
    </main>
  )
}
