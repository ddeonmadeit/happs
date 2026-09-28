import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { trackVisualViewport } from "./lib/viewport";
import { installGlitchTouch } from "./lib/glitch";

trackVisualViewport();
installGlitchTouch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
