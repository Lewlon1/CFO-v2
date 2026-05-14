export const STRUGGLE_OPTIONS = [
  { id: 'dont_know', label: "I don't know where my money goes" },
  { id: 'debt',      label: "I'm carrying debt I want to clear" },
  { id: 'wealth',    label: 'I want to start building wealth' },
  { id: 'planning',  label: "I'm planning for something specific" },
] as const

export type StruggleOptionId = (typeof STRUGGLE_OPTIONS)[number]['id']

export const STRUGGLE_LABELS: Record<string, string> = {
  dont_know: "I don't know where my money goes",
  debt:      "I'm carrying debt I want to clear",
  wealth:    'I want to start building wealth',
  planning:  "I'm planning for something specific",
  free_text: '(In their own words — see entry_struggle_text)',
}
