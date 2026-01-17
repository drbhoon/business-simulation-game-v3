// Migration Script: Add month_id to rm_bids table
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../game.db');
const migrationPath = path.join(__dirname, '../db/migrations/add_month_to_rm_bids.sql');

console.log('Starting migration: Add month_id to rm_bids');
console.log('Database:', dbPath);
console.log('Migration file:', migrationPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    }
});

const migration = fs.readFileSync(migrationPath, 'utf8');

// Split by semicolons and execute each statement
const statements = migration.split(';').filter(s => s.trim().length > 0);

let completed = 0;
statements.forEach((statement, index) => {
    db.run(statement, (err) => {
        if (err) {
            console.error(`Error executing statement ${index + 1}:`, err);
            console.error('Statement:', statement);
        } else {
            console.log(`✓ Statement ${index + 1} executed successfully`);
        }
        completed++;
        if (completed === statements.length) {
            console.log('\n✅ Migration completed successfully!');
            db.close();
        }
    });
});
