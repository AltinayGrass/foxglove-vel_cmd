import { ExtensionContext } from "@foxglove/extension";
import { initExamplePanel } from "./ExamplePanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Velocity Command", initPanel: initExamplePanel });
}
