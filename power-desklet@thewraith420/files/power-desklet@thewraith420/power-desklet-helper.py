#!/usr/bin/python3

import sys
import subprocess
import os

def run_command(cmd_args, input_data=None):
    try:
        if input_data:
            proc = subprocess.Popen(cmd_args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            stdout, stderr = proc.communicate(input=input_data)
        else:
            proc = subprocess.Popen(cmd_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            stdout, stderr = proc.communicate()
            
        if proc.returncode != 0:
            print(f"Command failed: {' '.join(cmd_args)}", file=sys.stderr)
            if stdout:
                print(f"Stdout: {stdout.strip()}", file=sys.stderr)
            if stderr:
                print(f"Stderr: {stderr.strip()}", file=sys.stderr)
            sys.exit(proc.returncode)
        
        if stdout:
            print(stdout.strip())
        sys.exit(0)
    except FileNotFoundError:
        print(f"Command not found: {cmd_args[0]}", file=sys.stderr)
        sys.exit(127) # Command not found exit code
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)

def write_sys_file_with_auth(file_path, value):
    """Write to sysfs file with proper pkexec authentication"""
    try:
        # Use pkexec with tee to write the file
        proc = subprocess.Popen(
            ['pkexec', 'tee', file_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = proc.communicate(input=value + '\n')
        
        if proc.returncode != 0:
            print(f"Failed to write to {file_path}", file=sys.stderr)
            if stderr:
                print(f"Error: {stderr.strip()}", file=sys.stderr)
            sys.exit(proc.returncode)
        
        sys.exit(0)
    except Exception as e:
        print(f"Failed to execute pkexec: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: power-desklet-helper.py <action> [args...]", file=sys.stderr)
        sys.exit(1)

    action = sys.argv[1]
    args = sys.argv[2:]

    if action == "prime-select":
        if len(args) != 1:
            print("Usage: prime-select <profile>", file=sys.stderr)
            sys.exit(1)
        run_command(["pkexec", "prime-select", args[0]])
    elif action == "write-sys-file":
        if len(args) != 2:
            print("Usage: write-sys-file <file_path> <value>", file=sys.stderr)
            sys.exit(1)
        file_path = args[0]
        value = args[1]
        write_sys_file_with_auth(file_path, value)
    elif action == "write-sys-files":
        if len(args) % 2 != 0:
            print("Usage: write-sys-files <file_path1> <value1> [<file_path2> <value2> ...]", file=sys.stderr)
            sys.exit(1)
        
        # Write each file with its value using a single pkexec session
        try:
            # Build a bash script that writes all files
            bash_commands = []
            for i in range(0, len(args), 2):
                file_path = args[i]
                value = args[i+1]
                # Escape single quotes in the value for shell
                escaped_value = value.replace("'", "'\\''")
                bash_commands.append(f"echo '{escaped_value}' > {file_path}")
            
            bash_script = "; ".join(bash_commands)
            
            # Execute with pkexec
            proc = subprocess.Popen(
                ['pkexec', 'bash', '-c', bash_script],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = proc.communicate()
            
            if proc.returncode != 0:
                print(f"Failed to write system files", file=sys.stderr)
                if stderr:
                    print(f"Error: {stderr.strip()}", file=sys.stderr)
                sys.exit(proc.returncode)
            
            sys.exit(0)
        except Exception as e:
            print(f"Failed to execute pkexec: {e}", file=sys.stderr)
            sys.exit(1)
    elif action == "reboot":
        run_command(["pkexec", "systemctl", "reboot"])
    else:
        print(f"Unknown action: {action}", file=sys.stderr)
        sys.exit(1)
