import { isTauri } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { createApi } from "./api/client";
import { devSignIn, googleSignIn } from "./auth/signIn";
import { tauriTokenStore, webTokenStore } from "./auth/tokenStore";
import { createAppRouter } from "./router";

const router = createAppRouter();
const tauri = isTauri();
const tokenStore = tauri ? tauriTokenStore : webTokenStore();
const auth = {
  tokenStore,
  method: tauri ? googleSignIn : devSignIn,
  api: createApi({ getToken: tokenStore.get }),
};

// biome-ignore lint/style/noNonNullAssertion: root exists in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App router={router} auth={auth} />
  </StrictMode>,
);
