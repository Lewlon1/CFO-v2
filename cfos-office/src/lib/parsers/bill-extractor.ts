import { generateObject } from 'ai'
import { z } from 'zod'
import { analysisModel } from '@/lib/ai/provider'

const billExtractionSchema = z.object({
  provider: z.string().describe('Exact provider name (e.g. "Iberdrola" not "Grupo Iberdrola")'),
  bill_type: z.enum([
    'electricity', 'gas', 'water', 'internet', 'mobile',
    'insurance_health', 'insurance_home', 'insurance_car',
    'subscription', 'other',
  ]),
  billing_period_start: z.string().nullable().describe('Start of billing period in YYYY-MM-DD format'),
  billing_period_end: z.string().nullable().describe('End of billing period in YYYY-MM-DD format'),
  total_amount: z.number().describe('Total amount due'),
  currency: z.string().default('EUR'),
  consumption_kwh: z.number().nullable().describe('Electricity consumption in kWh'),
  tariff_type: z.string().nullable().describe('Tariff type, e.g. PVPC, mercado libre'),
  power_contracted_kw: z.number().nullable().describe('Contracted power in kW (potencia contratada)'),
  consumption_m3: z.number().nullable().describe('Gas consumption in m³'),
  plan_name: z.string().nullable(),
  speed_mbps: z.number().nullable(),
  data_gb: z.number().nullable(),
  coverage_type: z.string().nullable(),
  contract_end_date: z.string().nullable().describe('Contract end date in YYYY-MM-DD format'),
  has_permanencia: z.boolean().nullable().describe('Whether there is a lock-in period'),
  permanencia_end_date: z.string().nullable().describe('Lock-in end date in YYYY-MM-DD'),
  confidence: z.enum(['high', 'medium', 'low']),
})

export interface BillExtraction {
  provider: string
  bill_type: string
  billing_period: { start: string; end: string } | null
  total_amount: number
  currency: string
  consumption_kwh: number | null
  tariff_type: string | null
  power_contracted_kw: number | null
  consumption_m3: number | null
  plan_name: string | null
  speed_mbps: number | null
  data_gb: number | null
  coverage_type: string | null
  coverage_details: string | null
  contract_end_date: string | null
  has_permanencia: boolean | null
  permanencia_end_date: string | null
  confidence: 'high' | 'medium' | 'low'
}

export type BillExtractionResult =
  | { ok: true; extraction: BillExtraction }
  | { ok: false; error: string }

const BILL_EXTRACTION_PROMPT = `You are a financial document parser specialising in Spanish utility bills and European service provider invoices.

Extract all available structured data from this bill. Pay special attention to:
- The exact provider name (not the parent company)
- The billing period (some Spanish utilities bill bimonthly)
- Consumption figures (kWh for electricity, m³ for gas)
- The tariff type (PVPC/regulada vs mercado libre for Spanish electricity)
- Contracted power in kW (potencia contratada)
- Any contract end dates or permanencia (lock-in) periods
- The total amount due

Spanish bill terminology:
- "Término de potencia" = power term (fixed charge based on contracted kW)
- "Término de energía" = energy term (variable charge based on kWh consumed)
- "IVA" = VAT (21% electricity, 10% gas in Spain)
- "PVPC" = regulated tariff
- "Permanencia" = minimum contract period / lock-in

If the document is unclear or not a bill, set confidence to "low".
If some fields are readable but others aren't, extract what you can and set confidence to "medium".`

export async function extractBillData(
  files: Array<{ base64: string; fileType: 'pdf' | 'image' }>
): Promise<BillExtractionResult> {
  try {
    const content: Array<{ type: string; [key: string]: unknown }> = []

    for (const file of files) {
      if (file.fileType === 'pdf') {
        content.push({
          type: 'file',
          data: file.base64,
          mimeType: 'application/pdf',
        })
      } else {
        content.push({
          type: 'image',
          image: file.base64,
        })
      }
    }

    content.push({
      type: 'text',
      text: files.length > 1
        ? `These ${files.length} images are pages of a SINGLE bill. Extract data from ALL pages combined.\n\n${BILL_EXTRACTION_PROMPT}`
        : BILL_EXTRACTION_PROMPT,
    })

    const { object } = await generateObject({
      model: analysisModel,
      schema: billExtractionSchema,
      messages: [
        {
          role: 'user',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: content as any,
        },
      ],
    })

    if (!object.provider || typeof object.total_amount !== 'number') {
      return { ok: false, error: 'Could not extract bill data. The document may not be a recognisable bill.' }
    }

    const extraction: BillExtraction = {
      provider: object.provider,
      bill_type: object.bill_type,
      billing_period: object.billing_period_start && object.billing_period_end
        ? { start: object.billing_period_start, end: object.billing_period_end }
        : null,
      total_amount: object.total_amount,
      currency: object.currency,
      consumption_kwh: object.consumption_kwh,
      tariff_type: object.tariff_type,
      power_contracted_kw: object.power_contracted_kw,
      consumption_m3: object.consumption_m3,
      plan_name: object.plan_name,
      speed_mbps: object.speed_mbps,
      data_gb: object.data_gb,
      coverage_type: object.coverage_type,
      coverage_details: null,
      contract_end_date: object.contract_end_date,
      has_permanencia: object.has_permanencia,
      permanencia_end_date: object.permanencia_end_date,
      confidence: object.confidence,
    }

    return { ok: true, extraction }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[bill-extractor] Extraction failed:', message)
    return { ok: false, error: `Bill extraction failed: ${message}` }
  }
}
