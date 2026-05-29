import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as mongoose from 'mongoose';
import { UserSchema, User } from '../src/database/schemas/user.auth.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });


function parseEmailsFromCsv(filePath: string, columnHeader = 'Email'): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  // Parse header row — handles quoted fields
  const parseRow = (row: string): string[] =>
    row.match(/(".*?"|[^",\r\n]+|(?<=,)(?=,)|(?<=,)(?=$))/g)?.map((v) =>
      v.replace(/^"|"$/g, '').trim(),
    ) ?? [];

  const headers = parseRow(lines[0]);
  const emailIndex = headers.findIndex(
    (h) => h.toLowerCase() === columnHeader.toLowerCase(),
  );

  if (emailIndex === -1) {
    throw new Error(
      `Column "${columnHeader}" not found in CSV. Available headers: ${headers.join(', ')}`,
    );
  }

  const emails: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const email = cols[emailIndex]?.toLowerCase();
    if (email) emails.push(email);
  }

  return emails;
}

async function syncUnsubscribedUsers() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';

  if (!uri) {
    throw new Error('MONGODB_URI is not set in .env');
  }

  // Resolve the CSV path — adjust if the file is somewhere else
  const csvPath = path.resolve(
    process.env.UNSUBSCRIBED_CSV_PATH ||
      path.join(
        require('os').homedir(),
        'Downloads',
        'hubspot-crm-exports-unsbscribed-2026-05-27.csv',
      ),
  );

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at: ${csvPath}`);
  }

  console.log(`Reading unsubscribed emails from: ${csvPath}`);
  const unsubscribedEmails = parseEmailsFromCsv(csvPath, 'Email');
  const uniqueUnsubscribed = [...new Set(unsubscribedEmails)];
  console.log(`Found ${uniqueUnsubscribed.length} unique unsubscribed emails`);

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const UserModel = mongoose.model(User.name, UserSchema);

  // Mark unsubscribed users → isUserSubscribed: false
  const unsubResult = await UserModel.updateMany(
    { email: { $in: uniqueUnsubscribed } },
    { $set: { isUserSubscribed: false } },
  );

  console.log(
    `Marked as unsubscribed: matched=${unsubResult.matchedCount}, modified=${unsubResult.modifiedCount}`,
  );

  // Mark everyone else → isUserSubscribed: true
  const resubResult = await UserModel.updateMany(
    { email: { $nin: uniqueUnsubscribed } },
    { $set: { isUserSubscribed: true } },
  );

  console.log(
    `Marked as subscribed: matched=${resubResult.matchedCount}, modified=${resubResult.modifiedCount}`,
  );
}

syncUnsubscribedUsers()
  .then(async () => {
    await mongoose.disconnect();
    console.log('Done. Disconnected from MongoDB.');
  })
  .catch(async (error) => {
    console.error('Script failed:', error);
    await mongoose.disconnect();
    process.exit(1);
  });
