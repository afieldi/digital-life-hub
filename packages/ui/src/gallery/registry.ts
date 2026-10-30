import type { ReactNode } from "react";

export type Story = { id: string; title: string; render: () => ReactNode };
export type StoryGroup = { group: string; stories: Story[] };

const groups: StoryGroup[] = [];

export function registerStories(group: string, stories: Story[]): void {
  groups.push({ group, stories });
}

export function getStoryGroups(): readonly StoryGroup[] {
  return groups;
}
