import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AuthProvider } from "./auth/AuthProvider";
import { loadRuntimeConfig, RuntimeConfigContext } from "./auth/config";
import { ThemeProvider } from "./theme";

const root = createRoot(document.getElementById("root")!);

void loadRuntimeConfig().then((config) => {
  root.render(
    <StrictMode>
      <RuntimeConfigContext.Provider value={config}>
        <AuthProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </AuthProvider>
      </RuntimeConfigContext.Provider>
    </StrictMode>,
  );
});
