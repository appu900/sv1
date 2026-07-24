import * as dotenv from 'dotenv';
import * as path from 'path';
import * as mongoose from 'mongoose';
import {
  User,
  UserSchema,
  UserRole,
} from '../src/database/schemas/user.auth.schema';
import {
  ChefProfile,
  ChefProfileSchema,
} from '../src/database/schemas/chef-profile.schema';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DBNAME || 'saveful';
  if (!uri) throw new Error('MONGODB_URI is not set in .env');

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB');

  const UserModel = mongoose.model(User.name, UserSchema);
  const ChefProfileModel = mongoose.model(ChefProfile.name, ChefProfileSchema);

  const chefs = await UserModel.find({ role: UserRole.CHEF })
    .select({ _id: 1, name: 1, country: 1 })
    .lean();

  let created = 0;
  let skipped = 0;

  for (const chef of chefs) {
    const exists = await ChefProfileModel.exists({ userId: chef._id });
    if (exists) {
      skipped += 1;
      continue;
    }

    const displayName = (chef.name || 'Chef').trim();
    let slug = slugify(displayName) || `chef-${String(chef._id).slice(-6)}`;
    let attempt = 0;
    while (await ChefProfileModel.exists({ slug })) {
      attempt += 1;
      slug = `${slugify(displayName)}-${attempt}`;
    }

    await ChefProfileModel.create({
      userId: chef._id,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      slug,
      country: chef.country,
      isPublished: false,
      order: 0,
      lifetime: {
        mealsCooked: 0,
        moneySaved: 0,
        moneyByCurrency: {},
        foodSavedInGrams: 0,
        co2SavedInGrams: 0,
      },
    });
    created += 1;
  }

  console.log(
    `Chef profile backfill complete. chefs=${chefs.length} created=${created} skipped=${skipped}`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
