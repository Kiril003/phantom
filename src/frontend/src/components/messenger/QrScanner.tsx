import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { CameraOff, X } from 'lucide-react';

interface QrScannerProps {
  onFound: (text: string) => void;
  onCancel: () => void;
}

// Камера тут вмикається насправді: getUserMedia, кадри в canvas, jsQR по них.
// Це протилежність до того, що стояло в застосунку раніше — сітки 6×6, яку
// підписали «відскануйте камерою телефону».
export const QrScanner: React.FC<QrScannerProps> = ({ onFound, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (stopped || !video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frame = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, canvas.width, canvas.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code?.data) {
        stopped = true;
        onFound(code.data.trim());
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        frame = requestAnimationFrame(tick);
      } catch {
        // Камери немає або доступ не дали — кажемо прямо, а не крутимо порожній кадр.
        setError('Камера недоступна. Ключ можна вставити текстом.');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onFound]);

  return (
    <div className="space-y-2">
      {error ? (
        <div className="p-3 bg-[#FDF6EC] rounded-2xl border border-[#EBD9BE] flex items-start gap-2">
          <CameraOff className="w-4 h-4 text-[#B45309] mt-0.5 shrink-0" strokeWidth={1.75} />
          <span className="text-[10.5px] text-[#8C5A1A] leading-relaxed">{error}</span>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden border border-[#E6DFD3] bg-black">
          <video ref={videoRef} className="w-full max-h-[240px] object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-0 pointer-events-none border-[3px] border-[#E87A42]/60 rounded-2xl" />
        </div>
      )}
      <button
        onClick={onCancel}
        className="flex items-center gap-1.5 text-[11px] font-bold text-[#7A6A55] active:scale-95 transition-transform"
      >
        <X className="w-3.5 h-3.5" strokeWidth={1.75} />
        <span>Зупинити камеру</span>
      </button>
    </div>
  );
};

export default QrScanner;
