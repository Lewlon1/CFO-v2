import { normaliseMerchant } from './src/lib/categorisation/normalise-merchant'

const testCases = [
  'Grandvalira',
  'Fira de Barcelona',
  'Too Good To Go',
  'Casualfood',
  'Aena',
  'La Caseta del Migdia',
  'U.S. Customs and Border Protection',
  'Raja Altaf 2021 SL',
  'Farmàcia del Pas',
]

console.log('Testing merchant normalisation:\n')
testCases.forEach(desc => {
  const norm = normaliseMerchant(desc)
  console.log(`"${desc}" → "${norm}"`)
})
