// TopBar — Minimal top navigation replacing the old Header.
// Logo + title on left, Credits badge + language dropdown on right.
// No multi-tab nav — the site is only 3 pages navigated through content.
import { Link, useLocation } from "react-router-dom";
import { LanguageDropdown } from "./LanguageDropdown";
import { CreditsBadge } from "./CreditsBadge";

export function TopBar(): JSX.Element {
  const loc = useLocation();
  const isHome = loc.pathname === "/";

  return (
    <header className="sticky top-0 z-40 border-b border-arena-border/50 bg-arena-surface/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
        {/* Left: Logo */}
        <Link
          to="/"
          className="flex items-center gap-2 font-semibold text-arena-text transition-opacity hover:opacity-80"
          data-testid="topbar-logo"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-6 w-6 items-center justify-center rounded
                       bg-gradient-to-br from-arena-accent to-cyber-purple text-xs text-white font-bold"
          >
            C
          </span>
          <span className="hidden sm:inline text-sm tracking-wide">
            CyOps<span className="text-arena-accent">Cookbook</span>
          </span>
        </Link>

        {/* Center: Page indicator */}
        {!isHome && (
          <nav className="flex items-center gap-1 text-xs">
            <Link
              to="/"
              className="text-arena-muted hover:text-arena-text transition-colors px-2 py-1 rounded hover:bg-arena-surface-hover"
            >
              Guide
            </Link>
            <span className="text-arena-border">/</span>
            <Link
              to="/ideas"
              className={`px-2 py-1 rounded transition-colors ${
                loc.pathname === "/ideas"
                  ? "text-arena-accent bg-arena-accent/10"
                  : "text-arena-muted hover:text-arena-text hover:bg-arena-surface-hover"
              }`}
            >
              Ideas
            </Link>
            <span className="text-arena-border">/</span>
            <Link
              to="/vote"
              className={`px-2 py-1 rounded transition-colors ${
                loc.pathname === "/vote"
                  ? "text-arena-accent bg-arena-accent/10"
                  : "text-arena-muted hover:text-arena-text hover:bg-arena-surface-hover"
              }`}
            >
              Vote
            </Link>
          </nav>
        )}

        {/* Right: Credits + Language */}
        <div className="flex items-center gap-2">
          <CreditsBadge />
          <LanguageDropdown />
        </div>
      </div>
    </header>
  );
}
