import fs from 'fs';
import path from 'path';
import { query, getClient } from '../db';

async function initDb() {
    console.log('Initializing Database...');
    const client = await getClient();
    try {
        let schemaPath = path.join(__dirname, '../db/schema.sql');
        if (!fs.existsSync(schemaPath)) {
            // Fallback to src directory if running from dist and file wasn't copied
            schemaPath = path.join(__dirname, '../../src/db/schema.sql');
        }
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Executing schema.sql...');
        await client.query('BEGIN');
        await client.query(schemaSql);
        await client.query('COMMIT');

        console.log('Database initialized successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error initializing database:', err);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

initDb();
