import sqlite3
from datetime import datetime

conn = sqlite3.connect('../../messages.db')
c = conn.cursor()

# Get date range - only integer timestamps
c.execute('SELECT MIN(timestamp), MAX(timestamp) FROM messages WHERE typeof(timestamp) = "integer"')
min_ts, max_ts = c.fetchone()

print(f"Date range: {datetime.fromtimestamp(min_ts)} to {datetime.fromtimestamp(max_ts)}")
print(f"Timestamps: {min_ts} to {max_ts}")

# Find days with most messages
c.execute("""
    SELECT date(timestamp, 'unixepoch', 'localtime') as day, COUNT(*) as cnt
    FROM messages 
    WHERE timestamp IS NOT NULL
    GROUP BY day
    ORDER BY cnt DESC
    LIMIT 10
""")

print("\nBusiest days:")
for row in c.fetchall():
    print(f"  {row[0]}: {row[1]} messages")

conn.close()
