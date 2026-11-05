import { hue, initials } from '../domain/people';

export function Avatar({ name }: { name: string }) {
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
