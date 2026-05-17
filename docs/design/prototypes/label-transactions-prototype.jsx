import { useState, useEffect } from 'react';

// ── Design tokens ────────────────────────────────────────────────
const tokens = {
  bg: '#1a1612',
  surface: '#221d17',
  surfaceLifted: '#2c2620',
  border: '#3a342c',
  borderHover: '#4d4538',
  textPrimary: '#f0e9dd',
  textSecondary: '#b8ad99',
  textMuted: '#7a7163',
  textDim: '#574f44',
  accent: '#E8A84C',
};

const QUADRANTS = [
  { id: 'foundation', label: 'Foundation', color: '#7A9E7E', desc: 'Essential' },
  { id: 'investment', label: 'Investment', color: '#D4A24C', desc: 'Worth it' },
  { id: 'leak',       label: 'Leak',       color: '#B8584F', desc: 'Drains me' },
  { id: 'burden',     label: 'Burden',     color: '#8A7468', desc: 'Heavy, stuck' },
  { id: 'unsure',     label: 'Unsure',     color: '#605749', desc: 'On autopilot' },
];

const TRANSACTIONS = [
  { id: 'tx-1', date: 'Fri 8 Mar',  merchant: 'Glovo',          amount: 18.50, time: '23:14', hint: 'Late delivery, solo' },
  { id: 'tx-2', date: 'Fri 8 Mar',  merchant: 'The Sutton',     amount: 34.00, time: '21:32', hint: 'Bar in Salamanca' },
  { id: 'tx-3', date: 'Fri 1 Mar',  merchant: 'La Tagliatella', amount: 52.00, time: '20:48', hint: 'Sit-down dinner' },
  { id: 'tx-4', date: 'Fri 1 Mar',  merchant: '100 Montaditos', amount: 12.50, time: '13:22', hint: 'Lunch' },
  { id: 'tx-5', date: 'Fri 23 Feb', merchant: 'Glovo',          amount: 22.00, time: '23:51', hint: 'Late delivery' },
];

// ── Component ────────────────────────────────────────────────────
export default function LabelTransactionsPrototype() {
  const [labels, setLabels] = useState({});
  const [phase, setPhase] = useState('labelling'); // 'labelling' | 'submitting' | 'response'

  useEffect(() => {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);

  const labelCount = Object.keys(labels).length;
  const allLabelled = labelCount === TRANSACTIONS.length;

  const handleLabel = (txId, quadrantId) => {
    setLabels(prev => ({ ...prev, [txId]: quadrantId }));
  };

  const handleSubmit = () => {
    setPhase('submitting');
    setTimeout(() => setPhase('response'), 1400);
  };

  const handleReset = () => {
    setLabels({});
    setPhase('labelling');
  };

  // ── Response composition (contextual to labels) ────────────────
  const responseData = (() => {
    if (phase !== 'response') return null;
    const counts = { foundation: 0, investment: 0, leak: 0, burden: 0 };
    Object.values(labels).forEach(q => { counts[q]++; });
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

    const glovoLabels = TRANSACTIONS
      .filter(t => t.merchant === 'Glovo')
      .map(t => labels[t.id]);
    const glovoIsLeak = glovoLabels.every(l => l === 'leak');
    const sitDownIsInvestment = labels['tx-3'] === 'investment' || labels['tx-2'] === 'investment';

    return { counts, dominant, glovoIsLeak, sitDownIsInvestment };
  })();

  return (
    <div style={{
      minHeight: '100vh',
      background: tokens.bg,
      fontFamily: '"Instrument Sans", system-ui, sans-serif',
      color: tokens.textPrimary,
      padding: '20px 0',
    }}>
      <div style={{
        maxWidth: '420px',
        margin: '0 auto',
        padding: '0 20px',
      }}>
        {/* Top bar — context for the prototype */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '24px',
          paddingBottom: '12px',
          borderBottom: `1px solid ${tokens.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#7A9E7E',
              boxShadow: '0 0 8px #7A9E7E',
            }} />
            <span style={{
              fontSize: '13px',
              color: tokens.textSecondary,
              letterSpacing: '0.02em',
            }}>your CFO</span>
          </div>
          <button
            onClick={handleReset}
            style={{
              background: 'transparent',
              border: `1px solid ${tokens.border}`,
              color: tokens.textMuted,
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '11px',
              cursor: 'pointer',
              fontFamily: '"JetBrains Mono", monospace',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >reset</button>
        </div>

        {/* CFO opening message */}
        <div style={{ marginBottom: '20px' }}>
          <p style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: '20px',
            lineHeight: '1.45',
            color: tokens.textPrimary,
            margin: 0,
          }}>
            Fridays are running 2.3x heavier than your other days — €1,634 across
            12 transactions. Most of that is eating out, and your Value Map said
            two different things about it: <em>dinner with friends</em> is an
            Investment, but <em>takeaway</em> is a Burden. I can see the category;
            I can't tell from the data which of these is which.
          </p>
          <p style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: '20px',
            lineHeight: '1.45',
            color: tokens.textPrimary,
            margin: '14px 0 6px 0',
          }}>
            Walk me through these — what was each one, in your read?
          </p>
          <p style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: '15px',
            color: tokens.textMuted,
            fontStyle: 'italic',
            margin: '8px 0 0 0',
            letterSpacing: '0.02em',
          }}>— C.</p>
        </div>

        {/* Labelling block */}
        <div style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '16px',
          opacity: phase === 'submitting' ? 0.5 : 1,
          transition: 'opacity 300ms ease',
        }}>
          {/* Block header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '14px',
            paddingBottom: '12px',
            borderBottom: `1px solid ${tokens.border}`,
          }}>
            <span style={{
              fontSize: '11px',
              color: tokens.textMuted,
              fontFamily: '"JetBrains Mono", monospace',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>Friday eating-out · last 3 weeks</span>
            <span style={{
              fontSize: '12px',
              color: allLabelled ? tokens.accent : tokens.textMuted,
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 500,
              transition: 'color 200ms ease',
            }}>{labelCount}/{TRANSACTIONS.length}</span>
          </div>

          {/* Transaction rows */}
          {TRANSACTIONS.map((tx, idx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              isLast={idx === TRANSACTIONS.length - 1}
              currentLabel={labels[tx.id]}
              onLabel={(q) => handleLabel(tx.id, q)}
              disabled={phase !== 'labelling'}
            />
          ))}
        </div>

        {/* Submit button */}
        {phase === 'labelling' && (
          <button
            onClick={handleSubmit}
            disabled={!allLabelled}
            style={{
              width: '100%',
              padding: '14px',
              background: allLabelled ? tokens.accent : tokens.surface,
              color: allLabelled ? '#1a1612' : tokens.textMuted,
              border: `1px solid ${allLabelled ? tokens.accent : tokens.border}`,
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: '"Instrument Sans", system-ui, sans-serif',
              letterSpacing: '0.02em',
              cursor: allLabelled ? 'pointer' : 'not-allowed',
              transition: 'all 200ms ease',
              marginBottom: '20px',
            }}
          >
            {allLabelled ? 'Send to C.' : `Label ${TRANSACTIONS.length - labelCount} more`}
          </button>
        )}

        {phase === 'submitting' && (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: tokens.textMuted,
            fontSize: '13px',
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: '0.05em',
          }}>
            <span style={{ opacity: 0.6 }}>C. is reading...</span>
          </div>
        )}

        {/* Response — the visibility moment */}
        {phase === 'response' && responseData && (
          <div style={{
            marginTop: '24px',
            animation: 'fadeInUp 600ms ease forwards',
          }}>
            <p style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: '20px',
              lineHeight: '1.45',
              color: tokens.textPrimary,
              margin: 0,
            }}>
              {responseData.glovoIsLeak && responseData.sitDownIsInvestment ? (
                <>So that's the pattern: <em>Glovo late at night is the leak</em>, the
                sit-down Fridays at Sutton and Tagliatella are the investment you'd
                stand by. They're different categories pretending to be the same one.</>
              ) : responseData.dominant === 'leak' ? (
                <>Most of these landed in Leak for you — including the sit-down ones.
                That's not what your Value Map predicted. Worth pulling on: is Friday
                eating-out heavier than you want it to be overall, or are specific
                nights doing the damage?</>
              ) : responseData.dominant === 'investment' ? (
                <>You stand by most of these as investment — that's a clear answer.
                It also means Fridays at €1,634 are inside your stated values, which
                changes the question. The work isn't to cut these; it's to make sure
                they don't crowd out the debt-payoff goal.</>
              ) : (
                <>That's a mixed read — some leak, some investment, some between.
                Useful: it tells me Friday eating-out isn't one thing to you, it's
                three or four. I'll treat them differently from now on.</>
              )}
            </p>

            {/* Learning visibility metric */}
            <div style={{
              marginTop: '20px',
              padding: '14px 16px',
              background: tokens.surfaceLifted,
              border: `1px solid ${tokens.border}`,
              borderLeft: `2px solid ${tokens.accent}`,
              borderRadius: '4px',
            }}>
              <div style={{
                fontSize: '11px',
                color: tokens.textMuted,
                fontFamily: '"JetBrains Mono", monospace',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '6px',
              }}>What I know now</div>
              <div style={{
                fontFamily: '"Instrument Sans", system-ui, sans-serif',
                fontSize: '14px',
                color: tokens.textPrimary,
                lineHeight: '1.5',
              }}>
                <LearningSummary labels={labels} />
              </div>
            </div>

            <p style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontSize: '15px',
              color: tokens.textMuted,
              fontStyle: 'italic',
              margin: '16px 0 24px 0',
              letterSpacing: '0.02em',
            }}>— C.</p>

            {/* Follow-up chips */}
            <FollowUpChips responseData={responseData} />
          </div>
        )}

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
          prototype · label_transactions tool render · v2.2
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Transaction row ──────────────────────────────────────────────
function TransactionRow({ tx, isLast, currentLabel, onLabel, disabled }) {
  return (
    <div style={{
      paddingBottom: isLast ? 0 : '14px',
      marginBottom: isLast ? 0 : '14px',
      borderBottom: isLast ? 'none' : `1px solid ${tokens.border}`,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '8px',
      }}>
        <div>
          <div style={{
            fontFamily: '"Instrument Sans", system-ui, sans-serif',
            fontSize: '15px',
            color: tokens.textPrimary,
            fontWeight: 500,
          }}>{tx.merchant}</div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '11px',
            color: tokens.textMuted,
            marginTop: '2px',
            letterSpacing: '0.04em',
          }}>{tx.date} · {tx.time}</div>
        </div>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '15px',
          color: tokens.textSecondary,
          fontVariantNumeric: 'tabular-nums',
        }}>−€{tx.amount.toFixed(2)}</div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '6px',
        marginTop: '10px',
      }}>
        {QUADRANTS.map(q => {
          const selected = currentLabel === q.id;
          return (
            <button
              key={q.id}
              onClick={() => !disabled && onLabel(q.id)}
              disabled={disabled}
              style={{
                padding: '9px 4px',
                background: selected ? q.color : 'transparent',
                color: selected ? '#1a1612' : tokens.textSecondary,
                border: `1px solid ${selected ? q.color : tokens.border}`,
                borderRadius: '6px',
                fontSize: '11px',
                fontFamily: '"Instrument Sans", system-ui, sans-serif',
                fontWeight: selected ? 600 : 400,
                cursor: disabled ? 'default' : 'pointer',
                transition: 'all 180ms ease',
                letterSpacing: '0.02em',
                minHeight: '32px',
              }}
              onMouseEnter={(e) => {
                if (!selected && !disabled) {
                  e.currentTarget.style.borderColor = q.color;
                  e.currentTarget.style.color = q.color;
                }
              }}
              onMouseLeave={(e) => {
                if (!selected && !disabled) {
                  e.currentTarget.style.borderColor = tokens.border;
                  e.currentTarget.style.color = tokens.textSecondary;
                }
              }}
            >
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Learning summary ─────────────────────────────────────────────
function LearningSummary({ labels }) {
  const byMerchant = {};
  TRANSACTIONS.forEach(t => {
    if (!labels[t.id]) return;
    if (!byMerchant[t.merchant]) byMerchant[t.merchant] = [];
    byMerchant[t.merchant].push(labels[t.id]);
  });

  const learned = [];
  Object.entries(byMerchant).forEach(([merchant, quads]) => {
    const unique = [...new Set(quads)];
    if (unique.length === 1) {
      const q = QUADRANTS.find(x => x.id === unique[0]);
      learned.push({ merchant, quadrant: q, multiple: quads.length > 1 });
    }
  });

  // Mock-extrapolated future impact
  const labelledMerchants = Object.keys(byMerchant);
  const estimatedFutureImpact = labelledMerchants.length * 6 + 4;

  return (
    <div>
      {learned.length > 0 ? (
        <>
          {learned.map((l, idx) => (
            <div key={idx} style={{ marginBottom: '4px' }}>
              <span style={{ color: tokens.textPrimary }}>{l.merchant}</span>
              <span style={{ color: tokens.textMuted }}> reads as </span>
              <span style={{ color: l.quadrant.color, fontWeight: 500 }}>
                {l.quadrant.label}
              </span>
              <span style={{ color: tokens.textMuted, fontSize: '12px' }}>
                {l.multiple ? ` (across ${TRANSACTIONS.filter(t => t.merchant === l.merchant).length} visits)` : ''}
              </span>
            </div>
          ))}
          <div style={{
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: `1px dashed ${tokens.border}`,
            color: tokens.textSecondary,
            fontSize: '13px',
          }}>
            <span style={{ color: tokens.accent, fontFamily: '"JetBrains Mono", monospace', fontWeight: 500 }}>
              ~{estimatedFutureImpact}
            </span>
            <span style={{ color: tokens.textMuted }}>
              {' '}future transactions classified automatically
            </span>
          </div>
        </>
      ) : (
        <div style={{ color: tokens.textMuted, fontStyle: 'italic' }}>
          Your reads are too mixed for me to assume the same answer next time.
          I'll keep asking on these merchants until a pattern is clear.
        </div>
      )}
    </div>
  );
}

// ── Follow-up chips ──────────────────────────────────────────────
function FollowUpChips({ responseData }) {
  const chips = [];

  if (responseData.glovoIsLeak) {
    chips.push('Try no Glovo for 30 days');
    chips.push('Show me my other late-night spend');
  } else if (responseData.dominant === 'leak') {
    chips.push('Cap Friday eating-out at €50');
    chips.push('What about the rest of the week?');
  } else if (responseData.dominant === 'investment') {
    chips.push('How do these sit against the debt goal?');
    chips.push('Walk through last weekend');
  } else {
    chips.push('Walk through last weekend');
    chips.push('Show me Friday vs other days');
  }
  chips.push('Show me all 12 Friday transactions');

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      {chips.map((chip, idx) => (
        <button
          key={idx}
          style={{
            background: tokens.surface,
            border: `1px solid ${tokens.border}`,
            color: tokens.textPrimary,
            padding: '11px 14px',
            borderRadius: '6px',
            fontSize: '14px',
            fontFamily: '"Instrument Sans", system-ui, sans-serif',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'all 180ms ease',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = tokens.accent;
            e.currentTarget.style.background = tokens.surfaceLifted;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = tokens.border;
            e.currentTarget.style.background = tokens.surface;
          }}
        >
          {chip}
        </button>
      ))}
    </div>
  );
}
