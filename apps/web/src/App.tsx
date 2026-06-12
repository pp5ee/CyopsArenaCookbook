// App — Top-level component. Shows splash screen on first load,
// then renders the main app with TopBar + routes. The splash
// auto-dismisses after the shatter animation completes.
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SplashScreen } from "./components/SplashScreen";
import { TopBar } from "./components/TopBar";
import { GuidePage } from "./pages/GuidePage";
import { IdeasPage } from "./pages/IdeasPage";
import { VoteForMePage } from "./pages/VoteForMePage";
import { NotFound } from "./pages/NotFound";

export function App(): JSX.Element {
  const [splashDone, setSplashDone] = useState(false);

  if (!splashDone) {
    return <SplashScreen onDone={() => setSplashDone(true)} />;
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-arena-bg text-arena-text cyber-grid scan-lines">
        <TopBar />
        <main className="animate-fade-in-up">
          <Routes>
            <Route path="/" element={<GuidePage />} />
            <Route path="/ideas" element={<IdeasPage />} />
            <Route path="/vote" element={<VoteForMePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        {/* Subtle footer */}
        <footer className="border-t border-arena-border/30 py-4 text-center text-xs text-arena-muted">
          <span className="text-arena-accent">CyOps</span>
          <span className="text-cyber-purple">Cookbook</span>
          {" — "}
          Hackathon Companion · Built with ❤️ for builders
        </footer>
      </div>
    </BrowserRouter>
  );
}
