// Top navigation. React Router NavLinks for the four routes, plus
// the LangToggle and CreditsBadge on the right. Keeps the chrome
// stable across pages so the user always knows where they are.
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LangToggle } from "./LangToggle";
import { CreditsBadge } from "./CreditsBadge";

export function Header(): JSX.Element {
  const { t } = useTranslation();
  const navItems: { to: string; labelKey: string }[] = [
    { to: "/", labelKey: "nav.guide" },
    { to: "/prompt", labelKey: "nav.prompt" },
    { to: "/vote", labelKey: "nav.vote" },
    { to: "/about", labelKey: "nav.about" },
  ];
  return (
    <header className="border-b border-arena-border bg-arena-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <NavLink to="/" className="flex items-center gap-2 font-semibold text-arena-text">
          <span aria-hidden="true" className="inline-block h-6 w-6 rounded bg-gradient-to-br from-arena-accent to-arena-accent-glow" />
          <span>CyOpsArenaCookbook</span>
        </NavLink>
        <nav aria-label="Primary" className="flex flex-1 items-center justify-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={`nav-${item.to.replace(/\W+/g, "") || "home"}`}
              className={({ isActive }) =>
                "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
                (isActive
                  ? "bg-arena-accent text-arena-bg"
                  : "text-arena-muted hover:bg-arena-surface-hover hover:text-arena-text")
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <CreditsBadge />
          <LangToggle />
        </div>
      </div>
    </header>
  );
}
