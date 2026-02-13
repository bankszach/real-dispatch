import { Type } from "@sinclair/typebox";

/**
 * Placeholder plugin entrypoint.
 *
 * This file intentionally registers no executable dispatch tools yet.
 * It exists to lock plugin shape, config schema ownership, and future tool naming.
 */
export default function register(_api: {
  registerTool: (
    spec: {
      name: string;
      description: string;
      parameters: unknown;
      execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
    },
    opts?: { optional?: boolean },
  ) => void;
}) {
  _api.registerTool(
    {
      name: "dispatch_contract_status",
      description: "Returns locked dispatch contract metadata.",
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute() {
        return {
          content: [
            {
              type: "text",
              text: "dispatch-tools plugin scaffold is installed; closed action bridge not wired yet",
            },
          ],
        };
      },
    },
    { optional: true },
  );
}
