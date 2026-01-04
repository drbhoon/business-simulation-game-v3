import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = process.env.DATABASE_FILE_PATH || path.resolve(__dirname, '../../game.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database at', dbPath);
    }
});

export const query = (text: string, params: any[] = []): Promise<{ rows: any[], lastID?: number, changes?: number }> => {
    return new Promise((resolve, reject) => {
        // Simple heuristic to detect SELECT vs others for run() vs all()
        // However, sqlite3 'all' works for selects, 'run' for inserts/updates but 'run' return format is different (this)
        const command = text.trim().split(' ')[0].toUpperCase();

        if (command === 'SELECT') {
            db.all(text, params, (err, rows) => {
                if (err) reject(err);
                else resolve({ rows });
            });
        } else {
            // For INSERT/UPDATE/DELETE
            // Note: Postgres 'RETURNING' is not standard SQLite. 
            // We need to handle queries that might use RETURNING by stripping it or handling it separately if possible.
            // But for now, let's assume we might need to adjust the controller logic or use separate calls.
            // For simplicity in this adapter, we will just execute.
            // CAUTION: If the caller expects rows from an INSERT, this naive implementation will fail if the SQL has RETURNING.

            // Allow multiple statements? No, standard sqlite3 doesn't support multiple in one go easily without exec.

            db.run(text, params, function (this: sqlite3.RunResult, err: Error | null) {
                if (err) reject(err);
                else {
                    // Start shim for RETURNING * style behavior if possible, but hard to do generically.
                    // For now, return empty rows or what `this` context gives (lastID, changes)
                    // We map `this` to something useful if needed, but the PG client expects `rows`.
                    resolve({ rows: [], lastID: this.lastID, changes: this.changes });
                }
            });
        }
    });
};

export const getClient = async () => {
    // Mock client for initDb transaction support logic
    // SQLite serializes operations so we can just return a localized object
    return {
        query: (text: string, params?: any[]) => {
            if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                return Promise.resolve(); // SQLite serializes automatically mostly, strictly explicit transactions handled via run
            }
            // For schema initialization which sends a big string
            if (text.includes('CREATE TABLE')) {
                return new Promise((resolve, reject) => {
                    db.exec(text, (err) => {
                        if (err) reject(err);
                        else resolve({});
                    });
                });
            }
            return query(text, params);
        },
        release: () => { }
    };
};

export default db;
