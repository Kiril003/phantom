/**
 * ImageResponse — inline photos in the transcript.
 *
 * Renders every `image` attachment of a message as a rounded thumbnail
 * strip (1 image = large card, 2+ = grid). Tap opens a fullscreen
 * lightbox. Broken URLs collapse to an honest error chip instead of a
 * browser broken-image icon.
 */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ImageOff, X } from 'lucide-react';
import type { ImageAttachmentData } from '@shared/types';

function InlineImage({ img, onOpen }: { img: ImageAttachmentData; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-3"
        style={{
          minHeight: 44,
          background: 'rgba(0,0,0,0.05)',
          color: 'var(--ink-muted)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        <ImageOff size={14} strokeWidth={1.75} />
        <span className="truncate">{img.name ?? 'зображення недоступне'}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block rounded-xl overflow-hidden"
      style={{ border: '1px solid rgba(0,0,0,0.08)', padding: 0, background: 'rgba(0,0,0,0.03)' }}
      aria-label={`Відкрити ${img.name ?? 'зображення'}`}
    >
      <img
        src={img.url}
        alt={img.caption ?? img.name ?? ''}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ display: 'block', width: '100%', maxHeight: 260, objectFit: 'cover' }}
      />
    </button>
  );
}

export function ImageResponse({ images }: { images: ImageAttachmentData[] }) {
  const [open, setOpen] = useState<ImageAttachmentData | null>(null);
  if (images.length === 0) return null;

  return (
    <>
      <div
        data-testid="image-strip"
        style={
          images.length === 1
            ? { maxWidth: 420 }
            : {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                gap: 8,
              }
        }
      >
        {images.map((img, i) => (
          <div key={`${img.url}-${i}`} className="flex flex-col gap-1">
            <InlineImage img={img} onOpen={() => setOpen(img)} />
            {img.caption && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--ink-muted)' }}>
                {img.caption}
              </span>
            )}
          </div>
        ))}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[210] flex flex-col items-center justify-center"
            style={{ background: 'rgba(10,10,10,0.92)' }}
            onClick={() => setOpen(null)}
            data-testid="image-lightbox"
          >
            <button
              type="button"
              aria-label="Закрити"
              className="absolute top-2 right-2 flex items-center justify-center rounded-full"
              style={{ minWidth: 44, minHeight: 44, color: 'white' }}
              onClick={() => setOpen(null)}
            >
              <X size={20} strokeWidth={1.75} />
            </button>
            <img
              src={open.url}
              alt={open.caption ?? open.name ?? ''}
              style={{ maxWidth: '94%', maxHeight: '86%', objectFit: 'contain', borderRadius: 12 }}
            />
            {(open.caption || open.name) && (
              <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 'var(--fs-sm)', marginTop: 10 }}>
                {open.caption ?? open.name}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
