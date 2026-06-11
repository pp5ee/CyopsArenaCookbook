// Top-level router. Renders the Header on every page and switches
// between the routes. Old pages (Guide, VoteTicker, About) remain
// in the source tree for future use but the landing page is now the
// primary root route.
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Landing } from "./pages/Landing";
import { PromptStudio } from "./pages/PromptStudio";
import { NotFound } from "./pages/NotFound";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-arena-bg text-arena-text">
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/prompt" element={<PromptStudio />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
