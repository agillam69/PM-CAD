#!/usr/bin/env python3
"""
Package the CAD addon into a single zip file for deployment.
"""

import os
import zipfile
import shutil
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
OUTPUT_DIR = os.path.dirname(PROJECT_DIR)

# Files/folders to exclude
EXCLUDE = [
    'node_modules',
    'data',
    'test_data',
    '.git',
    '__pycache__',
    '*.pyc',
    'config/config.json',  # Don't include user config
    'scripts/setup_test_db.py',
    'scripts/inspect_db.py',
    'scripts/find_date_range.py',
    'scripts/find_dates.py',
]

def should_exclude(path, name):
    """Check if file/folder should be excluded."""
    for pattern in EXCLUDE:
        if pattern.startswith('*'):
            if name.endswith(pattern[1:]):
                return True
        elif name == pattern or pattern in path:
            return True
    return False

def create_package():
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    zip_name = f'cad-addon-{timestamp}.zip'
    zip_path = os.path.join(OUTPUT_DIR, zip_name)
    
    print(f"Creating package: {zip_path}")
    print(f"Source: {PROJECT_DIR}")
    print()
    
    file_count = 0
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(PROJECT_DIR):
            # Filter out excluded directories
            dirs[:] = [d for d in dirs if not should_exclude(root, d)]
            
            for file in files:
                if should_exclude(root, file):
                    continue
                
                file_path = os.path.join(root, file)
                arc_name = os.path.relpath(file_path, PROJECT_DIR)
                arc_name = os.path.join('cad-addon', arc_name)
                
                print(f"  Adding: {arc_name}")
                zf.write(file_path, arc_name)
                file_count += 1
    
    # Get file size
    size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    
    print()
    print("=" * 50)
    print(f"Package created: {zip_name}")
    print(f"Location: {zip_path}")
    print(f"Files: {file_count}")
    print(f"Size: {size_mb:.2f} MB")
    print("=" * 50)
    print()
    print("To deploy:")
    print("1. Upload this zip to your Google Cloud instance")
    print("2. Extract: unzip cad-addon-*.zip")
    print("3. cd cad-addon && npm install && npm start")
    print()
    
    return zip_path

if __name__ == '__main__':
    create_package()
