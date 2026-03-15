#!/usr/bin/env python3
"""
PagerMon Test Database Setup Script

This script creates a SQLite database with sample data for testing the CAD add-on.
It creates the same schema as PagerMon and populates it with realistic test messages.

Usage:
    python setup_test_db.py

The database will be created at: ../test_data/messages.db
"""

import sqlite3
import os
import time
import random
from datetime import datetime, timedelta

# Database path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(SCRIPT_DIR, '..', 'test_data')
DB_PATH = os.path.join(DB_DIR, 'messages.db')

# Sample data for generating realistic messages
SERVICES = {
    'ambulance': {
        'agency': 'AMBULANCE',
        'alias': 'Ambulance Victoria',
        'icon': 'ambulance',
        'color': '#28a745',
        'addresses': [
            '123 MAIN ST MELBOURNE',
            '45 QUEEN ST RICHMOND',
            '789 HIGH ST PRAHRAN',
            '12 CHAPEL ST WINDSOR',
            '56 SMITH ST COLLINGWOOD',
            '234 BRIDGE RD RICHMOND',
            '67 SWAN ST CREMORNE',
            '890 VICTORIA ST ABBOTSFORD',
        ],
        'message_templates': [
            'E{case} P1 CHEST PAIN AT {address} MAP {map} XST CROSS ST',
            'E{case} P2 FALL AT {address} MAP {map} ELDERLY PATIENT',
            'E{case} P1 BREATHING DIFFICULTY AT {address} MAP {map}',
            'E{case} P2 ABDOMINAL PAIN AT {address} MAP {map}',
            'E{case} P1 CARDIAC ARREST AT {address} MAP {map} CPR IN PROGRESS',
            'E{case} P3 LACERATION AT {address} MAP {map}',
        ],
        'resources': ['A21', 'A22', 'A31', 'A32', 'A41', 'M1', 'M2', 'HEMS1'],
    },
    'fire': {
        'agency': 'CFA',
        'alias': 'CFA Fire',
        'icon': 'fire',
        'color': '#dc3545',
        'addresses': [
            '100 INDUSTRIAL DR DANDENONG',
            '55 FACTORY RD BAYSWATER',
            '200 WAREHOUSE WAY CLAYTON',
            '33 BUSH RD LILYDALE',
            '77 FARM LANE PAKENHAM',
            '150 FOREST RD BELGRAVE',
        ],
        'message_templates': [
            'F{case} STRUCTURE FIRE AT {address} MAP {map} SMOKE SHOWING',
            'F{case} GRASS FIRE AT {address} MAP {map} SPREADING',
            'F{case} CAR FIRE AT {address} MAP {map}',
            'F{case} ALARM AT {address} MAP {map} COMMERCIAL PREMISES',
            'F{case} RESCUE AT {address} MAP {map} PERSONS TRAPPED',
            'F{case} HAZMAT AT {address} MAP {map} CHEMICAL SPILL',
        ],
        'resources': ['P421', 'P422', 'P431', 'T421', 'T431', 'HAZMAT1', 'RESCUE1'],
    },
    'ses': {
        'agency': 'VICSES',
        'alias': 'VIC SES',
        'icon': 'hard-hat',
        'color': '#fd7e14',
        'addresses': [
            '88 RIVER RD WARRANDYTE',
            '22 CREEK ST ELTHAM',
            '44 VALLEY RD TEMPLESTOWE',
            '66 HILL ST DONCASTER',
            '99 STORM WAY RINGWOOD',
        ],
        'message_templates': [
            'S{case} TREE DOWN AT {address} MAP {map} BLOCKING ROAD',
            'S{case} FLOOD ASSIST AT {address} MAP {map}',
            'S{case} BUILDING DAMAGE AT {address} MAP {map} STORM DAMAGE',
            'S{case} RESCUE AT {address} MAP {map}',
            'S{case} TARP REQUIRED AT {address} MAP {map} ROOF DAMAGE',
        ],
        'resources': ['SES01', 'SES02', 'SES03', 'RESCUE2'],
    },
    'nept': {
        'agency': 'NEPT',
        'alias': 'Non-Emergency Patient Transport',
        'icon': 'hospital',
        'color': '#6f42c1',
        'addresses': [
            'ROYAL MELBOURNE HOSPITAL PARKVILLE',
            'ALFRED HOSPITAL PRAHRAN',
            'BOX HILL HOSPITAL BOX HILL',
            'MONASH MEDICAL CENTRE CLAYTON',
            'AUSTIN HOSPITAL HEIDELBERG',
        ],
        'message_templates': [
            'N{case} TRANSFER FROM {address} TO DIALYSIS',
            'N{case} DISCHARGE FROM {address}',
            'N{case} APPOINTMENT AT {address}',
            'N{case} INTER-HOSPITAL TRANSFER FROM {address}',
        ],
        'resources': ['N01', 'N02', 'N03', 'N04'],
    },
}


def create_database():
    """Create the SQLite database with PagerMon schema."""
    # Ensure directory exists
    os.makedirs(DB_DIR, exist_ok=True)
    
    # Remove existing database
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Removed existing database: {DB_PATH}")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create capcodes table (aliases)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS capcodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT NOT NULL,
            alias TEXT NOT NULL,
            agency TEXT,
            icon TEXT,
            color TEXT,
            pluginconf TEXT,
            ignore INTEGER DEFAULT 0,
            UNIQUE(id, address)
        )
    ''')
    
    # Create messages table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT NOT NULL,
            message TEXT NOT NULL,
            source TEXT NOT NULL,
            timestamp INTEGER,
            alias_id INTEGER,
            FOREIGN KEY (alias_id) REFERENCES capcodes(id)
        )
    ''')
    
    # Create indexes
    cursor.execute('CREATE INDEX IF NOT EXISTS msg_index ON messages(address, id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS msg_alias ON messages(id, alias_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS msg_timestamp ON messages(timestamp, alias_id)')
    
    conn.commit()
    print("Database schema created successfully")
    
    return conn


def insert_capcodes(conn):
    """Insert sample capcodes (aliases) for each service."""
    cursor = conn.cursor()
    
    capcode_id = 1
    capcode_map = {}
    
    for service_key, service_data in SERVICES.items():
        # Create a capcode pattern for this service
        # Using wildcard patterns like PagerMon does
        if service_key == 'ambulance':
            address_pattern = 'E%'  # Matches E followed by anything
        elif service_key == 'fire':
            address_pattern = 'F%'
        elif service_key == 'ses':
            address_pattern = 'S%'
        elif service_key == 'nept':
            address_pattern = 'N%'
        else:
            address_pattern = '%'
        
        cursor.execute('''
            INSERT INTO capcodes (id, address, alias, agency, icon, color, ignore)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        ''', (
            capcode_id,
            address_pattern,
            service_data['alias'],
            service_data['agency'],
            service_data['icon'],
            service_data['color'],
        ))
        
        capcode_map[service_key] = capcode_id
        capcode_id += 1
    
    conn.commit()
    print(f"Inserted {len(SERVICES)} capcodes")
    
    return capcode_map


def generate_case_number():
    """Generate a realistic case number."""
    return str(random.randint(100000000, 999999999))


def generate_map_ref():
    """Generate a realistic map reference."""
    return f"{random.randint(1, 200)} {random.choice('ABCDEFGH')}{random.randint(1, 12)}"


def insert_messages(conn, capcode_map, num_cases=20, messages_per_case_range=(1, 4)):
    """Insert sample messages for testing."""
    cursor = conn.cursor()
    
    now = int(time.time())
    message_count = 0
    
    for _ in range(num_cases):
        # Pick a random service
        service_key = random.choice(list(SERVICES.keys()))
        service_data = SERVICES[service_key]
        
        # Generate case details
        case_number = generate_case_number()
        address = random.choice(service_data['addresses'])
        map_ref = generate_map_ref()
        
        # Generate 1-4 messages for this case
        num_messages = random.randint(*messages_per_case_range)
        
        # First message - initial dispatch
        template = random.choice(service_data['message_templates'])
        message = template.format(case=case_number, address=address, map=map_ref)
        
        # Random timestamp within last 4 hours
        timestamp = now - random.randint(0, 4 * 3600)
        
        # Determine the address prefix for matching
        if service_key == 'ambulance':
            msg_address = f"E{case_number[:7]}"
        elif service_key == 'fire':
            msg_address = f"F{case_number[:7]}"
        elif service_key == 'ses':
            msg_address = f"S{case_number[:7]}"
        elif service_key == 'nept':
            msg_address = f"N{case_number[:7]}"
        else:
            msg_address = case_number[:7]
        
        cursor.execute('''
            INSERT INTO messages (address, message, source, timestamp, alias_id)
            VALUES (?, ?, ?, ?, ?)
        ''', (
            msg_address,
            message,
            'TEST',
            timestamp,
            capcode_map.get(service_key),
        ))
        message_count += 1
        
        # Additional messages (resource assignments, updates)
        for i in range(1, num_messages):
            # Resource assignment message
            resources = random.sample(service_data['resources'], 
                                     min(random.randint(1, 3), len(service_data['resources'])))
            
            if i == 1:
                update_msg = f"{service_key[0].upper()}{case_number} UNITS ASSIGNED {' '.join(resources)}"
            else:
                update_msg = f"{service_key[0].upper()}{case_number} UPDATE {random.choice(['ENROUTE', 'ON SCENE', 'ADDITIONAL UNITS', 'STAND DOWN 1 UNIT'])}"
            
            cursor.execute('''
                INSERT INTO messages (address, message, source, timestamp, alias_id)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                msg_address,
                update_msg,
                'TEST',
                timestamp + (i * 120),  # 2 minutes apart
                capcode_map.get(service_key),
            ))
            message_count += 1
    
    conn.commit()
    print(f"Inserted {message_count} messages for {num_cases} cases")


def print_sample_data(conn):
    """Print some sample data for verification."""
    cursor = conn.cursor()
    
    print("\n" + "=" * 60)
    print("SAMPLE CAPCODES:")
    print("=" * 60)
    cursor.execute('SELECT * FROM capcodes')
    for row in cursor.fetchall():
        print(f"  ID: {row[0]}, Pattern: {row[1]}, Alias: {row[2]}, Agency: {row[3]}")
    
    print("\n" + "=" * 60)
    print("SAMPLE MESSAGES (last 10):")
    print("=" * 60)
    cursor.execute('''
        SELECT m.*, c.agency 
        FROM messages m 
        LEFT JOIN capcodes c ON m.alias_id = c.id 
        ORDER BY m.timestamp DESC 
        LIMIT 10
    ''')
    for row in cursor.fetchall():
        ts = datetime.fromtimestamp(row[4]).strftime('%H:%M:%S')
        print(f"  [{ts}] {row[6] or 'UNKNOWN'}: {row[2][:80]}...")


def main():
    print("=" * 60)
    print("PagerMon Test Database Setup")
    print("=" * 60)
    print(f"Database path: {DB_PATH}")
    print()
    
    # Create database
    conn = create_database()
    
    # Insert capcodes
    capcode_map = insert_capcodes(conn)
    
    # Insert sample messages
    insert_messages(conn, capcode_map, num_cases=25, messages_per_case_range=(1, 4))
    
    # Print sample data
    print_sample_data(conn)
    
    conn.close()
    
    print("\n" + "=" * 60)
    print("Setup complete!")
    print("=" * 60)
    print(f"\nDatabase created at: {DB_PATH}")
    print("\nTo use this database with the CAD add-on, update config/config.json:")
    print('  "pagermon": {')
    print('    "database": {')
    print('      "type": "sqlite3",')
    print(f'      "file": "./test_data/messages.db"')
    print('    }')
    print('  }')
    print()


if __name__ == '__main__':
    main()
