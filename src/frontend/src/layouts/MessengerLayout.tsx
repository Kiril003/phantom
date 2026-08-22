import { motion } from 'framer-motion';
import { MessengerRoot } from '../components/messenger/MessengerRoot';
import { EASE_PHANTOM } from '../styles/motion';
import '../styles/messenger.css';

// Месенджер — окрема поверхня, не заміна діалогу. /chat лишається розмовою з
// PHANTOM зі сценами й голосом; сюди приходять розмови з людьми.
export default function MessengerLayout() {
  return (
    <motion.div
      className="w-full h-full min-w-[1024px] min-h-full relative overflow-hidden"
      style={{ background: '#FDFCF9' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE_PHANTOM as unknown as number[] }}
    >
      {/* Док PHANTOM висить absolute bottom-3 і накривав поле вводу: людина
          не бачила, що пише. Екран сам тримає під нього місце — 12 знизу,
          54 висота дока і 8 повітря між доком та композером. */}
      <div className="w-full h-full" style={{ paddingBottom: 74 }}>
        <MessengerRoot className="w-full h-full" />
      </div>
    </motion.div>
  );
}
