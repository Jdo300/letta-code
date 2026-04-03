---
name: local-tui
description: Connect to a running Letta Code instance via TCP socket. Use when you need to communicate with an agent running in a Letta Code TUI session on a local or remote machine.
---

# Local TUI Connection

This skill enables you to connect to a Letta Code instance that's already running and send messages to the agent in that session.

## When to Use This Skill

- You need to send a message to an agent running in a Letta Code TUI session
- You want to check the status or output of a remote Letta Code instance
- You need to control an agent from another machine or another agent

## How It Works

Letta Code can start a local TCP server with the `--local-server` flag. This server:
1. Listens on a configurable port (default: 9876)
2. Accepts connections from TCP clients
3. Processes incoming text as user input to the agent
4. Maintains an output buffer that clients can read

## Starting the Local Server

### From the Command Line

```bash
letta --local-server --local-server-port 9876
```

### From Within Letta Code

```
/local-server --port 9876
```

To stop the server:
```
/local-server off
```

## Connecting to the Server

### Using netcat (nc)

```bash
# Connect to local server
nc localhost 9876

# Connect to remote server via SSH
ssh <hostname> "nc localhost 9876"
```

### Using socat

```bash
socat - TCP:localhost:9876
```

## Protocol

Once connected, you can:

1. **Send a message** - Just type text and press Enter. The server will process it as user input.

2. **Read the output buffer** - Send `READ` to get the last 50 lines, or `READ <n>` for the last n lines.

3. **Check server status** - Send `STATUS` to see server info.

4. **Disconnect** - Send `EXIT` or close the connection.

### Example Session

```
$ nc localhost 9876
Connected to Letta Code local server on hostname:9876
Buffer has 0 lines. Send commands as plain text.
Special commands: READ, READ <n>, STATUS, EXIT
Hello from a TCP client!
[ACK] Processing: Hello from a TCP client!...
READ 10
=== BUFFER (10 lines) ===
...output lines...
=== END BUFFER ===
STATUS
Server: hostname:9876
Connected clients: 1
Buffer lines: 42
EXIT
Goodbye!
```

## Remote Connections

For remote machines, you need to tunnel through SSH:

```bash
# Connect to a remote Letta Code instance
ssh <hostname> "nc localhost 9876"

# Or use SSH port forwarding
ssh -L 9876:localhost:9876 <hostname>
nc localhost 9876
```

## Environment Variables

- `LETTA_LOCAL_SERVER_HOST` - Default host (default: localhost)
- `LETTA_LOCAL_SERVER_PORT` - Default port (default: 9876)

## Security Considerations

- The server binds to all interfaces (0.0.0.0) by default
- No authentication is implemented - use firewall rules or SSH tunneling for security
- Only intended for trusted local networks or SSH-tunneled connections

## Related Skills

- **messaging-agents**: Send messages to agents via the Letta API (different from local TCP)
- **finding-agents**: Find agents by name or tags
