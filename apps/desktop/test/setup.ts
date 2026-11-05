import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// A screen's first query goes through a real API and database; with every DB
// suite running at once in CI it can take over the default 1 s to load.
configure({ asyncUtilTimeout: 5000 });

// jsdom does not implement scrolling; TanStack Router restores scroll on navigation.
window.scrollTo = () => {};
