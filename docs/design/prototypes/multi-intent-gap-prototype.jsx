import { useState, useEffect } from 'react';

// ── Design tokens (matched to chat prototype) ────────────────────
const tokens = {
  bg: '#1a1612',
  surface: '#221d17',
  surfaceLifted: '#2c2620',
  surfaceDeeper: '#181410',
  border: '#3a342c',
  borderHover: '#4d4538',
  textPrimary: '#f0e9dd',
  textSecondary: '#b8ad99',
  textMuted: '#7a7163',
  textDim: '#574f44',
  accent: '#E8A84C',
};

const QUADRANT_COLOURS = {
  foundation: '#7A9E7E',
  investment: '#D4A24C',
  leak:       '#B8584F',
  burden:     '#8A7468',
  unsure:     '#605749',
};

const QUADRANT_LABELS = {
  foundation: 'Foundation',
  investment: 'Investment',
  leak:       'Leak',
  burden:     'Burden',
  unsure:     'Unsure',
};

// ── Component ────────────────────────────────────────────────────
export default function GapPagePrototype() {
  const [view, setView] = useState('initial'); // 'initial' | 'after_labelling'

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: tokens.bg,
      fontFamily: '"Instrument Sans", system-ui, sans-serif',
      color: tokens.textPrimary,
      padding: '20px 0 60px 0',
    }}>
      <div style={{
        maxWidth: '460px',
        margin: '0 auto',
        padding: '0 20px',
      }}>
        {/* Folder breadcrumb */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '10px',
            color: tokens.textMuted,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>Values &amp; You / The Gap</div>
        </div>

        {/* Page title */}
        <h1 style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: '34px',
          fontWeight: 400,
          color: tokens.textPrimary,
          margin: '0 0 6px 0',
          letterSpacing: '-0.02em',
        }}>The Gap</h1>
        <p style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontStyle: 'italic',
          fontSize: '16px',
          color: tokens.textMuted,
          margin: '0 0 18px 0',
        }}>What you said, vs where the money goes.</p>

        {/* Prototype state toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '22px',
          padding: '8px 10px',
          background: tokens.surfaceDeeper,
          border: `1px dashed ${tokens.border}`,
          borderRadius: '4px',
        }}>
          <span style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '10px',
            color: tokens.textDim,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>prototype state</span>
          <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
            <button
              onClick={() => setView('initial')}
              style={{
                padding: '4px 10px',
                background: view === 'initial' ? tokens.accent : 'transparent',
                color: view === 'initial' ? '#1a1612' : tokens.textSecondary,
                border: `1px solid ${view === 'initial' ? tokens.accent : tokens.border}`,
                borderRadius: '3px',
                fontSize: '11px',
                fontFamily: '"JetBrains Mono", monospace',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >initial</button>
            <button
              onClick={() => setView('after_labelling')}
              style={{
                padding: '4px 10px',
                background: view === 'after_labelling' ? tokens.accent : 'transparent',
                color: view === 'after_labelling' ? '#1a1612' : tokens.textSecondary,
                border: `1px solid ${view === 'after_labelling' ? tokens.accent : tokens.border}`,
                borderRadius: '3px',
                fontSize: '11px',
                fontFamily: '"JetBrains Mono", monospace',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >after labelling</button>
          </div>
        </div>

        {/* Value Map summary block */}
        <ValueMapSummary />

        {/* Section heading */}
        <h2 style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          fontWeight: 500,
          color: tokens.textMuted,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          margin: '32px 0 14px 0',
        }}>By category</h2>

        {/* Single-intent card: Rent */}
        <SingleIntentGap
          category="Rent"
          monthly={1200}
          shareOfSpend={33}
          quadrant="foundation"
          verdict="What you said matches what you do."
        />

        {/* Multi-intent card: Eating Out (the showcase) */}
        <MultiIntentGap view={view} />

        {/* Coverage gap card */}
        <CoverageGap
          category="Transport"
          monthly={184}
          shareOfSpend={6}
        />

        {/* Footnote */}
        <div style={{
          marginTop: '40px',
          paddingTop: '16px',
          borderTop: `1px solid ${tokens.border}`,
          fontSize: '11px',
          color: tokens.textDim,
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: '0.05em',
          textAlign: 'center',
        }}>
          prototype · the gap, multi-intent render · v2.2
        </div>
      </div>
    </div>
  );
}

// ── Value Map summary header ─────────────────────────────────────
function ValueMapSummary() {
  return (
    <div style={{
      background: tokens.surface,
      border: `1px solid ${tokens.border}`,
      borderRadius: '8px',
      padding: '16px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '14px',
      }}>
        <div style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: '17px',
          color: tokens.textPrimary,
        }}>Your Value Map</div>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '10px',
          color: tokens.textMuted,
          letterSpacing: '0.05em',
        }}>baseline · 124d ago</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <SummaryRow quadrant="foundation" count={4} items="Rent · Groceries · Gym · Utilities" />
        <SummaryRow quadrant="investment" count={1} items="Dinner out with friends" />
        <SummaryRow quadrant="leak"       count={1} items="Coffee on the way to work" />
        <SummaryRow quadrant="burden"     count={1} items="Takeaway" />
        <SummaryRow quadrant="unsure"     count={3} items="Clothes · Streaming · Public transport" />
      </div>

      <div style={{
        marginTop: '14px',
        paddingTop: '12px',
        borderTop: `1px solid ${tokens.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '11px',
        color: tokens.textMuted,
        letterSpacing: '0.04em',
      }}>
        <span>10 classifications · 60% spend covered</span>
        <button style={{
          background: 'transparent',
          border: 'none',
          color: tokens.accent,
          fontSize: '11px',
          fontFamily: '"JetBrains Mono", monospace',
          cursor: 'pointer',
          padding: 0,
          letterSpacing: '0.04em',
        }}>retake →</button>
      </div>
    </div>
  );
}

function SummaryRow({ quadrant, count, items }) {
  const colour = QUADRANT_COLOURS[quadrant];
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: '110px',
      }}>
        <div style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: colour,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: '12px',
          color: tokens.textPrimary,
          fontWeight: 500,
        }}>{QUADRANT_LABELS[quadrant]}</span>
        <span style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          color: tokens.textMuted,
        }}>({count})</span>
      </div>
      <span style={{
        fontSize: '12px',
        color: tokens.textSecondary,
        flex: 1,
      }}>{items}</span>
    </div>
  );
}

// ── Single-intent gap card ───────────────────────────────────────
function SingleIntentGap({ category, monthly, shareOfSpend, quadrant, verdict }) {
  return (
    <div style={{
      background: tokens.surface,
      border: `1px solid ${tokens.border}`,
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '14px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '10px',
      }}>
        <div style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: '20px',
          color: tokens.textPrimary,
        }}>{category}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '15px',
            color: tokens.textPrimary,
            fontVariantNumeric: 'tabular-nums',
          }}>€{monthly}/mo</div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px',
            color: tokens.textMuted,
            letterSpacing: '0.03em',
          }}>{shareOfSpend}% of spend</div>
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '10px',
      }}>
        <div style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: QUADRANT_COLOURS[quadrant],
        }} />
        <span style={{
          fontSize: '12px',
          color: QUADRANT_COLOURS[quadrant],
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}>{QUADRANT_LABELS[quadrant]}</span>
      </div>

      <p style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: '16px',
        fontStyle: 'italic',
        color: tokens.textSecondary,
        margin: 0,
        lineHeight: 1.4,
      }}>{verdict}</p>
    </div>
  );
}

// ── Multi-intent gap card (the showcase) ─────────────────────────
function MultiIntentGap({ view }) {
  const monthly = 268;
  const shareOfSpend = 11;
  const totalForSlices = 268;

  const slices = [
    {
      id: 'weekday_late',
      label: 'Weekday late',
      total: 127,
      share: 47,
      merchants: ['Glovo', 'Burger King', 'KFC'],
    },
    {
      id: 'weekday_midday',
      label: 'Weekday midday',
      total: 87,
      share: 32,
      merchants: ['Pret', 'Tesco Meal Deal', "McDonald's"],
    },
    {
      id: 'weekend_evening',
      label: 'Weekend evening',
      total: 54,
      share: 20,
      merchants: ['La Tagliatella', 'The Sutton', 'El Tigre'],
    },
  ];

  return (
    <div style={{
      background: tokens.surface,
      border: `1px solid ${tokens.border}`,
      borderRadius: '8px',
      padding: '18px',
      marginBottom: '14px',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '14px',
      }}>
        <div style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: '20px',
          color: tokens.textPrimary,
        }}>Eating out</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '15px',
            color: tokens.textPrimary,
            fontVariantNumeric: 'tabular-nums',
          }}>€{monthly}/mo</div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px',
            color: tokens.textMuted,
            letterSpacing: '0.03em',
          }}>{shareOfSpend}% of spend</div>
        </div>
      </div>

      {/* What you said */}
      <SectionLabel>What you said</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
        <IntentRow card="Dinner out with friends" quadrant="investment" />
        <IntentRow card="Takeaway"                quadrant="burden" />
      </div>

      {view === 'initial' ? (
        <>
          {/* Where the money moved */}
          <SectionLabel>Where the money moved</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
            {slices.map(slice => (
              <SliceBar key={slice.id} slice={slice} />
            ))}
          </div>

          {/* Honest framing */}
          <div style={{
            padding: '12px 14px',
            background: tokens.surfaceDeeper,
            border: `1px solid ${tokens.border}`,
            borderLeft: `2px solid ${tokens.textMuted}`,
            borderRadius: '4px',
            marginBottom: '14px',
          }}>
            <p style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: 'italic',
              fontSize: '15px',
              color: tokens.textSecondary,
              margin: 0,
              lineHeight: 1.45,
            }}>
              You said two different things about eating out. The data can show
              the category and the time, but not which of these were with friends,
              which were takeaway, which were neither. The pattern's yours to read.
            </p>
          </div>

          {/* CTA — links to chat */}
          <button
            onClick={() => alert('Would open chat with C. and trigger label_transactions tool on a sample of these.')}
            style={{
              width: '100%',
              padding: '13px 14px',
              background: 'transparent',
              color: tokens.accent,
              border: `1px solid ${tokens.accent}`,
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: '"Instrument Sans", system-ui, sans-serif',
              cursor: 'pointer',
              transition: 'all 180ms ease',
              letterSpacing: '0.02em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = tokens.accent;
              e.currentTarget.style.color = '#1a1612';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = tokens.accent;
            }}
          >
            Walk me through these  →
          </button>
        </>
      ) : (
        <AfterLabellingState slices={slices} />
      )}
    </div>
  );
}

// ── After labelling state — the gap, now claimable ───────────────
function AfterLabellingState({ slices }) {
  const learned = [
    { merchant: 'Glovo',          reads: 'leak',       count: 5 },
    { merchant: 'La Tagliatella', reads: 'investment', count: 2 },
    { merchant: 'The Sutton',     reads: 'investment', count: 3 },
    { merchant: 'Pret',           reads: 'foundation', count: 8 },
    { merchant: 'Burger King',    reads: 'leak',       count: 2 },
  ];

  return (
    <>
      <SectionLabel>What you confirmed</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
        {learned.map((l, idx) => (
          <div key={idx} style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: idx === learned.length - 1 ? 0 : '6px',
            borderBottom: idx === learned.length - 1 ? 'none' : `1px solid ${tokens.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: QUADRANT_COLOURS[l.reads],
              }} />
              <span style={{
                fontFamily: '"Instrument Sans", system-ui, sans-serif',
                fontSize: '13px',
                color: tokens.textPrimary,
                fontWeight: 500,
              }}>{l.merchant}</span>
              <span style={{
                fontSize: '12px',
                color: QUADRANT_COLOURS[l.reads],
              }}>{QUADRANT_LABELS[l.reads]}</span>
            </div>
            <span style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '10px',
              color: tokens.textMuted,
              letterSpacing: '0.04em',
            }}>{l.count} visits</span>
          </div>
        ))}
      </div>

      <SectionLabel>The gap, now claimable</SectionLabel>
      <div style={{
        padding: '14px',
        background: tokens.surfaceDeeper,
        border: `1px solid ${tokens.border}`,
        borderLeft: `2px solid ${tokens.accent}`,
        borderRadius: '4px',
        marginBottom: '14px',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
          <GapLine label="Investment running" amount={87} colour={QUADRANT_COLOURS.investment} />
          <GapLine label="Leak / Burden running" amount={141} colour={QUADRANT_COLOURS.leak} />
          <GapLine label="Foundation (work lunches)" amount={40} colour={QUADRANT_COLOURS.foundation} />
        </div>
        <p style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontStyle: 'italic',
          fontSize: '15px',
          color: tokens.textSecondary,
          margin: '8px 0 0 0',
          lineHeight: 1.45,
          paddingTop: '10px',
          borderTop: `1px solid ${tokens.border}`,
        }}>
          The Investment side is happening, just smaller than your stated value
          implied. The Leak side is the bigger force — €141/mo on the kind of
          eating out you said drains you.
        </p>
      </div>

      <button
        onClick={() => alert('Would open chat with C. to discuss next steps (likely propose_experiment on Glovo).')}
        style={{
          width: '100%',
          padding: '13px 14px',
          background: 'transparent',
          color: tokens.accent,
          border: `1px solid ${tokens.accent}`,
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 500,
          fontFamily: '"Instrument Sans", system-ui, sans-serif',
          cursor: 'pointer',
          transition: 'all 180ms ease',
          letterSpacing: '0.02em',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = tokens.accent;
          e.currentTarget.style.color = '#1a1612';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = tokens.accent;
        }}
      >
        Talk through what to do about the leak  →
      </button>
    </>
  );
}

function GapLine({ label, amount, colour }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: colour,
        }} />
        <span style={{
          fontSize: '13px',
          color: tokens.textPrimary,
        }}>{label}</span>
      </div>
      <span style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '14px',
        color: tokens.textPrimary,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 500,
      }}>€{amount}/mo</span>
    </div>
  );
}

// ── Helper sub-components ────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: '10px',
      color: tokens.textMuted,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      marginBottom: '10px',
    }}>{children}</div>
  );
}

function IntentRow({ card, quadrant }) {
  const colour = QUADRANT_COLOURS[quadrant];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 10px',
      background: tokens.surfaceDeeper,
      border: `1px solid ${tokens.border}`,
      borderRadius: '5px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: colour,
        }} />
        <span style={{
          fontFamily: '"Instrument Sans", system-ui, sans-serif',
          fontSize: '13px',
          color: tokens.textPrimary,
        }}>{card}</span>
      </div>
      <span style={{
        fontSize: '12px',
        color: colour,
        fontWeight: 500,
        letterSpacing: '0.02em',
      }}>{QUADRANT_LABELS[quadrant]}</span>
    </div>
  );
}

function SliceBar({ slice }) {
  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '6px',
      }}>
        <span style={{
          fontFamily: '"Instrument Sans", system-ui, sans-serif',
          fontSize: '13px',
          color: tokens.textPrimary,
          fontWeight: 500,
        }}>{slice.label}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '13px',
            color: tokens.textPrimary,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 500,
          }}>€{slice.total}</span>
          <span style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px',
            color: tokens.textMuted,
            fontVariantNumeric: 'tabular-nums',
          }}>{slice.share}%</span>
        </div>
      </div>

      {/* The bar */}
      <div style={{
        height: '4px',
        background: tokens.surfaceDeeper,
        borderRadius: '2px',
        overflow: 'hidden',
        marginBottom: '6px',
      }}>
        <div style={{
          width: `${slice.share}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${tokens.accent}aa, ${tokens.accent})`,
          borderRadius: '2px',
          transition: 'width 600ms ease',
        }} />
      </div>

      {/* Merchant list */}
      <div style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: '11px',
        color: tokens.textMuted,
        letterSpacing: '0.02em',
      }}>{slice.merchants.join(' · ')}</div>
    </div>
  );
}

// ── Coverage gap card ────────────────────────────────────────────
function CoverageGap({ category, monthly, shareOfSpend }) {
  return (
    <div style={{
      background: tokens.surface,
      border: `1px dashed ${tokens.border}`,
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '14px',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '12px',
      }}>
        <div style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: '20px',
          color: tokens.textPrimary,
        }}>{category}</div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '15px',
            color: tokens.textPrimary,
            fontVariantNumeric: 'tabular-nums',
          }}>€{monthly}/mo</div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px',
            color: tokens.textMuted,
            letterSpacing: '0.03em',
          }}>{shareOfSpend}% of spend</div>
        </div>
      </div>

      <p style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontStyle: 'italic',
        fontSize: '15px',
        color: tokens.textMuted,
        margin: '0 0 12px 0',
        lineHeight: 1.4,
      }}>
        Not in your Value Map yet. The money's moving here every month with
        no stated take from you.
      </p>

      <button
        onClick={() => alert('Would open chat with C. to ask what this category means to the user.')}
        style={{
          padding: '8px 12px',
          background: 'transparent',
          color: tokens.textSecondary,
          border: `1px solid ${tokens.border}`,
          borderRadius: '4px',
          fontSize: '12px',
          fontFamily: '"Instrument Sans", system-ui, sans-serif',
          cursor: 'pointer',
          transition: 'all 180ms ease',
          letterSpacing: '0.02em',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = tokens.accent;
          e.currentTarget.style.color = tokens.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = tokens.border;
          e.currentTarget.style.color = tokens.textSecondary;
        }}
      >
        Tell C. what this is to you  →
      </button>
    </div>
  );
}
