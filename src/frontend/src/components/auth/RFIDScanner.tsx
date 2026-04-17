import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { useSystemStore } from '../../stores/systemStore';
import { authApi } from '../../services/api';
import { wsClient } from '../../services/websocket';

interface RFIDScannerProps {
  onSuccess?: () => void;
  onError?: (msg: string) => void;
}

type ScanState = 'waiting' | 'detected' | 'success' | 'error';

// Colors sourced from CSS variables defined in tokens.css
const RING_COLOR: Record<ScanState, string> = {
  success:  'var(--signal-ok)',
  error:    'var(--signal-alert)',
  detected: 'var(--signal-warn)',
  waiting:  'var(--accent)',
};

export default function RFIDScanner({ onSuccess, onError }: RFIDScannerProps) {
  const [scanState, setScanState] = useState<ScanState>('waiting');
  const [message, setMessage] = useState('ПРИКЛАДІТЬ RFID КАРТКУ');
  const { setUser } = useAuthStore();
  const { setAuthenticated } = useSystemStore();
  const processingRef = useRef(false);

  useEffect(() => {
    // Subscribe to sensor channel for RFID new_read events
    const unsub = wsClient.on('sensor', async (msg) => {
      if (msg.type !== 'snapshot') return;
      const snapshot = (msg.data as { snapshot?: { rfid?: { uid?: string; new_read?: boolean } } }).snapshot;
      if (!snapshot?.rfid?.new_read || !snapshot.rfid.uid) return;
      if (processingRef.current) return;

      processingRef.current = true;
      setScanState('detected');
      setMessage('КАРТКУ ВИЯВЛЕНО...');

      try {
        const res = await authApi.loginRfid(snapshot.rfid.uid);
        setUser(res.user, res.token, res.expires_at);
        setAuthenticated(true);
        setScanState('success');
        setMessage(`Ласкаво просимо, ${res.user.username}!`);
        onSuccess?.();
      } catch {
        setScanState('error');
        setMessage('НЕВІДОМА КАРТКА');
        onError?.('RFID не авторизовано');
        setTimeout(() => {
          setScanState('waiting');
          setMessage('ПРИКЛАДІТЬ RFID КАРТКУ');
          processingRef.current = false;
        }, 2000);
      }
    });

    return () => {
      unsub();
      processingRef.current = false;
    };
  }, [setUser, setAuthenticated, onSuccess, onError]);

  const ringColor = RING_COLOR[scanState];

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Pulsing ring */}
      <div className="relative w-24 h-24 flex items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full border-2"
          style={{ borderColor: ringColor }}
          animate={
            scanState === 'waiting'
              ? { scale: [1, 1.15, 1], opacity: [0.6, 1, 0.6] }
              : { scale: 1, opacity: 1 }
          }
          transition={
            scanState === 'waiting'
              ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.2 }
          }
        />
        <motion.div
          className="absolute rounded-full border"
          style={{
            inset: '12px',
            borderColor: ringColor,
          }}
          animate={
            scanState === 'waiting'
              ? { scale: [1, 1.08, 1], opacity: [0.4, 0.8, 0.4] }
              : { scale: 1, opacity: 0.8 }
          }
          transition={
            scanState === 'waiting'
              ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }
              : { duration: 0.2 }
          }
        />
        <span className="text-3xl" style={{ color: ringColor }}>
          {scanState === 'success' ? '✓' : scanState === 'error' ? '✕' : '⊙'}
        </span>
      </div>

      <motion.span
        key={message}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-xs tracking-widest font-mono"
        style={{ color: ringColor }}
      >
        {message}
      </motion.span>
    </div>
  );
}
