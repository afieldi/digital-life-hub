import { defineModule } from "@dlh/core";
import { agentModule } from "./module";
import { AgentSettings } from "./screens/SettingsSection";

export default defineModule(agentModule, {
  routes: () => [],
  settingsSections: [
    { id: "settings", label: "Agent", component: AgentSettings },
  ],
});
