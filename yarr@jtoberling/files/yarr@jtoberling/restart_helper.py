#!/usr/bin/python3

import sys
import subprocess
import time
import os
import json

def reload_desklet(uuid, desklet_id):
    """Reload the desklet code by touching files and using DBus"""
    try:
        print(f"Reloading desklet code for {uuid}")
        
        # Calculate desklet path relative to the helper's location
        # The helper is in the desklet directory, so we can use the current directory
        helper_dir = os.path.dirname(os.path.abspath(__file__))
        desklet_path = helper_dir
        
        if os.path.exists(desklet_path):
            print(f"Touching desklet files to force reload...")
            
            # Touch the main desklet file to force a reload
            desklet_js = os.path.join(desklet_path, "desklet.js")
            if os.path.exists(desklet_js):
                subprocess.run(["touch", desklet_js], check=True)
                print(f"Touched {desklet_js}")
            
            # Also touch the metadata file
            metadata_json = os.path.join(desklet_path, "metadata.json")
            if os.path.exists(metadata_json):
                subprocess.run(["touch", metadata_json], check=True)
                print(f"Touched {metadata_json}")
            
            # Now try the DBus method to reload the extension
            print("Using DBus ReloadExtension method...")
            command = [
                'gdbus', 'call', '--session',
                '--dest', 'org.Cinnamon.LookingGlass',
                '--object-path', '/org/Cinnamon/LookingGlass',
                '--method', 'org.Cinnamon.LookingGlass.ReloadExtension',
                uuid, 'DESKLET'
            ]
            
            result = subprocess.run(command, capture_output=True, text=True)
            
            if result.returncode == 0:
                print(f"Successfully reloaded desklet {uuid}")
                return True
            else:
                print(f"DBus method failed: {result.stderr}")
                return False
        else:
            print(f"Desklet path not found: {desklet_path}")
            return False
            
    except Exception as e:
        print(f"Error reloading desklet: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 restart_helper.py <uuid> <desklet_id>")
        sys.exit(1)
    
    uuid = sys.argv[1]
    desklet_id = sys.argv[2]
    
    success = reload_desklet(uuid, desklet_id)
    sys.exit(0 if success else 1) 