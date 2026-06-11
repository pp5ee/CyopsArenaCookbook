import React from "react";
import ReactDOM from "react-dom/client";

// Minimal smoke root — real pages land in AC-7.
function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>CyOpsArenaCookbook</h1>
      <p>Scaffold ready. Routes &amp; pages land in AC-7.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
