// SplashScreen — Full-viewport cover with shatter animation.
// Shows arena-hero.png (from 64f6aa2425a2-image.png) full-viewport for 2s,
// then the image shatters into a 6×4 grid of fragments that fly apart.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import splashCover from "../assets/arena-hero.png";

interface SplashScreenProps {
  onDone: () => void;
}

interface FragmentStyle {
  row: number;
  col: number;
  tx: number;
  ty: number;
  rot: number;
  delay: number;
}

const COLS = 6;
const ROWS = 4;
const SHOW_DURATION = 2000; // 2s before shatter

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function generateFragments(): FragmentStyle[] {
  const fragments: FragmentStyle[] = [];
  let seed = 42;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      // Center fragments get more delay / less displacement
      const cx = Math.abs(c - (COLS - 1) / 2) / ((COLS - 1) / 2);
      const cy = Math.abs(r - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
      const dist = Math.sqrt(cx * cx + cy * cy);
      seed++;
      fragments.push({
        row: r,
        col: c,
        tx: (seededRandom(seed++) * 300 - 150) * (0.5 + dist),
        ty: (seededRandom(seed++) * 300 - 150) * (0.5 + dist),
        rot: (seededRandom(seed++) * 120 - 60) * (0.5 + dist),
        delay: 0.02 + dist * 0.25 + seededRandom(seed++) * 0.1,
      });
    }
  }
  return fragments;
}

export function SplashScreen({ onDone }: SplashScreenProps): JSX.Element {
  const [phase, setPhase] = useState<"show" | "shatter" | "done">("show");
  const fragments = useMemo(() => generateFragments(), []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    setPhase("done");
    // Small delay to let last fragments finish
    timerRef.current = setTimeout(onDone, 200);
  }, [onDone]);

  useEffect(() => {
    // Show image for 2s, then shatter
    timerRef.current = setTimeout(() => {
      setPhase("shatter");
      // After shatter animation (1.2s), finish
      timerRef.current = setTimeout(finish, 1300);
    }, SHOW_DURATION);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [finish]);

  if (phase === "done") return <></>;

  return (
    <div className="splash-overlay" data-testid="splash-screen">
      <div className="splash-image-container">
        {/* Full image shown during "show" phase, hidden during shatter */}
        <img
          src={splashCover}
          alt=""
          className="splash-image-full"
          style={{ opacity: phase === "show" ? 1 : 0, transition: "opacity 0.1s" }}
        />

        {/* Shatter grid — appears during shatter phase */}
        {phase === "shatter" && (
          <div className="shatter-grid" data-testid="shatter-grid">
            {fragments.map((f, i) => (
              <div
                key={i}
                data-testid="shatter-fragment"
                className="shatter-fragment"
                style={{
                  backgroundImage: `url(${splashCover})`,
                  backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
                  backgroundPosition: `${(f.col / (COLS - 1)) * 100}% ${(f.row / (ROWS - 1)) * 100}%`,
                  animationDelay: `${f.delay}s`,
                  "--tx": `${f.tx}px`,
                  "--ty": `${f.ty}px`,
                  "--rot": `${f.rot}deg`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
