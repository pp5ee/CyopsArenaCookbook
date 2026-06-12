// 404 page.
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function NotFound(): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 py-8 text-center">
      <h1 className="text-2xl font-semibold text-arena-text">404</h1>
      <p className="text-arena-muted">{t("common.error")}</p>
      <p>
        <Link to="/" className="text-arena-accent hover:underline">
          Home →
        </Link>
      </p>
    </section>
  );
}
