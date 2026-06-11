// Tiny inline-SVG sparkline. Renders the last N vote counts as a
// smooth-ish line; the rightmost point is the most recent
// observation. No axes, no labels — just the shape.
import type { VoteSummary } from "../lib/api";

interface SparklineProps {
  history: VoteSummary["history"];
  width?: number;
  height?: number;
}

export function Sparkline({
  history,
  width = 320,
  height = 64,
}: SparklineProps): JSX.Element {
  if (history.length === 0) {
    return (
      <svg
        role="img"
        aria-label="no data"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-slate-300"
      >
        <line
          x1="0"
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    );
  }
  if (history.length === 1) {
    const y = height / 2;
    return (
      <svg
        role="img"
        aria-label="single data point"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="text-indigo-500"
      >
        <circle cx={width / 2} cy={y} r="3" fill="currentColor" />
      </svg>
    );
  }

  const min = Math.min(...history.map((p) => p.votes));
  const max = Math.max(...history.map((p) => p.votes));
  const range = max - min || 1;
  const padX = 2;
  const padY = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;
  const stepX = w / (history.length - 1);

  const points = history
    .map((p, i) => {
      const x = padX + i * stepX;
      const y = padY + h - ((p.votes - min) / range) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      role="img"
      aria-label={`sparkline: ${history.length} data points, range ${min}–${max}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="text-indigo-500"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={padX + (history.length - 1) * stepX}
        cy={padY + h - ((history[history.length - 1]!.votes - min) / range) * h}
        r="3"
        fill="currentColor"
      />
    </svg>
  );
}
