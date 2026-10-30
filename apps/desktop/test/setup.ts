import "@testing-library/jest-dom/vitest";

// jsdom does not implement scrolling; TanStack Router restores scroll on navigation.
window.scrollTo = () => {};
