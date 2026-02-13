# OpenClaw Dispatch Tools Plugin

This plugin is the control-plane bridge. It should expose only the closed dispatch actions and forward them to dispatch-api.

## Rules

- no direct ticket mutation in plugin process
- no business-state writes outside dispatch-api
- tool schemas must match `/src/contracts/v0.ts`
- plugin config must include dispatch-api base URL and auth settings
