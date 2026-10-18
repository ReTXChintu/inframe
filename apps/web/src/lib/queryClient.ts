import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/** Shared so non-React code (the upload queue) can refresh cached lists too. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Don't hammer the API on 4xx (not found, forbidden…); retry real failures once.
      retry: (count, err) => count < 1 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
    },
  },
});
