#!/usr/bin/env python3
"""Find the date range of messages in the PagerMon database."""

import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'messages.db')

def main():
    print(f"Database: {os.path.abspath(DB_PATH)}")
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get date range
    cursor.execute("SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM messages")
    min_ts, max_ts, count = cursor.fetchone()
    
    print(f"\nTotal messages: {count:,}")
    print(f"Earliest: {datetime.fromtimestamp(min_ts)} (timestamp: {min_ts})")
    print(f"Latest:   {datetime.fromtimestamp(max_ts)} (timestamp: {max_ts})")
    
    # Get a sample of recent messages with actual content
    print("\n" + "=" * 60)
    print("SAMPLE MESSAGES (with case numbers):")
    print("=" * 60)
    cursor.execute("""
        SELECT m.timestamp, c.agency, m.message 
        FROM messages m
        LEFT JOIN capcodes c ON m.alias_id = c.id
        WHERE m.message LIKE '%@@E%' OR m.message LIKE '%HbN%' OR m.message LIKE '%F2%'
        ORDER BY m.timestamp DESC
        LIMIT 10
    """)
    
    for row in cursor.fetchall():
        ts = datetime.fromtimestamp(row[0])
        print(f"\n[{ts}] {row[1]}")
        print(f"  {row[2][:150]}...")
    
    # Suggest a good test range
    print("\n" + "=" * 60)
    print("SUGGESTED TEST RANGE:")
    print("=" * 60)
    
    # Find a day with good data
    cursor.execute("""
        SELECT DATE(timestamp, 'unixepoch') as day, COUNT(*) as cnt
        FROM messages m
        LEFT JOIN capcodes c ON m.alias_id = c.id
        WHERE c.agency IN ('Ambulance Vic', 'CFA', 'SES', 'AV NEPT')
        GROUP BY day
        ORDER BY cnt DESC
        LIMIT 5
    """)
    
    print("Days with most emergency messages:")
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,} messages")
    
    conn.close()

if __name__ == '__main__':
    main()
