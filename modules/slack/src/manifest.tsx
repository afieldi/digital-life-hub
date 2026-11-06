import { defineModule } from "@dlh/core";
import { slackModule } from "./module";
import { SlackSettings } from "./screens/SettingsSection";

export default defineModule(slackModule, {
  routes: () => [],
  settingsSections: [
    { id: "settings", label: "Slack", component: SlackSettings },
  ],
});
