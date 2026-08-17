import { pathToFileURL } from 'node:url';
import { openDatabase } from './db.js';
import { seedDemo } from './fixtures/demo.js';

export { seedDemo };

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const db = openDatabase();
  try {
    await seedDemo(db);
    process.stdout.write('demo seed applied\n');
  } finally {
    db.close();
  }
}
