export function PlayButton({
  title,
  on,
  disabled,
  onClick,
}: {
  title: string;
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="play"
      aria-pressed={on}
      aria-label={`${on ? 'Stop' : 'Start'} timer on ${title}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{on ? '■' : '▶'}</span>
    </button>
  );
}
