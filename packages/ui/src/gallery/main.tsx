import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../theme.css";
import { Gallery } from "./Gallery";

const story = new URLSearchParams(location.search).get("story") ?? undefined;
const filter = new URLSearchParams(location.search).get("filter") ?? undefined;
// biome-ignore lint/style/noNonNullAssertion: root exists in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery filter={filter} story={story} />
  </StrictMode>,
);
