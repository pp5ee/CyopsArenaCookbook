// Top-level router. Renders the Header on every page and switches
// between the four routes defined by AC-7. The /vote route pulls in
// the ToastRail via the page itself.
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { Guide } from "./pages/Guide";
import { PromptStudio } from "./pages/PromptStudio";
import { VoteTicker } from "./pages/VoteTicker";
import { About } from "./pages/About";
import { NotFound } from "./pages/NotFound";

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-arena-bg text-arena-text">
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-6">
          <Routes>
            <Route path="/" element={<Guide />} />
            <Route path="/prompt" element={<PromptStudio />} />
            <Route path="/vote" element={<VoteTicker />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
