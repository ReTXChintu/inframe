import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { FeedbackProvider } from "@/components/feedback";
import { applyStoredTheme } from "@/pages/Settings";
import { App } from "./App";
import "./index.css";

applyStoredTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <FeedbackProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </FeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
