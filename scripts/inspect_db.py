#!/usr/bin/env python3
"""
Inspect the real PagerMon database to understand message formats.
"""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'messages.db')

def main():
    print(f"Database: {os.path.abspath(DB_PATH)}")
    print("=" * 80)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    print(f"\nTables: {[t[0] for t in tables]}")
    
    # Check capcodes
    print("\n" + "=" * 80)
    print("CAPCODES (Aliases):")
    print("=" * 80)
    cursor.execute("SELECT * FROM capcodes LIMIT 20")
    cols = [d[0] for d in cursor.description]
    print(f"Columns: {cols}")
    for row in cursor.fetchall():
        print(f"  {row}")
    
    # Check recent messages
    print("\n" + "=" * 80)
    print("RECENT MESSAGES (last 30):")
    print("=" * 80)
    cursor.execute("""
        SELECT m.id, m.address, m.message, m.source, m.timestamp, c.agency, c.alias
        FROM messages m
        LEFT JOIN capcodes c ON m.alias_id = c.id
        ORDER BY m.timestamp DESC
        LIMIT 30
    """)
    
    for row in cursor.fetchall():
        msg_id, address, message, source, ts, agency, alias = row
        print(f"\n[{agency or 'UNKNOWN'}] Address: {address}")
        print(f"  Message: {message[:200]}{'...' if len(message) > 200 else ''}")
    
    # Count by agency
    print("\n" + "=" * 80)
    print("MESSAGE COUNT BY AGENCY:")
    print("=" * 80)
    cursor.execute("""
        SELECT c.agency, COUNT(*) as cnt
        FROM messages m
        LEFT JOIN capcodes c ON m.alias_id = c.id
        GROUP BY c.agency
        ORDER BY cnt DESC
    """)
    for row in cursor.fetchall():
        print(f"  {row[0] or 'UNKNOWN'}: {row[1]} messages")
    
    conn.close()

if __name__ == '__main__':
    main()
