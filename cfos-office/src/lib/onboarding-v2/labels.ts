export const STRUGGLE_OPTIONS = [
  { id: 'dont_know', label: "I don't know where my money goes" },
  { id: 'debt',      label: "I'm carrying debt I want to clear" },
  { id: 'wealth',    label: 'I want to start building wealth' },
  { id: 'planning',  label: "I'm planning for something specific" },
] as const

export type StruggleOptionId = (typeof STRUGGLE_OPTIONS)[number]['id']
