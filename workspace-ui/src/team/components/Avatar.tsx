import { useState } from 'react';
import { hue, initials } from '../domain/people';

export function Avatar({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img className="av" src={src} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  return (
    <span className="av" title={name} aria-label={name} role="img" style={{ background: `hsl(${hue(name)} 45% 42%)` }}>
      {initials(name)}
    </span>
  );
}

export function People({ ids, nameOf, max = 5 }: { ids: string[]; nameOf: (id: string) => string; max?: number }) {
  const shown = ids.slice(0, max);
  const extra = ids.length - shown.length;
  return (
    <span className="people">
      {shown.map((id) => (
        <Avatar key={id} name={nameOf(id)} />
      ))}
      {extra > 0 && (
        <span className="av av-more" title={`${extra} more`}>
          +{extra}
        </span>
      )}
    </span>
  );
}
