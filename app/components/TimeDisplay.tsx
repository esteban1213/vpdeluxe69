type Props = {
  seconds: number;
  /** Tapping the display itself triggers this — e.g. opening the loaded
   *  album's floating track list. Omit to render inert. */
  onClick?: () => void;
};

export default function TimeDisplay({ seconds, onClick }: Props) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");

  return (
    <div
      className="time-display"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation();
          onClick();
        })
      }
      onKeyDown={
        onClick &&
        ((e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onClick();
          }
        })
      }
    >
      <span className="time-display-digits">
        {minutes}:{secs}
      </span>
    </div>
  );
}
