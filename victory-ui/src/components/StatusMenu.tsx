import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { StatusGroup } from '../domain/statuses';

/**
 * Keyboard-operable alternative to dragging: a small menu button listing the columns.
 * Enter/Space/ArrowDown opens, arrows move, Escape closes and returns focus.
 */
export function StatusMenu({
  title,
  groups,
  current,
  onSelect,
  disabled,
}: {
  title: string;
  groups: StatusGroup[];
  current: StatusGroup | undefined;
  onSelect: (group: StatusGroup) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <span className="smenu">
      <button
        ref={buttonRef}
        type="button"
        className="smenu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Status of ${title}: ${current?.label ?? 'none'}. Change status`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="dot" style={{ background: current?.color }} aria-hidden="true" />
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul ref={menuRef} id={id} className="smenu-list" role="menu" aria-label={`Move ${title} to`} onKeyDown={onMenuKey}>
          {groups.map((g) => (
            <li key={g.key} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={g.key === current?.key}
                onClick={() => {
                  close();
                  if (g.key !== current?.key) onSelect(g);
                }}
              >
                <span className="dot" style={{ background: g.color }} aria-hidden="true" />
                {g.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
