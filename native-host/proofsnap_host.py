#!/usr/bin/env python3
"""
ProofSnap HTTP + WebSocket Server for Screenshot Triggers

This script:
1. Runs an HTTP server on localhost:19999 for external triggers
2. Runs a WebSocket server on localhost:19998 for extension communication
3. When POST /capture is received, sends command to extension via WebSocket

Usage:
  python proofsnap_host.py

Endpoints:
  GET  http://localhost:19999/status  - Health check
  POST http://localhost:19999/capture - Trigger screenshot
"""

import asyncio
import json
import sys
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Set

try:
    import websockets
    from websockets.server import serve
except ImportError:
    print("ERROR: 'websockets' package is required. Install it with:")
    print("  pip install websockets")
    sys.exit(1)

# Configuration
HTTP_PORT = 19999
WS_PORT = 19998
HOST = '127.0.0.1'

# Connected WebSocket clients (extensions)
connected_clients: Set = set()
event_loop = None


class CaptureRequestHandler(BaseHTTPRequestHandler):
    """Handle HTTP requests for capture triggers"""

    def log_message(self, format, *args):
        """Custom logging"""
        print(f"[HTTP] {args[0]}")

    def _send_json_response(self, status_code, data):
        """Send JSON response"""
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_GET(self):
        """Handle GET requests"""
        if self.path == '/status':
            self._send_json_response(200, {
                'ok': True,
                'service': 'ProofSnap Trigger Server',
                'version': '2.0.0',
                'websocket_port': WS_PORT,
                'connected_clients': len(connected_clients)
            })
        else:
            self._send_json_response(404, {'error': 'Not found'})

    def do_POST(self):
        """Handle POST requests"""
        # Verify request is from localhost
        client_ip = self.client_address[0]
        if client_ip not in ('127.0.0.1', '::1', 'localhost'):
            self._send_json_response(403, {'error': 'Forbidden: localhost only'})
            return

        if self.path == '/capture':
            if not connected_clients:
                self._send_json_response(503, {
                    'success': False,
                    'error': 'No extension connected. Make sure ProofSnap extension is running.'
                })
                return

            # Send capture command to all connected extensions via WebSocket
            message = json.dumps({'action': 'capture', 'mode': 'visible'})

            # Schedule the async broadcast on the event loop
            if event_loop:
                asyncio.run_coroutine_threadsafe(
                    broadcast_message(message),
                    event_loop
                )

            self._send_json_response(200, {
                'success': True,
                'message': 'Capture command sent to extension',
                'clients': len(connected_clients)
            })

        elif self.path == '/capture/selection':
            if not connected_clients:
                self._send_json_response(503, {
                    'success': False,
                    'error': 'No extension connected'
                })
                return

            message = json.dumps({'action': 'capture', 'mode': 'selection'})
            if event_loop:
                asyncio.run_coroutine_threadsafe(
                    broadcast_message(message),
                    event_loop
                )

            self._send_json_response(200, {
                'success': True,
                'message': 'Selection capture command sent'
            })

        else:
            self._send_json_response(404, {'error': 'Not found'})


async def broadcast_message(message: str):
    """Send message to all connected WebSocket clients"""
    if connected_clients:
        await asyncio.gather(
            *[client.send(message) for client in connected_clients],
            return_exceptions=True
        )


async def websocket_handler(websocket):
    """Handle WebSocket connections from the extension"""
    connected_clients.add(websocket)
    client_id = id(websocket)
    print(f"[WS] Extension connected (id: {client_id}, total: {len(connected_clients)})")

    try:
        # Send welcome message
        await websocket.send(json.dumps({
            'type': 'connected',
            'message': 'ProofSnap trigger server ready'
        }))

        # Keep connection alive and handle any messages from extension
        async for message in websocket:
            try:
                data = json.loads(message)
                print(f"[WS] Received from extension: {data}")

                # Handle ping/pong for keepalive
                if data.get('type') == 'ping':
                    await websocket.send(json.dumps({'type': 'pong'}))
                elif data.get('type') == 'capture_result':
                    print(f"[WS] Capture result: {data.get('result')}")

            except json.JSONDecodeError:
                print(f"[WS] Invalid JSON received: {message}")

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Extension disconnected (id: {client_id}, remaining: {len(connected_clients)})")


def run_http_server():
    """Run HTTP server in a separate thread"""
    server = HTTPServer((HOST, HTTP_PORT), CaptureRequestHandler)
    print(f"[HTTP] Server listening on http://{HOST}:{HTTP_PORT}")
    server.serve_forever()


async def main():
    """Main entry point"""
    global event_loop
    event_loop = asyncio.get_running_loop()

    print("=" * 50)
    print("ProofSnap Trigger Server")
    print("=" * 50)
    print(f"HTTP  endpoint: http://{HOST}:{HTTP_PORT}")
    print(f"WebSocket port: ws://{HOST}:{WS_PORT}")
    print("")
    print("Endpoints:")
    print("  GET  /status  - Health check")
    print("  POST /capture - Trigger screenshot")
    print("")
    print("Waiting for ProofSnap extension to connect...")
    print("=" * 50)

    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()

    # Start WebSocket server
    async with serve(websocket_handler, HOST, WS_PORT):
        await asyncio.Future()  # Run forever


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nShutting down...")
