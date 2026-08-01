import { useState } from 'react';
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react';

interface ApiKey {
  id: string;
  name: string;
  keyStr: string;
  created: string;
}

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([
    { id: '1', name: 'Production', keyStr: 'pk_live_1234567890abcdef', created: '2023-01-15' },
    { id: '2', name: 'Development', keyStr: 'pk_test_abcdef1234567890', created: '2023-06-20' },
  ]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const generateKey = () => {
    const newKey: ApiKey = {
      id: Math.random().toString(36).substr(2, 9),
      name: `New Key ${keys.length + 1}`,
      keyStr: `pk_test_${Math.random().toString(36).substr(2, 16)}`,
      created: new Date().toISOString().split('T')[0],
    };
    setKeys([newKey, ...keys]);
  };

  const deleteKey = (id: string) => {
    setKeys(keys.filter(k => k.id !== id));
  };

  const copyKey = (id: string, keyStr: string) => {
    navigator.clipboard.writeText(keyStr);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="glass" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                color: 'white',
                boxShadow: '0 3px 10px rgba(99, 102, 241, 0.2)',
              }}
            >
              <Key size={18} strokeWidth={1.75} />
            </div>
            <div>
              <div className="micro-label" style={{ fontSize: 9 }}>DEVELOPERS</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-primary)' }}>API Keys</div>
            </div>
          </div>
          <button
            onClick={generateKey}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 12px',
              background: 'var(--ink-primary)',
              color: 'var(--panel-bg)',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              border: 'none',
            }}
          >
            <Plus size={14} />
            Generate Key
          </button>
        </div>

        <div style={{ fontSize: 13, color: 'var(--ink-muted)', marginBottom: 24 }}>
          Manage your API keys. Do not share your keys or commit them to version control.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {keys.map((k) => (
            <div
              key={k.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-primary)', marginBottom: 4 }}>
                  {k.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink-muted)' }}>
                    {k.keyStr.substring(0, 8)}••••••••••••
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                    Created on {k.created}
                  </span>
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  onClick={() => copyKey(k.id, k.keyStr)}
                  style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: copiedId === k.id ? 'var(--signal-good, #10b981)' : 'var(--ink-muted)',
                    cursor: 'pointer',
                    borderRadius: 4,
                  }}
                  title="Copy Key"
                >
                  {copiedId === k.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button
                  onClick={() => deleteKey(k.id)}
                  style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--signal-warn, #ef4444)',
                    cursor: 'pointer',
                    borderRadius: 4,
                  }}
                  title="Delete Key"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          
          {keys.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-muted)', fontSize: 13 }}>
              No API keys found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
