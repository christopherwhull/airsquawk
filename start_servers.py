#!/usr/bin/env python3
"""
Aircraft Dashboard Server Manager
Starts the Node.js API server (port 3002) and tile proxy server (port 3004) in separate console windows.
"""

import subprocess
import sys
import os
import time
import platform

def is_windows():
    """Check if running on Windows"""
    return platform.system() == 'Windows'

def start_server_in_new_window(command, title, cwd=None):
    """
    Start a server in a new console window

    Args:
        command (list): Command to run as list
        title (str): Window title
        cwd (str): Working directory
    """
    if is_windows():
        # Windows: Use CREATE_NEW_CONSOLE flag
        creation_flags = subprocess.CREATE_NEW_CONSOLE
        try:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                creationflags=creation_flags,
                shell=False
            )
            print(f"✓ Started {title} in new console window (PID: {process.pid})")
            return process
        except Exception as e:
            print(f"✗ Failed to start {title}: {e}")
            return None
    else:
        # Unix-like systems: Use nohup or similar
        try:
            # Use nohup to detach from terminal
            cmd = ['nohup'] + command
            process = subprocess.Popen(
                cmd,
                cwd=cwd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid if hasattr(os, 'setsid') else None
            )
            print(f"✓ Started {title} in background (PID: {process.pid})")
            return process
        except Exception as e:
            print(f"✗ Failed to start {title}: {e}")
            return None

def main():
    """Main function to start both servers"""
    print("🚀 Aircraft Dashboard Server Manager")
    print("=" * 40)

    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Check if server files exist
    server_js = os.path.join(script_dir, 'server.js')
    tile_proxy_js = os.path.join(script_dir, 'tile-proxy-server.js')

    if not os.path.exists(server_js):
        print(f"✗ Error: {server_js} not found")
        sys.exit(1)

    if not os.path.exists(tile_proxy_js):
        print(f"✗ Error: {tile_proxy_js} not found")
        sys.exit(1)

    # Check if Node.js is available
    try:
        subprocess.run(['node', '--version'],
                      capture_output=True, check=True, text=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("✗ Error: Node.js not found. Please install Node.js first.")
        sys.exit(1)

    processes = []

    # Start API server (port 3002)
    print("\n📡 Starting API Server (port 3002)...")
    api_cmd = ['node', 'server.js']
    api_process = start_server_in_new_window(api_cmd, "Aircraft Dashboard API Server", script_dir)
    if api_process:
        processes.append(('API Server', api_process))

    # Wait a moment before starting the next server
    time.sleep(2)

    # Start tile proxy server (port 3004)
    print("\n🗺️  Starting Tile Proxy Server (port 3004)...")
    proxy_cmd = ['node', 'tile-proxy-server.js']
    proxy_process = start_server_in_new_window(proxy_cmd, "Aircraft Dashboard Tile Proxy", script_dir)
    if proxy_process:
        processes.append(('Tile Proxy Server', proxy_process))

    print("\n" + "=" * 40)
    print("✅ Server startup complete!")
    print("\n📋 Server Status:")
    for name, process in processes:
        print(f"   • {name}: Running (PID {process.pid})")

    print("\n🌐 Access URLs:")
    print("   • Dashboard: http://localhost:3002")
    print("   • API: http://localhost:3002/api/")
    print("   • Tile Proxy: http://localhost:3004/tile/")

    print("\n💡 Tips:")
    print("   • Check the console windows for server logs")
    print("   • Press Ctrl+C in console windows to stop servers")
    print("   • Run this script again to restart servers")

    # Keep the script running briefly to show status
    try:
        time.sleep(3)
    except KeyboardInterrupt:
        print("\n👋 Exiting server manager...")

if __name__ == "__main__":
    main()