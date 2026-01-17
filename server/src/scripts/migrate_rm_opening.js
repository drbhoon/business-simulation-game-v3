// Migration: Add rm_opening_balance column
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../../game.db');

console.log('Running migration: Add rm_opening_balance');
console.log('Database:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
});

db.run('ALTER TABLE financials ADD COLUMN rm_opening_balance INTEGER DEFAULT 0', (err) => {
    if (err) {
        if (err.message.includes('duplicate column name')) {
            console.log('✓ Column rm_opening_balance already exists');
        } else {
            console.error('Error adding column:', err);
            process.exit(1);
        }
    } else {
        console.log('✓ Column rm_opening_balance added successfully');
    }

    db.close();
    console.log('\n✅ Migration completed!');
});
