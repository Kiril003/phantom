import { useState } from 'react';
import { CreditCard, Activity } from 'lucide-react';

export function BillingTab() {
  const [tier] = useState('Pro');
  const [tokensUsed] = useState(45000);
  const maxTokens = 100000;
  
  const tokenPercent = Math.min(100, Math.round((tokensUsed / maxTokens) * 100));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Tier Info */}
      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, var(--signal-good, #10b981), #059669)',
              color: 'white',
              boxShadow: '0 3px 10px rgba(16, 185, 129, 0.2)',
            }}
          >
            <CreditCard size={18} strokeWidth={1.75} />
          </div>
          <div>
            <div className="micro-label" style={{ fontSize: 9 }}>CURRENT PLAN</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-primary)' }}>{tier} Tier</div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 16 }}>
          You are currently on the {tier} tier. Your next billing cycle begins on Aug 1st.
        </div>
        
        <button
          style={{
            width: '100%',
            height: 36,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--ink-primary)',
            color: 'var(--panel-bg)',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
          }}
          onClick={async () => {
            try {
              const res = await fetch('/api/v1/stripe/create-checkout-session?tenant_id=current', { method: 'POST' });
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
              }
            } catch (err) {
              console.error('Failed to create checkout session', err);
            }
          }}
        >
          Manage Subscription
        </button>
      </div>

      {/* Usage Bars */}
      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Activity size={16} color="var(--ink-muted)" />
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-primary)' }}>Usage</div>
        </div>
        
        {/* Tokens */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--ink-primary)', fontWeight: 600 }}>Tokens Used</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
              {tokensUsed.toLocaleString()} / {maxTokens.toLocaleString()}
            </span>
          </div>
          <div style={{ width: '100%', height: 8, background: 'rgba(0,0,0,0.1)', borderRadius: 999, overflow: 'hidden' }}>
            <div
              style={{
                width: `${tokenPercent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #f4af25, #fb923c)',
                borderRadius: 999,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
