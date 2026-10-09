import type { ProjectDefinition } from "../../project-contract";
import { createPhysicsSandboxPlugin } from "./PhysicsSandboxPlugin";

export const project: ProjectDefinition = {
  id: "physics-sandbox",
  name: "Physics Sandbox (exemplo)",
  createPlugins: () => [createPhysicsSandboxPlugin()],
};
