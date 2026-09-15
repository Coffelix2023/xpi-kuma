import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const VERSION = "0.1.0";

export default function xpiKuma(pi: ExtensionAPI): void {
  pi.registerCommand("xpi-kuma", {
    description: "Show xpi-kuma status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`xpi-kuma ${VERSION} loaded`);
    },
  });
}
