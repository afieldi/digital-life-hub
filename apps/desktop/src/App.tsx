import { RouterProvider } from "@tanstack/react-router";
import type { AppRouter } from "./router";

export function App({ router }: { router: AppRouter }) {
  return <RouterProvider router={router} />;
}
