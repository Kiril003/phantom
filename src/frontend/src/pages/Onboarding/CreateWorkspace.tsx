import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Terminal, ArrowRight, Loader2 } from 'lucide-react';

export function CreateWorkspace() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate slug from name
  useEffect(() => {
    const generated = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
    setSlug(generated);
  }, [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setError('Workspace name and slug are required.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/v1/tenant/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, slug }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to create workspace');
      }

      // On success, redirect to dashboard (which is root '/')
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full min-h-screen flex items-center justify-center bg-[var(--surface-void)] relative overflow-hidden">
      {/* Background ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[var(--accent)] rounded-full blur-[120px] opacity-10 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-lg p-8 rounded-2xl border border-[var(--border-muted)] bg-[var(--surface-raised)]/30 backdrop-blur-xl shadow-2xl flex flex-col gap-6"
      >
        <div className="flex flex-col items-center text-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center border border-[var(--accent)]/20">
            <Terminal className="w-8 h-8 text-[var(--accent)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ink-base)] font-mono">
              Initialize Workspace
            </h1>
            <p className="text-sm text-[var(--ink-muted)] mt-2">
              Create a new operational environment for your agents.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="workspace-name" className="text-sm font-medium text-[var(--ink-base)]">
              Workspace Name
            </label>
            <input
              id="workspace-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Phantom Alpha"
              className="w-full px-4 py-3 rounded-lg bg-[var(--surface-base)] border border-[var(--border-muted)] text-[var(--ink-base)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all"
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="workspace-slug" className="text-sm font-medium text-[var(--ink-base)]">
              URL Slug
            </label>
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[var(--surface-base)]/50 border border-[var(--border-muted)]/50 text-[var(--ink-muted)]">
              <span className="opacity-50">phantom.os/</span>
              <input
                id="workspace-slug"
                type="text"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[var(--ink-base)] focus:ring-0 p-0"
                placeholder="phantom-alpha"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="text-sm text-red-400 bg-red-400/10 px-4 py-3 rounded-lg border border-red-400/20"
            >
              {error}
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !name.trim() || !slug.trim()}
            className="mt-4 w-full flex items-center justify-center gap-2 bg-[var(--accent)] text-[var(--surface-void)] py-3 px-6 rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Initializing...</span>
              </>
            ) : (
              <>
                <span>Create Workspace</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

export default CreateWorkspace;
