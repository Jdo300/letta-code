/**
 * Local Server - Open a TCP socket for local agent-to-agent communication
 * Usage: /local-server [--port 9876]
 *
 * This creates a simple TCP server that:
 * 1. Accepts connections from local clients (like a skill)
 * 2. Receives text commands and processes them as user input
 * 3. Sends output back to connected clients
 * 4. Supports UI commands for remote control
 */

import * as net from "node:net";
import { hostname } from "node:os";

interface LocalServerOptions {
  port?: number;
}

// Active server state
let activeServer: net.Server | null = null;
let activePort: number | null = null;
const connectedClients: Set<net.Socket> = new Set();

// Output buffer for clients to read
let outputBuffer: string[] = [];
const MAX_BUFFER_LINES = 1000;

// Callbacks for different command types
let messageHandler: ((message: string) => Promise<void>) | null = null;
let uiCommandHandler:
  | ((command: string, args: string) => Promise<string>)
  | null = null;

/**
 * Register a callback to handle incoming messages
 */
export function setMessageHandler(
  handler: (message: string) => Promise<void>,
): void {
  messageHandler = handler;
}

/**
 * Register a callback to handle UI commands (SELECT, APPROVE, DENY, MODE, KEY, CANCEL)
 */
export function setUiCommandHandler(
  handler: (command: string, args: string) => Promise<string>,
): void {
  uiCommandHandler = handler;
}

/**
 * Add output to the buffer (called when agent sends messages)
 */
export function appendOutput(line: string, isNotification = false): void {
  const timestamp = new Date().toISOString();
  const prefix = isNotification ? "[NOTIFY]" : "[OUTPUT]";
  const formattedLine = `${timestamp} ${prefix} ${line}`;

  outputBuffer.push(formattedLine);

  // Trim buffer if too large
  if (outputBuffer.length > MAX_BUFFER_LINES) {
    outputBuffer = outputBuffer.slice(-MAX_BUFFER_LINES);
  }

  // Send to all connected clients
  const message = formattedLine + "\n";
  for (const client of connectedClients) {
    try {
      client.write(message);
    } catch {
      // Client might have disconnected
      connectedClients.delete(client);
    }
  }
}

/**
 * Get the current output buffer
 */
export function getOutputBuffer(lines?: number): string[] {
  if (lines === undefined) {
    return [...outputBuffer];
  }
  return outputBuffer.slice(-lines);
}

/**
 * Check if the local server is active
 */
export function isLocalServerActive(): boolean {
  return activeServer !== null;
}

/**
 * Get the active port
 */
export function getActivePort(): number | null {
  return activePort;
}

/**
 * Handle a client connection
 */
function handleClient(socket: net.Socket): void {
  connectedClients.add(socket);

  const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[local-server] Client connected: ${clientAddr}`);

  // Send welcome message
  socket.write(
    `Connected to Letta Code local server on ${hostname()}:${activePort}\n`,
  );
  socket.write(`Buffer has ${outputBuffer.length} lines.\n`);
  socket.write(`Commands: READ, READ <n>, STATUS, EXIT\n`);
  socket.write(
    `UI: SELECT <n>, APPROVE, DENY [reason], CANCEL, MODE <mode>, KEY <key>\n`,
  );

  let inputBuffer = "";
  let pendingMessageLines: string[] = []; // Accumulate non-command lines for single submission

  socket.on("data", async (data) => {
    inputBuffer += data.toString();

    // Process complete lines
    const lines = inputBuffer.split("\n");
    inputBuffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Normalize whitespace: replace tabs with spaces, collapse multiple spaces
      const normalized = trimmed.replace(/\s+/g, " ");
      const upperNormalized = normalized.toUpperCase();

      // Handle special commands
      if (upperNormalized === "READ") {
        const recent = outputBuffer.slice(-50);
        socket.write(`=== BUFFER (${recent.length} lines) ===\n`);
        socket.write(recent.join("\n") + "\n");
        socket.write(`=== END BUFFER ===\n`);
        continue;
      }

      if (upperNormalized.startsWith("READ ")) {
        const args = normalized.slice(5).trim();
        const count = parseInt(args, 10);
        // Check if it's a valid number
        if (!isNaN(count)) {
          if (count > 0) {
            // Valid READ command
            const recent = outputBuffer.slice(-count);
            socket.write(`=== BUFFER (${recent.length} lines) ===\n`);
            socket.write(recent.join("\n") + "\n");
            socket.write(`=== END BUFFER ===\n`);
          } else {
            // Invalid: zero or negative
            socket.write(
              `[ERROR] Invalid READ count: ${count}. Must be a positive number.\n`,
            );
          }
        } else {
          // Not a number - pass to message handler (e.g., "Read the file /etc/hosts")
          if (messageHandler) {
            try {
              socket.write(
                `[ACK] Processing: ${trimmed.substring(0, 50)}...\n`,
              );
              await messageHandler(trimmed);
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              socket.write(`[ERROR] ${errorMsg}\n`);
            }
          } else {
            socket.write(`[ERROR] No message handler registered\n`);
          }
        }
        continue;
      }

      if (trimmed.toUpperCase() === "STATUS") {
        socket.write(`Server: ${hostname()}:${activePort}\n`);
        socket.write(`Connected clients: ${connectedClients.size}\n`);
        socket.write(`Buffer lines: ${outputBuffer.length}\n`);
        continue;
      }

      if (trimmed.toUpperCase() === "EXIT") {
        socket.write("Goodbye!\n");
        socket.end();
        continue;
      }

      // UI Commands
      const upperTrimmed = upperNormalized;
      const normalizedTrimmed = normalized;

      if (upperTrimmed === "APPROVE" || upperTrimmed.startsWith("APPROVE ")) {
        // APPROVE ignores extra arguments
        if (uiCommandHandler) {
          try {
            const result = await uiCommandHandler("APPROVE", "");
            socket.write(`[UI] ${result}\n`);
          } catch (error) {
            socket.write(
              `[ERROR] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        } else {
          socket.write(`[ERROR] No UI command handler registered\n`);
        }
        continue;
      }

      if (upperTrimmed.startsWith("DENY")) {
        const reason =
          normalizedTrimmed.slice(4).trim() || "No reason provided";
        if (uiCommandHandler) {
          try {
            const result = await uiCommandHandler("DENY", reason);
            socket.write(`[UI] ${result}\n`);
          } catch (error) {
            socket.write(
              `[ERROR] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        } else {
          socket.write(`[ERROR] No UI command handler registered\n`);
        }
        continue;
      }

      if (upperTrimmed === "SELECT" || upperTrimmed.startsWith("SELECT ")) {
        const selection = normalizedTrimmed.slice(6).trim();
        if (!selection) {
          socket.write(`[ERROR] SELECT requires a number. Usage: SELECT <n>\n`);
          continue;
        }
        if (uiCommandHandler) {
          try {
            const result = await uiCommandHandler("SELECT", selection);
            socket.write(`[UI] ${result}\n`);
          } catch (error) {
            socket.write(
              `[ERROR] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        } else {
          socket.write(`[ERROR] No UI command handler registered\n`);
        }
        continue;
      }

      if (upperTrimmed === "CANCEL") {
        if (uiCommandHandler) {
          try {
            const result = await uiCommandHandler("CANCEL", "");
            socket.write(`[UI] ${result}\n`);
          } catch (error) {
            socket.write(
              `[ERROR] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        } else {
          socket.write(`[ERROR] No UI command handler registered\n`);
        }
        continue;
      }

      if (upperTrimmed === "MODE" || upperTrimmed.startsWith("MODE ")) {
        const mode = normalizedTrimmed.slice(4).trim().toLowerCase();
        if (!mode) {
          socket.write(
            `[ERROR] MODE requires a mode name. Usage: MODE <yolo|plan|default>\n`,
          );
          continue;
        }
        if (uiCommandHandler) {
          try {
            const result = await uiCommandHandler("MODE", mode);
            socket.write(`[UI] ${result}\n`);
          } catch (error) {
            socket.write(
              `[ERROR] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        } else {
          socket.write(`[ERROR] No UI command handler registered\n`);
        }
        continue;
      }

      if (upperTrimmed === "KEY" || upperTrimmed.startsWith("KEY ")) {
        const key = normalizedTrimmed.slice(4).trim();
        if (!key) {
          socket.write(
            `[ERROR] KEY requires a key name. Usage: KEY <Escape|Enter|Tab>\n`,
          );
          continue;
        }
        if (uiCommandHandler) {
          try {
            const result = await uiCommandHandler("KEY", key);
            socket.write(`[UI] ${result}\n`);
          } catch (error) {
            socket.write(
              `[ERROR] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          }
        } else {
          socket.write(`[ERROR] No UI command handler registered\n`);
        }
        continue;
      }

      // Regular message - accumulate lines for single submission on connection close
      if (pendingMessageLines.length === 0) {
        // ACK on first content line so sender knows we received it
        socket.write(`[ACK] Processing: ${trimmed.substring(0, 50)}...\n`);
      }
      pendingMessageLines.push(trimmed);
    }
  });

  socket.on("close", async () => {
    connectedClients.delete(socket);
    console.log(`[local-server] Client disconnected: ${clientAddr}`);

    // Flush any remaining partial line into pending
    if (inputBuffer.trim()) {
      pendingMessageLines.push(inputBuffer.trim());
      inputBuffer = "";
    }

    // Submit accumulated message lines as a single message
    if (pendingMessageLines.length > 0) {
      const fullMessage = pendingMessageLines.join("\n");
      pendingMessageLines = [];
      if (messageHandler) {
        try {
          console.log(
            `[local-server] Submitting message (${fullMessage.length} chars)`,
          );
          await messageHandler(fullMessage);
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          console.log(`[local-server] Message submission error: ${errorMsg}`);
        }
      } else {
        console.log(
          `[local-server] Message not submitted: no handler registered`,
        );
      }
    }
  });

  socket.on("error", (err) => {
    connectedClients.delete(socket);
    console.log(`[local-server] Client error: ${err.message}`);
  });
}

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.once("close", () => resolve(true)).close();
      })
      .listen(port);
  });
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(
  startPort: number,
  maxAttempts = 10,
): Promise<number | null> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return null;
}

/**
 * Start the local server
 */
export async function startLocalServer(
  opts: LocalServerOptions = {},
  onStatusChange?: (
    status: "started" | "stopped" | "error",
    port?: number,
    error?: string,
  ) => void,
): Promise<{ success: boolean; port?: number; error?: string }> {
  if (activeServer) {
    return { success: false, error: "Server already running" };
  }

  const requestedPort = opts.port || 9876;

  // Check if requested port is available
  const port = await findAvailablePort(requestedPort);
  if (!port) {
    const error = `No available port found (tried ${requestedPort}-${requestedPort + 9})`;
    onStatusChange?.("error", undefined, error);
    return { success: false, error };
  }

  if (port !== requestedPort) {
    console.log(
      `[local-server] Port ${requestedPort} in use, using port ${port}`,
    );
  }

  return new Promise((resolve) => {
    const server = net.createServer(handleClient);

    server.on("error", (err) => {
      activeServer = null;
      onStatusChange?.("error", undefined, err.message);
      resolve({ success: false, error: err.message });
    });

    server.listen(port, () => {
      activeServer = server;
      activePort = port;
      onStatusChange?.("started", port);
      console.log(`[local-server] Started on port ${port}`);
      resolve({ success: true, port });
    });
  });
}

/**
 * Stop the local server
 */
export async function stopLocalServer(): Promise<void> {
  if (!activeServer) return;

  // Close all clients
  for (const client of connectedClients) {
    client.destroy();
  }
  connectedClients.clear();

  // Close server
  await new Promise<void>((resolve) => {
    activeServer!.close(() => {
      resolve();
    });
  });

  activeServer = null;
  activePort = null;
  console.log(`[local-server] Stopped`);
}

/**
 * Handle /local-server command
 */
export async function handleLocalServer(
  msg: string,
  opts: LocalServerOptions = {},
): Promise<string> {
  const trimmed = msg.trim();

  // Handle /local-server off
  if (trimmed === "/local-server off" || trimmed === "/local off") {
    if (!isLocalServerActive()) {
      return "Local server is not running.";
    }
    await stopLocalServer();
    return "Local server stopped.";
  }

  // Show help
  if (trimmed.includes("--help") || trimmed.includes("-h")) {
    return [
      "Usage: /local-server [--port <port>]",
      "       /local-server off",
      "",
      "Start a local TCP server for agent-to-agent communication.",
      "",
      "Options:",
      "  --port <port>  Port to listen on (default: 9876)",
      "  off            Stop the server",
      "  -h, --help     Show this help",
      "",
      "Once started, you can connect with:",
      "  nc localhost 9876",
      "  telnet localhost 9876",
      "",
      "Commands:",
      "  READ            - Get last 50 lines from buffer",
      "  READ <n>        - Get last n lines from buffer",
      "  STATUS          - Show server status",
      "  EXIT            - Disconnect",
      "",
      "UI Commands:",
      "  SELECT <n>      - Select option n from current approval/poll",
      "  APPROVE         - Approve current approval",
      "  DENY [reason]   - Deny current approval",
      "  CANCEL          - Cancel current dialog (Escape)",
      "  MODE <mode>     - Switch mode (yolo, plan, default)",
      "  KEY <key>       - Send a keypress (Escape, Enter, Tab, etc.)",
      "",
      "Any other text is sent as a message to the agent.",
    ].join("\n");
  }

  // Start server
  if (isLocalServerActive()) {
    return `Local server already running on port ${activePort}.`;
  }

  const result = await startLocalServer(opts);
  if (result.success) {
    return [
      `Local server started on port ${result.port}`,
      "",
      `Connect with:`,
      `  nc localhost ${result.port}`,
      `  telnet localhost ${result.port}`,
      "",
      `Send text to process as user input.`,
      `Use READ to get output buffer.`,
      `Use SELECT, APPROVE, DENY for UI control.`,
    ].join("\n");
  } else {
    return `Failed to start local server: ${result.error}`;
  }
}
