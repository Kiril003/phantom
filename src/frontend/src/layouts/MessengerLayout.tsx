import { motion } from 'framer-motion';
import { MessengerRoot } from '../components/messenger/MessengerRoot';
import { EASE_PHANTOM } from '../styles/motion';

// Месенджер — окрема поверхня, не заміна діалогу. /chat лишається розмовою з
// PHANTOM зі сценами й голосом; сюди приходять розмови з людьми.
export default function MessengerLayout() {
  return (
    <motion.div
      className="w-full h-full min-w-[1024px] min-h-full relative overflow-hidden"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE_PHANTOM as unknown as number[] }}
    >
      <MessengerRoot className="w-full h-full" />
    </motion.div>
  );
}
