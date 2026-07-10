type Props = {
  seconds: number;
};

export default function TimeDisplay({ seconds }: Props) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");

  return (
    <div className="time-display">
      <span className="time-display-digits">
        {minutes}:{secs}
      </span>
    </div>
  );
}
