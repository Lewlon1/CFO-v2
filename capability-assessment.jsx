import { useState } from "react";

const CATEGORIES = [
  {
    id: "everyday",
    label: "Everyday money management",
    color: "#1D9E75",
    items: [
      {
        id: "budget",
        name: "Create & manage a budget",
        original: "1",
        description: "Monthly spending plans, category budgets, cash flow timing across regular and bonus months",
        confidence: 85,
        comment: "Strong — I have your full income structure, fixed costs, and three months of transaction data. I know your spending triggers and which categories flex most. The gap is that three months isn't enough to separate your baseline from holiday-inflated months.",
        needs: [
          "12 months of Revolut statements to establish true baseline patterns",
          "Confirmation of which months typically involve holidays/trips",
          "Your girlfriend's financial contribution to shared costs (meals, groceries, activities)",
        ],
      },
      {
        id: "recurring",
        name: "Review & optimise recurring payments",
        original: "5",
        description: "Bills, subscriptions, insurance, memberships — are you getting the best deal?",
        confidence: 80,
        comment: "Good — I've already audited your bills and identified €50-77/month in savings from Digi, Iberdrola, and gas. I know your providers, amounts, and billing cycles. Missing a few details on your current contract terms.",
        needs: [
          "Your current Digi plan details (speed, data, contract type — Fibra SMART or Movistar network)",
          "Iberdrola contract type (regulated PVPC or free market tariff)",
          "Your electricity consumption in kWh (from a recent Iberdrola bill)",
          "Whether your rental contract restricts changing energy providers",
        ],
      },
      {
        id: "foundational",
        name: "Optimise foundational spending",
        original: "6",
        description: "Groceries, transport, dining — getting the same lifestyle for less through deals, timing, and smarter choices",
        confidence: 60,
        comment: "Moderate — I know where you shop (Aldi, Caprabo, Mercadona), how often, and what you spend. But I don't know what you're buying, which means I can't recommend specific product switches, loyalty programs, or timing strategies.",
        needs: [
          "Which supermarket loyalty cards you have (Caprabo Club, Mercadona is none, Aldi is none)",
          "Whether you're flexible on brands or buy specific products",
          "Your typical grocery list / what you eat regularly",
          "Whether you meal plan or buy ad hoc",
          "Whether you'd use cashback apps like Too Good To Go, Shopmium, or similar",
          "Your regular transport patterns beyond Bicing (do you ever need a car?)",
        ],
      },
    ],
  },
  {
    id: "planning",
    label: "Planning & goals",
    items: [
      {
        id: "goals",
        name: "Create & track financial goals",
        original: "3",
        description: "Define targets, set timelines, calculate required savings rates, track progress",
        confidence: 75,
        comment: "Good foundation — I know your headline goal (part-time at 40, golf) and your values ranking. But 'part-time at 40' isn't specific enough to model properly yet. I need it to be a real number I can work backwards from.",
        needs: [
          "What does part-time income look like? Freelance dev? Reduced hours at current employer? Teaching? Golf-related?",
          "Where would you live at 40? Barcelona? UK? Somewhere cheaper?",
          "Would your partner's income factor in by then?",
          "What annual spending would you need to feel comfortable?",
          "Any medium-term goals before 40 — buying property, moving countries, starting a business?",
        ],
      },
      {
        id: "holiday",
        name: "Holiday & trip planning",
        original: "2",
        description: "Budget trips, find deals on flights and accommodation, plan spending money, balance travel with savings goals",
        confidence: 70,
        comment: "Decent — I know you fly frequently (Iberia, Ryanair, EasyJet, Frontier), mostly from Barcelona. I know experiences are your second-highest value and travel is your biggest discretionary spend. But I'm reactive right now — I can budget a trip when you tell me about it, but I can't proactively find you deals.",
        needs: [
          "Your typical trip cadence — how many trips per year, and roughly when?",
          "Preferred destinations or types of trips (city breaks, beach, ski, visiting family/friends)",
          "Whether you're flexible on dates (mid-week flights are cheaper)",
          "Airport preferences (BCN only, or willing to use Girona/Reus?)",
          "Your Revolut or any airline points/loyalty program memberships",
          "Your girlfriend's travel preferences and whether you split costs",
        ],
      },
      {
        id: "scenarios",
        name: "Scenario modelling",
        original: "8",
        description: "What-if analysis — salary increases, investment returns, moving countries, changing jobs, large purchases",
        confidence: 80,
        comment: "Strong — I have enough baseline data to model most scenarios against. I can project compound growth on your ISA, model salary increases, show the impact of different savings rates on your retirement timeline. The math is straightforward once the inputs are right.",
        needs: [
          "Your realistic salary trajectory — what do senior devs earn in Barcelona? Would you switch to a UK remote role for higher pay?",
          "Any specific scenarios you're already considering (moving, career change, property purchase)",
          "Your S&S ISA allocation — is it index funds, individual stocks, or managed?",
        ],
      },
    ],
  },
  {
    id: "investing",
    label: "Investing & wealth building",
    items: [
      {
        id: "investments",
        name: "Review investment strategy",
        original: "4",
        description: "Asset allocation, pension optimisation, ISA strategy, crypto position, rebalancing",
        confidence: 55,
        comment: "Moderate — I know the balances (£55k S&S ISA, £12k cash ISA, £3k crypto, new workplace pension) but I don't know what's inside the ISA. Is it one global index fund or a scattered collection of picks? That changes everything about the advice I'd give. Also the cross-border tax situation adds real complexity.",
        needs: [
          "Your S&S ISA holdings — fund names, allocation split",
          "Which platform the ISA is on (Vanguard, Hargreaves Lansdown, etc.)",
          "Cash ISA rate — are you getting a competitive rate or is it dormant?",
          "Crypto holdings — which coins, what exchange",
          "Workplace pension fund choices and current allocation",
          "Whether you've filed Spanish tax returns declaring the UK ISA gains",
          "Your actual risk profile beyond 'high tolerance' — have you experienced a 30%+ drawdown and held?",
        ],
      },
      {
        id: "tax",
        name: "Tax optimisation",
        original: "9",
        description: "Spanish tax obligations, UK tax residency implications, declaring foreign assets, deductions and credits",
        confidence: 30,
        comment: "Low — this is my weakest area. I know you're Spanish tax resident with UK assets, which creates real obligations I can flag but not navigate. TaxDown handles your filing, but there are structural questions (like whether your ISA gains should be declared) that need a cross-border specialist. I can point you in the right direction but I'd be doing you a disservice pretending I can give specific tax advice here.",
        needs: [
          "A consultation with a cross-border UK/Spain tax advisor (I can help you find one and prepare questions)",
          "Your TaxDown history — what have you declared so far?",
          "Whether your employer handles all Spanish social security correctly",
          "Any UK tax obligations remaining (beyond the student loan)",
        ],
      },
      {
        id: "government",
        name: "Government initiatives & benefits",
        original: "10",
        description: "Tax breaks, savings incentives, pension schemes, housing programs, employment benefits available in Spain and UK",
        confidence: 40,
        comment: "Low-moderate — I can research what's available but I'm not current on every Spanish incentive for your specific profile. The landscape changes frequently and your situation (UK citizen, Spanish resident, EU employment) creates eligibility questions I'd need to verify.",
        needs: [
          "Your residency status — permanent residency, TIE card, or still on initial registration?",
          "Whether you've looked into Plan Vivienda (housing subsidies for under-35s in Catalonia)",
          "Your awareness of Spanish pension system (pensión pública) and how your UK NI years interact",
          "Any existing benefits or deductions you're already claiming",
        ],
      },
    ],
  },
  {
    id: "life",
    label: "Life events & protection",
    items: [
      {
        id: "life_events",
        name: "Major life events",
        original: "11",
        description: "Marriage, children, property purchase, relocation, job loss, health emergency, divorce, retirement",
        confidence: 45,
        comment: "Moderate-low — I can model the financial impact of any life event against your current position, but each one opens up legal and tax questions specific to your cross-border situation. Marriage to a non-EU partner, buying property in Spain vs UK, unemployment rights as a UK citizen in Spain — these all have layers I can research but shouldn't confidently advise on alone.",
        needs: [
          "Your girlfriend's nationality and residency status (affects marriage, tax, and property implications)",
          "Any plans around marriage, children, or property in the next 5 years",
          "Whether you have any life insurance, income protection, or critical illness cover",
          "Your parents' situation — any inheritance likely, or might you need to support them?",
          "Whether returning to the UK is a realistic option",
        ],
      },
      {
        id: "emergency",
        name: "Emergency preparedness",
        original: null,
        description: "Emergency fund adequacy, insurance coverage, worst-case scenario planning",
        confidence: 65,
        comment: "Decent — I know you have £12k in a cash ISA (effectively your emergency fund) and Sanitas for health cover. Revolut Metal provides travel insurance. But I don't know if you have any other protection, and your current zero-savings-buffer makes you vulnerable to even small unexpected costs.",
        needs: [
          "Whether the £12k cash ISA is accessible quickly or locked",
          "Any other insurance beyond Sanitas and Revolut (home contents, liability, income protection)",
          "Your employer's sick pay and redundancy terms",
          "Whether your rental deposit is protected and recoverable",
        ],
      },
    ],
  },
  {
    id: "follow",
    label: "Ongoing advisory",
    items: [
      {
        id: "actions",
        name: "Action item follow-ups",
        original: "7",
        description: "Track progress on agreed actions, remind and nudge, accountability check-ins",
        confidence: 70,
        comment: "Good in principle — I can maintain a list of actions and check in when you upload statements or start a conversation. The limitation is I rely on you coming to me. I can't proactively nudge you to switch your Digi plan or remind you to transfer money on payday.",
        needs: [
          "Agreement on a monthly check-in rhythm (e.g. first weekend of each month, upload statements, review together)",
          "Permission to be direct when you're off track — do you want gentle or blunt?",
          "A prioritised action list we both agree on",
        ],
      },
      {
        id: "monthly",
        name: "Monthly financial review",
        original: null,
        description: "Regular statement analysis, spending vs budget, progress toward goals, course corrections",
        confidence: 75,
        comment: "Strong — this is where I add the most value over time. Each month of data sharpens the picture. After 6-12 months I'd know your real patterns better than you do and could spot drift before it becomes a problem.",
        needs: [
          "Monthly Revolut CSV export (takes 30 seconds)",
          "Quarterly Santander export for bill tracking",
          "Periodic investment balance updates (quarterly is fine)",
        ],
      },
      {
        id: "spending_intel",
        name: "Proactive spending intelligence",
        original: null,
        description: "Researching deals, promotions, and better prices before you spend — not after",
        confidence: 50,
        comment: "Moderate — I can research on demand, but right now you'd need to ask me each time. The vision you described (me planning and optimising spending for you) is the right model but requires me knowing what you're about to spend on. I'm reactive unless you tell me what's coming.",
        needs: [
          "Advance notice on planned purchases (flights, tech, events)",
          "Your upcoming social calendar where spending is likely (birthdays, holidays, visitors)",
          "Openness to me suggesting alternatives when I find better deals",
        ],
      },
    ],
  },
];

function ConfidenceBar({ value }) {
  let color = "#E24B4A";
  if (value >= 70) color = "#1D9E75";
  else if (value >= 50) color = "#BA7517";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 500, color, minWidth: 36, textAlign: "right" }}>{value}%</span>
    </div>
  );
}

function ItemCard({ item, isOpen, toggle }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "0.5px solid var(--color-border-tertiary)",
      borderRadius: "var(--border-radius-lg)",
      overflow: "hidden",
      marginBottom: 6,
    }}>
      <div
        onClick={toggle}
        style={{
          padding: "12px 16px", cursor: "pointer",
          display: "flex", flexDirection: "column", gap: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</span>
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{item.description}</div>
        <ConfidenceBar value={item.confidence} />
      </div>
      {isOpen && (
        <div style={{ padding: "0 16px 16px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 4 }}>Assessment</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--color-text-primary)" }}>{item.comment}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 6 }}>What I need to reach 90%+</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {item.needs.map((need, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                  <span style={{ color: "var(--color-text-info)", flexShrink: 0 }}>→</span>
                  <span>{need}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CapabilityAssessment() {
  const [openItems, setOpenItems] = useState(new Set());

  function toggle(id) {
    const next = new Set(openItems);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpenItems(next);
  }

  function expandAll() {
    const all = new Set();
    CATEGORIES.forEach(c => c.items.forEach(i => all.add(i.id)));
    setOpenItems(all);
  }

  function collapseAll() {
    setOpenItems(new Set());
  }

  const allItems = CATEGORIES.flatMap(c => c.items);
  const avgConfidence = Math.round(allItems.reduce((s, i) => s + i.confidence, 0) / allItems.length);
  const totalNeeds = allItems.reduce((s, i) => s + i.needs.length, 0);

  return (
    <div style={{ maxWidth: 660, margin: "0 auto", padding: "0.5rem 0" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem" }}>
        <div style={{ flex: 1, background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 2 }}>Situations covered</div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{allItems.length}</div>
        </div>
        <div style={{ flex: 1, background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 2 }}>Average confidence</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: avgConfidence >= 60 ? "#BA7517" : "#E24B4A" }}>{avgConfidence}%</div>
        </div>
        <div style={{ flex: 1, background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 14px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 2 }}>Data gaps to fill</div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{totalNeeds}</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 12 }}>
        <button onClick={expandAll} style={{ fontSize: 12, padding: "4px 10px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", color: "var(--color-text-secondary)" }}>Expand all</button>
        <button onClick={collapseAll} style={{ fontSize: 12, padding: "4px 10px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", cursor: "pointer", color: "var(--color-text-secondary)" }}>Collapse all</button>
      </div>

      {CATEGORIES.map(cat => (
        <div key={cat.id} style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            {cat.label}
          </div>
          {cat.items.map(item => (
            <ItemCard key={item.id} item={item} isOpen={openItems.has(item.id)} toggle={() => toggle(item.id)} />
          ))}
        </div>
      ))}

      <div style={{
        padding: "16px", marginTop: "1rem",
        background: "var(--color-background-secondary)",
        borderRadius: "var(--border-radius-md)",
        fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.7,
      }}>
        <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>Key refinements from your original list</div>
        <div style={{ marginBottom: 8 }}>Added three situations not in your original 11: emergency preparedness, monthly financial reviews, and proactive spending intelligence. Merged "create a budget" with ongoing budget management since a budget without tracking is just a wish. Grouped everything into five logical categories that match the lifecycle of financial advice.</div>
        <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>Where I'm strongest vs weakest</div>
        <div style={{ marginBottom: 8 }}>Strongest on budgeting, scenario modelling, and monthly reviews — these are data-driven and I already have good data. Weakest on tax and government initiatives — these require jurisdiction-specific expertise that changes frequently and has legal consequences if wrong. I'll always flag when you need a human specialist.</div>
        <div style={{ fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 4 }}>The single biggest unlock</div>
        <div>12 months of Revolut statements would improve almost every category. It's the difference between advising based on a snapshot versus understanding your real patterns. Second biggest: a one-time conversation about your ISA holdings and investment platform.</div>
      </div>
    </div>
  );
}
