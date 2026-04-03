// All-uppercase string (bank reference style): "C855 C D BERLIN", "REF12345"
const ALL_CAPS_RE = /^[A-Z0-9\s\-\/]+$/

// Alphanumeric reference token: "C855", "AB123"
const ALPHA_NUM_CODE_RE = /\b[A-Z]{1,3}[0-9]{2,}\b/

// 3+ consecutive alphabetic characters anywhere
const ALPHA_RUN_RE = /[a-zA-Z]{3,}/

// At least one lowercase run of 3+ chars (mixed-case = human-readable brand)
const LOWERCASE_RUN_RE = /[a-z]{3,}/

function looksLikeReferenceCode(s: string): boolean {
  if (ALL_CAPS_RE.test(s)) return true
  if (ALPHA_NUM_CODE_RE.test(s)) return true
  if (!ALPHA_RUN_RE.test(s)) return true
  return false
}

function isReadable(s: string): boolean {
  return LOWERCASE_RUN_RE.test(s)
}

export type MerchantDisplay = {
  primary: string
  secondary: string | null
  isAmbiguous: boolean
}

export function getDisplayMerchant(tx: {
  merchant?: string | null
  description?: string | null
}): MerchantDisplay {
  const merchant = tx.merchant?.trim() || null
  const desc = tx.description?.trim() || null

  if (merchant) {
    if (isReadable(merchant)) {
      return { primary: merchant, secondary: null, isAmbiguous: false }
    }
    // merchant looks like a reference code
    if (desc && isReadable(desc)) {
      return { primary: desc, secondary: merchant, isAmbiguous: true }
    }
    return { primary: merchant, secondary: desc ?? null, isAmbiguous: true }
  }

  if (desc) {
    return { primary: desc, secondary: null, isAmbiguous: looksLikeReferenceCode(desc) }
  }

  return { primary: "—", secondary: null, isAmbiguous: false }
}
