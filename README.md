<div align="center">

<img src="./public/images/chatlab.svg" alt="ChatLab" title="ChatLab" width="300" />

Local-first chat analysis tool: Relive your social memories powered by SQL and AI Agents.

English | [简体中文](./README.zh-CN.md)

[Project Website](https://chatlab.fun/) · [Documentation](https://chatlab.fun/usage/) · [Roadmap](https://chatlabfun.featurebase.app/roadmap) · [Issue Submission](https://github.com/hellodigua/ChatLab/issues)

</div>

ChatLab is a free, open-source, and local-first application dedicated to analyzing chat records. Through an AI Agent and a flexible SQL engine, you can freely dissect, query, and even reconstruct your social data.

We refuse to upload your privacy to the cloud; instead, we bring powerful analytics directly to your computer.

Currently supported: Chat record analysis for **LINE, WeChat, QQ, WhatsApp, Instagram and Discord**. Upcoming support: **Messenger, iMessage**.

The project is still in early iteration, so there are many bugs and unfinished features. If you encounter any issues, feel free to provide feedback.

## Core Features

- 🚀 **Ultimate Performance**: Utilizing stream computing and multi-threaded parallel architecture, it maintains fluid interaction and response even with millions of chat records.
- 🔒 **Privacy Protection**: Chat records and configurations are stored in your local database, and all analysis is performed locally (with the exception of AI features).
- 🤖 **Intelligent AI Agent**: Integrated with 10+ Function Calling tools and supporting dynamic scheduling to deeply excavate interesting insights from chat records.
- 📊 **Multi-dimensional Data Visualization**: Provides intuitive analysis charts for activity trends, time distribution patterns, member rankings, and more.
- 🧩 **Format Standardization**: Through a powerful data abstraction layer, it bridges the format differences between various chat applications, allowing any chat records to be analyzed.

## Usage Guides

- [Chat Record Export Guide](https://chatlab.fun/usage/how-to-export.html)
- [Standardized Format Specification](https://chatlab.fun/usage/chatlab-format.html)
- [Troubleshooting Guide](https://chatlab.fun/usage/troubleshooting.html)

## Preview Interface

For more previews, please visit the official website: [chatlab.fun](https://chatlab.fun/)

![Preview Interface](/public/images/intro_en.png)

## System Architecture

### Electron Main Process

- `electron/main/index.ts` handles the application lifecycle, window management, and custom protocol registration.
- `electron/main/ipc/` splits IPC modules by function (Window, Chat, Merge, AI, Cache) to ensure secure and controllable data exchange.
- `electron/main/ai/` integrates multiple LLMs, featuring built-in Agent pipelines, prompt assembly, and Function Calling tool registration.

### Worker and Data Pipeline

- The `workerManager` in `electron/main/worker/` coordinates Worker threads, while `dbWorker` handles message routing.
- `worker/query/*` handles activity, AI search, advanced analysis, and SQL Lab queries.
- `worker/import/streamImport.ts` provides stream importing.
- The `parser/` directory adopts a three-layer "sniff + parse" architecture capable of processing GB-level log files with constant memory usage.

### Rendering Process

- Vue 3 + Nuxt UI + Tailwind CSS manages the visualization pages.
- `src/pages` contains business pages, while `src/components/analysis` and `src/components/charts` provide reusable components.
- `src/stores` manages states like sessions, layout, and AI prompts via Pinia.
- `src/composables/useAIChat.ts` encapsulates the AI conversation workflow.
- The preload script `electron/preload/index.ts` exposes `window.chatApi/mergeApi/aiApi/llmApi`, ensuring secure isolation between the renderer and main processes.

---

## Local Development

### Setup Steps

Node.js environment requirement: v20+

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

```

If Electron encounters exceptions during startup, you can try using `electron-fix`:

```bash
npm install electron-fix -g
electron-fix start

```

## Contribution Guide

Please follow these principles before submitting a Pull Request:

- Obvious bug fixes can be submitted directly.
- For new features, please submit an Issue for discussion first; **PRs submitted without prior discussion will be closed**.
- Keep one PR focused on one task; if changes are extensive, consider splitting them into multiple independent PRs.

## Privacy Policy & User Agreement

Before using this software, please read the [Privacy Policy & User Agreement](./src/assets/docs/agreement_en.md).

## License

AGPL-3.0 License
