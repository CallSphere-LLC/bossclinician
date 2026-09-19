import { useEffect, useState } from "react";
export function formatCallDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
export function CallDuration({ joinedAt }: { joinedAt: number | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!joinedAt) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [joinedAt]);
  if (!joinedAt) return null;
  return (
    <span
      role="timer"
      aria-label="Call duration"
      className="font-mono text-sm tabular-nums"
    >
      {formatCallDuration((now - joinedAt) / 1000)}
    </span>
  );
}
