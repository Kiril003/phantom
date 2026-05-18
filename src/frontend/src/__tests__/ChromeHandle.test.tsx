import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ChromeHandle } from '../components/core/ChromeHandle';

describe('ChromeHandle', () => {
  it('renders aria-expanded="false" when collapsed=true', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={true} onToggle={() => {}} label="StatusBar" />,
    );
    const btn = container.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders aria-expanded="true" when collapsed=false', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={false} onToggle={() => {}} label="StatusBar" />,
    );
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('fires onToggle on click', () => {
    const cb = vi.fn();
    const { container } = render(
      <ChromeHandle position="top" collapsed={false} onToggle={cb} label="HUD" />,
    );
    fireEvent.click(container.querySelector('button')!);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('aria-label says "Розгорнути" when collapsed=true', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={true} onToggle={() => {}} label="Roster" />,
    );
    const aria = container.querySelector('button')!.getAttribute('aria-label');
    expect(aria).toMatch(/^Розгорнути /);
    expect(aria).toMatch(/Roster$/);
  });

  it('aria-label says "Згорнути" when collapsed=false', () => {
    const { container } = render(
      <ChromeHandle position="bottom" collapsed={false} onToggle={() => {}} label="Toolbar" />,
    );
    expect(container.querySelector('button')!.getAttribute('aria-label')).toMatch(/^Згорнути /);
  });

  it('has min 44px touch target via inline style', () => {
    const { container } = render(
      <ChromeHandle position="top" collapsed={true} onToggle={() => {}} label="x" />,
    );
    const btn = container.querySelector('button')! as HTMLButtonElement;
    expect(parseInt(btn.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(24);
  });
});
